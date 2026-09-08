import { supabase } from './supabaseClient'

// Synchro Todoist des sous-tâches de note (dossier_note_taches) — voir
// supabase/functions/todoist-tache pour la logique complète. Côté client,
// deux appels seulement :
//
// - synchroniserTache(tacheId) : alignement d'une tâche précise. Appelée en
//   tâche de fond, jamais attendue par un geste de Bruce — ni la coche d'une
//   tâche ni l'ouverture du Brief ne doivent se sentir ralenties par
//   l'aller-retour Todoist. Ne lève jamais.
// - reconcilierTaches() : rapatrie ce qui a été coché côté Todoist, appelée
//   à l'ouverture du Brief (même geste que reconcilierRappels côté rappels).

const appeler = async (body) => {
  const { data, error } = await supabase.functions.invoke('todoist-tache', { body })
  if (!error) return data
  try {
    const corps = await error.context?.json()
    if (corps?.erreur) return { erreur: corps.erreur }
  } catch {
    /* corps illisible */
  }
  return { erreur: error.message }
}

export const synchroniserTache = (tacheId) => appeler({ tacheId })

export const reconcilierTaches = () => appeler({ action: 'reconcilier' })
