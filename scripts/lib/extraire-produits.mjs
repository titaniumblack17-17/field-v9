// Une ligne compte comme un produit si elle porte un code (colonne 0) ET un
// prix conseillé numérique (colonne du prix) — les lignes de titre de section
// (« 1. Supports du patient supplémentaires ») et la ligne de totaux juste
// après l'en-tête n'ont ni l'un ni l'autre, et sont donc ignorées sans règle
// spéciale : le même filtre les exclut naturellement.
//
// Deux formes d'en-tête sont reconnues dans le tarif Planmeca :
//  - « Code » (la grande majorité des feuilles) : code@0, désignation@1,
//    instruction@2, prix conseillé@4, prix d'offre optionnel@5.
//  - « Feature » (feuilles « TPMOY Equipements » et « TPMOY Retrofits » :
//    licences logicielles et pièces de rétrofit) : code@0, désignation@1, pas
//    de colonne d'offre. Ni la colonne de prix ni celle d'instruction ne sont
//    à un index fixe (l'ordre varie selon la feuille) : les deux sont
//    repérées par leur libellé dans la ligne d'en-tête plutôt que par une
//    position supposée, pour ne pas perdre silencieusement une colonne si un
//    futur fichier tarif change l'ordre.
export function extraireProduitsDeFeuille(lignes) {
  const indexEntete = lignes.findIndex((ligne) => {
    const premiereCase = String(ligne?.[0] ?? '').trim()
    return premiereCase === 'Code' || premiereCase === 'Feature'
  })
  if (indexEntete === -1) return []

  const ligneEntete = lignes[indexEntete]
  const formatCode = String(ligneEntete[0]).trim() === 'Code'

  let colonneInstruction
  let colonnePrix
  let colonneOffre
  let periodeOffreTexte

  if (formatCode) {
    colonneInstruction = 2
    colonnePrix = 4
    colonneOffre = 5
    const periodeOffreBrute = ligneEntete[5]
    periodeOffreTexte =
      typeof periodeOffreBrute === 'string' && periodeOffreBrute.trim()
        ? periodeOffreBrute.trim()
        : null
  } else {
    colonnePrix = ligneEntete.findIndex((cellule) => String(cellule ?? '').trim() === 'Price €')
    if (colonnePrix === -1) {
      throw new Error('Feature header found but no "Price €" column — cannot parse this sheet.')
    }
    // Repérée par libellé (correspond à « Instruction » comme à « Instructions,
    // comments »), pas par position : certaines feuilles n'ont pas cette
    // colonne du tout, auquel cas l'instruction reste nulle pour chaque ligne.
    colonneInstruction = ligneEntete.findIndex((cellule) => /instruction/i.test(String(cellule ?? '')))
    if (colonneInstruction === -1) colonneInstruction = null
    colonneOffre = null
    periodeOffreTexte = null
  }

  const produits = []
  for (const ligne of lignes.slice(indexEntete + 1)) {
    const code = ligne?.[0]
    const prixConseille = ligne?.[colonnePrix]
    if (code == null || String(code).trim() === '') continue
    if (typeof prixConseille !== 'number' || !Number.isFinite(prixConseille)) continue

    const prixOffre =
      colonneOffre != null &&
      typeof ligne[colonneOffre] === 'number' &&
      Number.isFinite(ligne[colonneOffre])
        ? ligne[colonneOffre]
        : null

    produits.push({
      code: String(code).trim(),
      designation: String(ligne[1] ?? '').trim() || String(code).trim(),
      instruction:
        colonneInstruction != null &&
        ligne[colonneInstruction] != null &&
        String(ligne[colonneInstruction]).trim()
          ? String(ligne[colonneInstruction]).trim()
          : null,
      prixConseille,
      prixOffre,
      offrePeriode: prixOffre != null ? periodeOffreTexte : null,
    })
  }
  return produits
}
