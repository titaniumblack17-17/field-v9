// Une ligne compte comme un produit si elle porte un code (colonne 0) ET un
// prix conseillé numérique (colonne 4) — les lignes de titre de section
// (« 1. Supports du patient supplémentaires ») et la ligne de totaux juste
// après l'en-tête n'ont ni l'un ni l'autre, et sont donc ignorées sans règle
// spéciale : le même filtre les exclut naturellement.
export function extraireProduitsDeFeuille(lignes) {
  const indexEntete = lignes.findIndex((ligne) => String(ligne?.[0] ?? '').trim() === 'Code')
  if (indexEntete === -1) return []

  const periodeOffreBrute = lignes[indexEntete][5]
  const periodeOffreTexte =
    typeof periodeOffreBrute === 'string' && periodeOffreBrute.trim()
      ? periodeOffreBrute.trim()
      : null

  const produits = []
  for (const ligne of lignes.slice(indexEntete + 1)) {
    const code = ligne?.[0]
    const prixConseille = ligne?.[4]
    if (code == null || String(code).trim() === '') continue
    if (typeof prixConseille !== 'number' || !Number.isFinite(prixConseille)) continue

    const prixOffre =
      typeof ligne[5] === 'number' && Number.isFinite(ligne[5]) ? ligne[5] : null

    produits.push({
      code: String(code).trim(),
      designation: String(ligne[1] ?? '').trim() || String(code).trim(),
      instruction:
        ligne[2] != null && String(ligne[2]).trim() ? String(ligne[2]).trim() : null,
      prixConseille,
      prixOffre,
      offrePeriode: prixOffre != null ? periodeOffreTexte : null,
    })
  }
  return produits
}
