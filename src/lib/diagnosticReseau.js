// Journal de diagnostic temporaire pour investiguer un bug de détection
// réseau en PWA installée iOS (session du 30/08/2026 — le vidage automatique
// de la file d'écriture ne se déclenche pas après un cycle mode avion via le
// Centre de contrôle). Purement passif : n'intercepte rien, ne modifie aucun
// comportement existant — se contente de journaliser dans localStorage ce
// qui se passe réellement sur l'appareil, pour comparer avec ce que le code
// suppose. Actif uniquement derrière ?debug=reseau (voir DiagnosticReseau.jsx
// et App.jsx). À retirer une fois la cause confirmée et le vrai correctif
// posé.
const CLE = 'fv9:diag-reseau'
const MAX_ENTREES = 150
const ecouteurs = new Set()

const lire = () => {
  try {
    return JSON.parse(localStorage.getItem(CLE) ?? '[]')
  } catch {
    return []
  }
}

const ecrire = (journal) => {
  try {
    localStorage.setItem(CLE, JSON.stringify(journal))
  } catch {
    // Quota localStorage atteint : le journal s'arrête là, tant pis pour ce
    // diagnostic — ne doit jamais faire planter l'app.
  }
  ecouteurs.forEach((cb) => cb(journal))
}

export const journaliser = (evenement, extra = {}) => {
  const journal = lire()
  journal.push({
    n: journal.length + 1,
    evenement,
    horodatage: new Date().toISOString(),
    enLigne: navigator.onLine,
    visibilite: document.visibilityState,
    ...extra,
  })
  ecrire(journal.slice(-MAX_ENTREES))
}

export const lireJournal = () => lire()

export const viderJournal = () => ecrire([])

// Pour le panneau d'affichage : notifie à chaque nouvelle entrée, retourne
// la fonction de désabonnement.
export const ecouterJournal = (callback) => {
  ecouteurs.add(callback)
  return () => ecouteurs.delete(callback)
}
