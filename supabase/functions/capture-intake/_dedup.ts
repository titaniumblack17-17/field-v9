// Extrait déposé pour mémoire : logique anti-doublon insérée dans index.ts.
// Une dictée coupée en plein milieu se refait, et la seconde tentative créait
// jusqu'ici une fiche de plus au lieu de compléter la première.

export const normaliser = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(dr|docteur)\s+/, '')
    .trim()

/**
 * Cherche un client déjà enregistré portant le même nom de praticien. Les
 * prénoms doivent concorder, ou l'un des deux être absent : deux praticiens
 * homonymes avec des prénoms différents restent deux fiches distinctes.
 */
export const trouverExistant = (
  clients: Array<Record<string, unknown>>,
  nom: string,
  prenom: string | null
) => {
  const n = normaliser(nom)
  const p = normaliser(prenom)
  return clients.find((c) => {
    if (normaliser(c.nom_praticien) !== n) return false
    const cp = normaliser(c.prenom_praticien)
    return !cp || !p || cp === p
  })
}
