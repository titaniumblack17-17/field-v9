// Une note dictée en plein appel ressemble souvent à une liste numérotée
// ("1 - ... 2 - ...") sans que Bruce ait rien fait de spécial pour ça —
// juste sa façon habituelle de prendre plusieurs points d'un coup. Le motif
// reconnaît puces (-, •, *) et numéros (1-, 1., 1)) en début de ligne.
const MOTIF_LIGNE_LISTE = /^\s*(?:\d+\s*[.)-]|[-•*])\s+(.+)$/

// Sépare une note en lignes de liste (candidates à devenir des tâches) et le
// reste du texte (contexte libre, conservé tel quel). N'importe quoi peut
// venir avant/après/entre les points — chaque ligne est jugée seule, pas la
// structure globale.
export function extrairePoints(texte) {
  const lignes = (texte ?? '').split('\n')
  const points = []
  const reste = []
  for (const ligne of lignes) {
    const correspondance = ligne.match(MOTIF_LIGNE_LISTE)
    if (correspondance) points.push(correspondance[1].trim())
    else if (ligne.trim()) reste.push(ligne)
  }
  return { points, resteTexte: reste.join('\n').trim() }
}
