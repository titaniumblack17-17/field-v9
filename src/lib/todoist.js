import { supabase } from './supabaseClient'

/**
 * Aligne la tâche Todoist du dossier sur son rappel : création, mise à jour ou
 * suppression selon ce que Field contient. Le jeton reste côté serveur — l'app
 * n'envoie qu'un identifiant.
 *
 * Ne lève jamais : un rappel qui ne part pas ne doit pas faire échouer
 * l'enregistrement du dossier, seulement se signaler.
 */
export async function synchroniserRappel(dossierId) {
  return appeler({ dossierId })
}

/**
 * Rapatrie ce qui a été traité côté Todoist : une tâche cochée sur la montre
 * doit fermer le rappel dans Field, sinon le Brief continue de réclamer un
 * appel déjà passé.
 */
export async function reconcilierRappels() {
  return appeler({ action: 'reconcilier' })
}

async function appeler(body) {
  const { data, error } = await supabase.functions.invoke('todoist-rappel', { body })

  if (!error) return data

  // supabase-js réduit toute réponse non-2xx à « non-2xx status code ». Le
  // motif réel (jeton absent, Todoist injoignable) n'est que dans le corps.
  try {
    const corps = await error.context?.json()
    if (corps?.erreur) return { erreur: corps.erreur }
  } catch {
    /* corps illisible : on retombe sur le message générique */
  }
  return { erreur: error.message }
}
