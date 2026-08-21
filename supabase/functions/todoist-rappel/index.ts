// Pousse le rappel d'un dossier vers Todoist, et l'y retire.
//
// Field reste la source de vérité : Todoist ne sert que de réveil-matin. On
// n'y recopie donc ni le pipeline, ni les montants, ni les équipements — juste
// « qui rappeler, quand, et à quel numéro ».
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
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    },
  })

const nomClient = (c: Record<string, unknown> | null) =>
  c ? [c.prenom_praticien, c.nom_praticien].filter(Boolean).join(' ') : 'Client'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  const jeton = Deno.env.get('TODOIST_TOKEN')
  if (!jeton) {
    return json(
      { erreur: 'TODOIST_TOKEN absent des secrets du projet Supabase.' },
      503
    )
  }

  let dossierId: string
  try {
    dossierId = (await req.json()).dossierId
  } catch {
    return json({ erreur: 'Corps JSON invalide.' }, 400)
  }
  if (!dossierId) return json({ erreur: 'dossierId manquant.' }, 400)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: dossier, error } = await db
    .from('dossiers')
    .select(
      'id, titre, type, rappel_date, rappel_note, todoist_task_id, clients(prenom_praticien, nom_praticien, nom_cabinet, ville, telephone_portable, telephone_cabinet)'
    )
    .eq('id', dossierId)
    .single()

  if (error || !dossier) return json({ erreur: 'Dossier introuvable.' }, 404)

  const todoist = (chemin: string, init: RequestInit = {}) =>
    fetch(`${API}${chemin}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${jeton}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })

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

  const corps = {
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
      body: JSON.stringify(corps),
    })
    if (r.ok) return json({ etat: 'maj', taskId: existant })
    // Supprimée ou cochée dans Todoist entre-temps : on la recrée plutôt que
    // de laisser le rappel muet.
    if (r.status !== 404) {
      return json({ erreur: `Todoist a répondu ${r.status}.` }, 502)
    }
  }

  const r = await todoist('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      ...corps,
      project_id: Deno.env.get('TODOIST_PROJECT_ID') ?? PROJET_DEFAUT,
    }),
  })

  if (!r.ok) {
    return json({ erreur: `Todoist a répondu ${r.status}.` }, 502)
  }

  const tache = await r.json()
  await db.from('dossiers').update({ todoist_task_id: tache.id }).eq('id', dossierId)

  return json({ etat: 'cree', taskId: tache.id })
})
