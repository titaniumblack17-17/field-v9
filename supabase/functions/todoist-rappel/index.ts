// Rappels de Field dans Todoist, dans les deux sens.
//
// Field reste la source de vérité : on ne recopie vers Todoist ni pipeline, ni
// montants, ni équipements — seulement « qui rappeler, quand, à quel numéro ».
// Ce que Todoist apporte en retour, et qu'un navigateur iOS ne sait pas faire,
// c'est la notification qui arrive vraiment au poignet.
//
//   { rappelId }              aligne la tâche d'un rappel
//   { action: 'reconcilier' } rapatrie ce qui a été coché côté Todoist

import { createClient } from 'jsr:@supabase/supabase-js@2'

const API = 'https://api.todoist.com/api/v1'
const PROJET_DEFAUT = '6gV777C2cJHhG26w' // « 👥 Suivi clients »

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // supabase-js ajoute x-client-info et x-supabase-api-version. Absents
      // d'ici, le contrôle préalable CORS échoue et l'appel depuis l'app meurt
      // en « Failed to fetch », alors qu'un curl passe.
      'Access-Control-Allow-Headers':
        'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    },
  })

const nomClient = (c: Record<string, unknown> | null) =>
  c ? [c.prenom_praticien, c.nom_praticien].filter(Boolean).join(' ') : 'Client'

// Décalage horaire de Paris à la date donnée. Calculé et non codé en dur :
// entre mars et octobre la France est à +02:00, le reste de l'année à +01:00,
// et un rappel de novembre posé en août sonnerait une heure trop tôt.
const decalageParis = (dateISO: string) => {
  const midi = new Date(`${dateISO}T12:00:00Z`)
  const nom = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    timeZoneName: 'longOffset',
  })
    .formatToParts(midi)
    .find((p) => p.type === 'timeZoneName')?.value
  const decale = nom?.replace('GMT', '') ?? ''
  return decale || '+01:00'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  const jeton = Deno.env.get('TODOIST_TOKEN')
  if (!jeton) return json({ erreur: 'TODOIST_TOKEN absent des secrets du projet.' }, 503)

  let corps: { rappelId?: string; action?: string }
  try {
    corps = await req.json()
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

  // ────────────────── Todoist → Field ──────────────────
  if (corps.action === 'reconcilier') {
    const { data: suivis } = await db
      .from('rappels')
      .select('id, note, todoist_task_id')
      .is('fait_at', null)
      .not('todoist_task_id', 'is', null)

    if (!suivis?.length) return json({ traites: 0 })

    const verdicts = await Promise.all(
      suivis.map(async (r) => {
        const rep = await todoist(`/tasks/${r.todoist_task_id}`)
        // Todoist sort les tâches terminées des tâches actives : selon la
        // version elles répondent 404 ou reviennent avec un drapeau.
        if (rep.status === 404) return { r, sort: 'retire' as const }
        if (!rep.ok) return null
        const t = await rep.json()
        if (t.checked || t.is_completed || t.completed_at) return { r, sort: 'fait' as const }
        return null
      })
    )

    const clos = verdicts.filter((v): v is NonNullable<typeof v> => v !== null)
    if (!clos.length) return json({ traites: 0 })

    const maintenant = new Date().toISOString()
    for (const { r, sort } of clos) {
      await db
        .from('rappels')
        .update({
          fait_at: maintenant,
          commentaire: sort === 'fait' ? 'Coché dans Todoist' : 'Retiré depuis Todoist',
          todoist_task_id: null,
        })
        .eq('id', r.id)
    }

    return json({ traites: clos.length })
  }

  // ────────────────── Field → Todoist ──────────────────
  const rappelId = corps.rappelId
  if (!rappelId) return json({ erreur: 'rappelId manquant.' }, 400)

  const { data: rappel } = await db
    .from('rappels')
    .select(
      'id, date, heure, note, fait_at, todoist_task_id, dossiers(titre, clients(prenom_praticien, nom_praticien, nom_cabinet, ville, telephone_portable, telephone_cabinet))'
    )
    .eq('id', rappelId)
    .single()

  if (!rappel) return json({ erreur: 'Rappel introuvable.' }, 404)

  const existante = rappel.todoist_task_id

  // Rappel fait : la tâche n'a plus lieu d'être.
  if (rappel.fait_at) {
    if (existante) {
      // 404 = déjà disparue ; le résultat voulu est atteint.
      await todoist(`/tasks/${existante}`, { method: 'DELETE' }).catch(() => {})
      await db.from('rappels').update({ todoist_task_id: null }).eq('id', rappelId)
    }
    return json({ etat: 'supprime' })
  }

  const dossier = rappel.dossiers as Record<string, unknown> | null
  const client = (dossier?.clients ?? null) as Record<string, unknown> | null
  const tel = client?.telephone_portable ?? client?.telephone_cabinet ?? null

  // Avec heure, Todoist notifie à l'heure dite ; sans, en début de journée.
  // Les deux champs s'excluent : envoyer l'un doit effacer l'autre, sinon une
  // heure retirée dans Field resterait dans Todoist.
  const quand = rappel.heure
    ? {
        due_datetime: `${rappel.date}T${String(rappel.heure).slice(0, 8)}${decalageParis(rappel.date)}`,
        due_date: null,
      }
    : { due_date: rappel.date, due_datetime: null }

  const tache = {
    content: `${nomClient(client)} — ${rappel.note || dossier?.titre || 'à rappeler'}`,
    description: [
      client?.nom_cabinet,
      client?.ville,
      tel ? `Tél. ${tel}` : null,
      dossier?.titre && dossier.titre !== rappel.note ? dossier.titre : null,
    ]
      .filter(Boolean)
      .join('\n'),
    ...quand,
    priority: 3, // p2 dans l'interface : à traiter, sans être urgent.
  }

  if (existante) {
    const rep = await todoist(`/tasks/${existante}`, {
      method: 'POST',
      body: JSON.stringify(tache),
    })
    if (rep.ok) return json({ etat: 'maj', taskId: existante })
    // Supprimée ou cochée entre-temps : on la recrée plutôt que de laisser le
    // rappel muet.
    if (rep.status !== 404) return json({ erreur: `Todoist a répondu ${rep.status}.` }, 502)
  }

  const rep = await todoist('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      ...tache,
      project_id: Deno.env.get('TODOIST_PROJECT_ID') ?? PROJET_DEFAUT,
    }),
  })
  if (!rep.ok) return json({ erreur: `Todoist a répondu ${rep.status}.` }, 502)

  const creee = await rep.json()
  await db.from('rappels').update({ todoist_task_id: creee.id }).eq('id', rappelId)

  return json({ etat: 'cree', taskId: creee.id })
})
