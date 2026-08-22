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
  return { texte: `Rappel le ${affiche}`, classe: 'text-texte-faible', echu: false }
}
