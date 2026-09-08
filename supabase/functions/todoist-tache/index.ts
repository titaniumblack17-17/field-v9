// Sous-tâches de note (dossier_note_taches) dans Todoist — uniquement au
// passage en retard, jamais à la création. Plusieurs sous-tâches naissent
// souvent d'un coup depuis une seule note dictée : les pousser toutes vers
// Todoist dès leur création inonderait l'agenda de Bruce pour des choses
// encore loin devant lui. Todoist n'entre en jeu qu'au moment où une tâche
// bascule réellement en retard — même moment que la section « Tâches en
// retard » de BriefSoir, dont ce fichier réutilise exactement la définition
// (échéance <= aujourd'hui, pas cochée).
//
//   { tacheId }                aligne UNE tâche sur son état actuel : crée
//                               si en retard et pas encore liée, ferme si
//                               cochée et liée. Appelée depuis l'app (Brief
//                               à l'ouverture, coche d'une tâche).
//   { action: 'balayer' }      appelée par le job planifié (pg_cron, une
//                               fois par jour) : réconcilie d'abord ce qui a
//                               été coché côté Todoist, puis crée les tâches
//                               fraîchement en retard. C'est ce passage qui
//                               garantit la notification même si Bruce
//                               n'ouvre pas l'app ce jour-là.
//   { action: 'reconcilier' }  rapatrie seul ce qui a été coché côté
//                               Todoist (sous-ensemble de 'balayer').
//
// Pas de vérification JWT (verify_jwt: false, même posture que
// capture-intake) : appelée aussi bien depuis l'app que depuis pg_cron, qui
// n'a pas de session utilisateur à faire valoir.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const API = 'https://api.todoist.com/api/v1'
const PROJET_DEFAUT = '6gV777C2cJHhG26w' // « 👥 Suivi clients »

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    },
  })

const nomClient = (c: Record<string, unknown> | null) =>
  c ? [c.prenom_praticien, c.nom_praticien].filter(Boolean).join(' ') : 'Client'

// Date du jour à Paris, pas UTC — même piège que aujourdhui()/dansNJoursOuvres
// côté client (rappel.js, corrigé le 07/09) : minuit à Paris tombe la veille
// en UTC une bonne partie de l'année, ce qui ferait détecter un retard un
// jour trop tôt ou trop tard selon l'heure du passage du job.
const aujourdhuiParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())

type Tache = {
  id: string
  texte: string
  echeance: string | null
  fait: boolean
  todoist_task_id: string | null
  dossiers: {
    titre: string | null
    clients: {
      prenom_praticien: string | null
      nom_praticien: string | null
      nom_cabinet: string | null
      ville: string | null
    } | null
  } | null
}

const SELECT_TACHE =
  'id, texte, echeance, fait, todoist_task_id, dossiers(titre, clients(prenom_praticien, nom_praticien, nom_cabinet, ville))'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  const jeton = Deno.env.get('TODOIST_TOKEN')
  if (!jeton) return json({ erreur: 'TODOIST_TOKEN absent des secrets du projet.' }, 503)

  let corps: { tacheId?: string; action?: string }
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

  const creerPourTache = async (t: Tache) => {
    const dossier = t.dossiers
    const client = dossier?.clients ?? null
    const rep = await todoist('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        content: `${nomClient(client)} — ${t.texte}`,
        description: [dossier?.titre, client?.nom_cabinet, client?.ville].filter(Boolean).join('\n'),
        due_date: t.echeance,
        priority: 3, // p2 dans l'interface : à traiter, sans être urgent.
        project_id: Deno.env.get('TODOIST_PROJECT_ID') ?? PROJET_DEFAUT,
      }),
    })
    if (!rep.ok) return null
    const creee = await rep.json()
    await db.from('dossier_note_taches').update({ todoist_task_id: creee.id }).eq('id', t.id)
    return creee.id as string
  }

  // ────────────────── Todoist → Field (cochée sur la montre) ──────────────────
  const reconcilier = async () => {
    const { data: liees } = await db
      .from('dossier_note_taches')
      .select('id, todoist_task_id')
      .eq('fait', false)
      .not('todoist_task_id', 'is', null)

    if (!liees?.length) return 0

    const verdicts = await Promise.all(
      liees.map(async (t) => {
        const rep = await todoist(`/tasks/${t.todoist_task_id}`)
        // Todoist sort les tâches terminées des tâches actives : selon la
        // version elle répond 404 ou revient avec un drapeau.
        if (rep.status === 404) return t
        if (!rep.ok) return null
        const j = await rep.json()
        if (j.checked || j.is_completed || j.completed_at) return t
        return null
      })
    )

    const clos = verdicts.filter((v): v is NonNullable<typeof v> => v !== null)
    for (const t of clos) {
      await db.from('dossier_note_taches').update({ fait: true, todoist_task_id: null }).eq('id', t.id)
    }
    return clos.length
  }

  // ────────────────── Field → Todoist (fraîchement en retard) ──────────────────
  const balayerEnRetard = async () => {
    const aujourdhui = aujourdhuiParis()
    const { data: candidates } = await db
      .from('dossier_note_taches')
      .select(SELECT_TACHE)
      .eq('fait', false)
      .is('todoist_task_id', null)
      .not('echeance', 'is', null)
      .lte('echeance', aujourdhui)

    if (!candidates?.length) return 0
    let n = 0
    for (const t of candidates as unknown as Tache[]) {
      if (await creerPourTache(t)) n++
    }
    return n
  }

  if (corps.action === 'balayer') {
    const reconciliees = await reconcilier()
    const creees = await balayerEnRetard()
    return json({ reconciliees, creees })
  }

  if (corps.action === 'reconcilier') {
    return json({ traites: await reconcilier() })
  }

  // ────────────────── Une seule tâche, appelée depuis l'app ──────────────────
  const tacheId = corps.tacheId
  if (!tacheId) return json({ erreur: 'tacheId manquant.' }, 400)

  const { data: tache } = await db
    .from('dossier_note_taches')
    .select(SELECT_TACHE)
    .eq('id', tacheId)
    .single()

  if (!tache) return json({ erreur: 'Tâche introuvable.' }, 404)
  const t = tache as unknown as Tache

  // Cochée : la tâche Todoist n'a plus lieu d'être.
  if (t.fait) {
    if (t.todoist_task_id) {
      // 404 = déjà disparue ; le résultat voulu est atteint.
      await todoist(`/tasks/${t.todoist_task_id}`, { method: 'DELETE' }).catch(() => {})
      await db.from('dossier_note_taches').update({ todoist_task_id: null }).eq('id', tacheId)
    }
    return json({ etat: 'supprime' })
  }

  if (t.todoist_task_id) return json({ etat: 'deja_lie' })

  const enRetard = t.echeance && t.echeance <= aujourdhuiParis()
  if (!enRetard) return json({ etat: 'pas_en_retard' })

  const id = await creerPourTache(t)
  return id ? json({ etat: 'cree', taskId: id }) : json({ erreur: 'Todoist a refusé la création.' }, 502)
})
