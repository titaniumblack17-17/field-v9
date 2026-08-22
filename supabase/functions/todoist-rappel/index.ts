// Rappels de Field dans Todoist, dans les deux sens.
//
// Field reste la source de vérité pour les données : on ne recopie vers Todoist
// ni pipeline, ni montants, ni équipements — seulement « qui rappeler, quand,
// et à quel numéro ». Ce que Todoist apporte en retour, et que Field ne sait
// pas faire depuis un navigateur iOS, c'est la notification qui arrive vraiment
// au poignet.
//
// Deux actions :
//   { dossierId }           aligne la tâche d'un dossier (créée, mise à jour,
//                           supprimée selon son rappel)
//   { action: 'reconcilier' } rapatrie ce qui a été coché ou supprimé côté
//                           Todoist, pour que Field cesse d'annoncer un rappel
//                           déjà traité
//
// Le jeton Todoist ne peut pas vivre dans le navigateur : il donnerait à
// quiconque ouvre le bundle un accès total au compte. Il reste ici, en secret
// de projet, et l'app ne connaît que l'identifiant du dossier.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const API = 'https://api.todoist.com/api/v1'

// Projet « 👥 Suivi clients », déjà présent dans le compte et vide : les
// rappels de Field s'y rangent sans se mêler aux fiches du Pipeline actif.
const PROJET_DEFAUT = '6gV777C2cJHhG26w'

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        // supabase-js ajoute x-client-info et x-supabase-api-version. Absents
        // de cette liste, le contrôle préalable CORS échoue et l'appel depuis
        // l'application meurt en « Failed to fetch » — alors qu'un curl passe.
        'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    },
  })

const nomClient = (c: Record<string, unknown> | null) =>
  c ? [c.prenom_praticien, c.nom_praticien].filter(Boolean).join(' ') : 'Client'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  const jeton = Deno.env.get('TODOIST_TOKEN')
  if (!jeton) {
    return json({ erreur: 'TODOIST_TOKEN absent des secrets du projet Supabase.' }, 503)
  }

  let corpsRequete: { dossierId?: string; action?: string }
  try {
    corpsRequete = await req.json()
  } catch {
    return json({ erreur: 'Corps JSON invalide.' }, 400)
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const todoist = (chemin: string, init: RequestInit = {}) =>
    fetch(`${API}${chemin}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${jeton}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })

  // ───────────────────────── Todoist → Field ─────────────────────────
  if (corpsRequete.action === 'reconcilier') {
    const { data: suivis } = await db
      .from('dossiers')
      .select('id, rappel_note, titre, todoist_task_id')
      .not('todoist_task_id', 'is', null)

    if (!suivis?.length) return json({ traites: 0 })

    const verdicts = await Promise.all(
      suivis.map(async (d) => {
        const r = await todoist(`/tasks/${d.todoist_task_id}`)
        // Todoist sort les tâches terminées des tâches actives : selon la
        // version, elles répondent 404 ou reviennent avec un drapeau.
        if (r.status === 404) return { d, sort: 'retire' as const }
        if (!r.ok) return null
        const t = await r.json()
        if (t.checked || t.is_completed || t.completed_at) {
          return { d, sort: 'fait' as const }
        }
        return null
      })
    )

    const clos = verdicts.filter((v): v is NonNullable<typeof v> => v !== null)
    if (!clos.length) return json({ traites: 0 })

    // Trace au journal : le geste fait sur la montre doit rester lisible dans
    // la fiche, sinon le rappel disparaît sans qu'on sache ce qu'il est devenu.
    await db.from('dossier_notes').insert(
      clos.map(({ d, sort }) => ({
        dossier_id: d.id,
        texte:
          sort === 'fait'
            ? `Rappel fait — coché dans Todoist${d.rappel_note ? ` : ${d.rappel_note}` : ''}`
            : 'Rappel retiré depuis Todoist',
      }))
    )

    await db
      .from('dossiers')
      .update({ rappel_date: null, todoist_task_id: null })
      .in('id', clos.map(({ d }) => d.id))

    return json({ traites: clos.length })
  }

  // ───────────────────────── Field → Todoist ─────────────────────────
  const dossierId = corpsRequete.dossierId
  if (!dossierId) return json({ erreur: 'dossierId manquant.' }, 400)

  const { data: dossier, error } = await db
    .from('dossiers')
    .select(
      'id, titre, type, rappel_date, rappel_note, todoist_task_id, clients(prenom_praticien, nom_praticien, nom_cabinet, ville, telephone_portable, telephone_cabinet)'
    )
    .eq('id', dossierId)
    .single()

  if (error || !dossier) return json({ erreur: 'Dossier introuvable.' }, 404)

  const existant = dossier.todoist_task_id

  // Rappel effacé côté Field : la tâche n'a plus lieu d'être.
  if (!dossier.rappel_date) {
    if (existant) {
      // 404 = déjà disparue de Todoist ; le résultat voulu est atteint.
      await todoist(`/tasks/${existant}`, { method: 'DELETE' }).catch(() => {})
      await db.from('dossiers').update({ todoist_task_id: null }).eq('id', dossierId)
    }
    return json({ etat: 'supprime' })
  }

  const client = dossier.clients as Record<string, unknown> | null
  const tel = client?.telephone_portable ?? client?.telephone_cabinet ?? null

  const tache = {
    content: `${nomClient(client)} — ${dossier.rappel_note || dossier.titre || 'à rappeler'}`,
    description: [
      client?.nom_cabinet,
      client?.ville,
      tel ? `Tél. ${tel}` : null,
      dossier.titre && dossier.titre !== dossier.rappel_note ? dossier.titre : null,
    ]
      .filter(Boolean)
      .join('\n'),
    due_date: dossier.rappel_date,
    priority: 3, // p2 dans l'interface : à traiter, sans être urgent.
  }

  // Mise à jour de la tâche déjà poussée.
  if (existant) {
    const r = await todoist(`/tasks/${existant}`, {
      method: 'POST',
      body: JSON.stringify(tache),
    })
    if (r.ok) return json({ etat: 'maj', taskId: existant })
    // Supprimée ou cochée dans Todoist entre-temps : on la recrée plutôt que
    // de laisser le rappel muet.
    if (r.status !== 404) return json({ erreur: `Todoist a répondu ${r.status}.` }, 502)
  }

  const r = await todoist('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      ...tache,
      project_id: Deno.env.get('TODOIST_PROJECT_ID') ?? PROJET_DEFAUT,
    }),
  })

  if (!r.ok) return json({ erreur: `Todoist a répondu ${r.status}.` }, 502)

  const creee = await r.json()
  await db.from('dossiers').update({ todoist_task_id: creee.id }).eq('id', dossierId)

  return json({ etat: 'cree', taskId: creee.id })
})
