import { supabase } from './supabaseClient'

/**
 * Un rappel du 2 mars et un rappel du 2 décembre ne demandent pas la même
 * chose. Affichés tous deux dans la même couleur et en date ISO, ils se
 * confondent : « 2026-03-02 » ne dit pas qu'on a cent soixante-treize jours
 * de retard.
 */
export function etatRappel(date) {
  if (!date) return null

  const jour = new Date(date + 'T00:00:00')
  if (Number.isNaN(jour.getTime())) return null

  const aujourdhui = new Date()
  aujourdhui.setHours(0, 0, 0, 0)

  const jours = Math.round((jour - aujourdhui) / 86400000)
  const affiche = jour.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })

  if (jours < 0) {
    const retard = -jours
    return {
      texte: retard === 1 ? 'En retard depuis hier' : `En retard de ${retard} jours`,
      classe: 'text-erreur font-medium',
      echu: true,
    }
  }
  if (jours === 0) {
    return { texte: "À rappeler aujourd'hui", classe: 'text-alerte font-medium', echu: true }
  }
  if (jours <= 7) {
    return { texte: `À rappeler le ${affiche}`, classe: 'text-alerte', echu: false }
  }
  // Bleu et non vert : le vert annonce une chose réglée. Un rappel encore à
  // honorer qui s'affiche en vert se lit « c'est fait » d'un coup d'œil.
  return { texte: `Rappel le ${affiche}`, classe: 'text-accent', echu: false }
}

/** Aligne la tâche Todoist d'un rappel. Ne lève jamais : un rappel qui ne part
 *  pas ne doit pas faire échouer la saisie, seulement se signaler. */
export async function synchroniserRappel(rappelId) {
  const { data, error } = await supabase.functions.invoke('todoist-rappel', {
    body: { rappelId },
  })
  if (!error) return data
  try {
    const corps = await error.context?.json()
    if (corps?.erreur) return { erreur: corps.erreur }
  } catch {
    /* corps illisible */
  }
  return { erreur: error.message }
}

/** Rapatrie ce qui a été coché côté Todoist. */
export async function reconcilierRappels() {
  const { data, error } = await supabase.functions.invoke('todoist-rappel', {
    body: { action: 'reconcilier' },
  })
  return error ? { erreur: error.message } : data
}

export async function ajouterRappel(dossierId, date, note) {
  const { data, error } = await supabase
    .from('rappels')
    .insert({ dossier_id: dossierId, date, note: note?.trim() || null })
    .select()
    .single()
  if (error) return { erreur: error.message }
  await synchroniserRappel(data.id)
  return data
}

/**
 * Clôt un rappel. Le commentaire reste attaché au rappel plutôt que de partir
 * au journal général : c'est la suite des rappels qui se relit, et un
 * commentaire noyé parmi les notes du dossier ne raconterait plus rien.
 */
export async function cloreRappel(rappelId, commentaire) {
  const { error } = await supabase
    .from('rappels')
    .update({ fait_at: new Date().toISOString(), commentaire: commentaire?.trim() || null })
    .eq('id', rappelId)
  if (error) return { erreur: error.message }
  // fait_at est posé : la fonction supprime la tâche au lieu d'en créer une.
  return synchroniserRappel(rappelId)
}

/** Clôt le prochain rappel ouvert d'un dossier — utilisé depuis le Brief, qui
 *  ne connaît que le dossier. */
export async function cloreProchainRappel(dossierId, commentaire) {
  const { data } = await supabase
    .from('rappels')
    .select('id')
    .eq('dossier_id', dossierId)
    .is('fait_at', null)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return { erreur: 'Aucun rappel ouvert.' }
  return cloreRappel(data.id, commentaire)
}

/**
 * Retire de Todoist les tâches des rappels encore ouverts sur ces dossiers.
 *
 * À appeler avant de supprimer un dossier ou un client : la cascade efface les
 * rappels en base, mais Todoist continuerait de sonner pour une affaire qui
 * n'existe plus.
 */
export async function retirerRappelsTodoist(dossierIds) {
  if (!dossierIds?.length) return
  const { data } = await supabase
    .from('rappels')
    .select('id')
    .in('dossier_id', dossierIds)
    .is('fait_at', null)
    .not('todoist_task_id', 'is', null)

  for (const r of data ?? []) {
    await supabase.from('rappels').update({ fait_at: new Date().toISOString() }).eq('id', r.id)
    await synchroniserRappel(r.id)
  }
}
