/**
 * Un rappel du 2 mars et un rappel du 2 décembre ne demandent pas la même
 * chose. Affichés tous deux dans la même couleur et en date ISO, ils se
 * confondent : « 2026-03-02 » ne dit pas qu'on a cent soixante-treize jours
 * de retard.
 *
 * Renvoie null si aucun rappel n'est posé.
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

/**
 * Clôt un rappel depuis Field : la date part, le journal en garde trace, et la
 * tâche Todoist est retirée.
 *
 * Sans trace au journal, un rappel qui disparaît ne dit pas s'il a été honoré
 * ou effacé par mégarde — et c'est justement ce qu'on veut pouvoir relire six
 * mois plus tard.
 */
export async function marquerRappelFait(dossier) {
  const { supabase } = await import('./supabaseClient')
  const { synchroniserRappel } = await import('./todoist')

  const quoi = dossier.rappel_note || dossier.titre
  await supabase.from('dossier_notes').insert({
    dossier_id: dossier.id,
    texte: `Rappel fait${quoi ? ` — ${quoi}` : ''}`,
  })

  const { error } = await supabase
    .from('dossiers')
    .update({ rappel_date: null, rappel_note: null })
    .eq('id', dossier.id)
  if (error) return { erreur: error.message }

  // La date est déjà nulle : la fonction supprime la tâche au lieu d'en créer.
  return synchroniserRappel(dossier.id)
}
