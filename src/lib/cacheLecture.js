// Cache de lecture léger pour la consultation hors-ligne : conserve les
// dernières fiches consultées dans localStorage, pour qu'elles restent
// lisibles sans réseau. Pas un cache de tout le CRM — juste ce qui a été
// ouvert récemment, borné à un nombre fixe d'entrées (les plus anciennes
// sont purgées au-delà).
const PREFIXE = 'fv9:cache:'
const CLE_INDEX = 'fv9:cache:index'
const MAX_ENTREES = 30

const lireIndex = () => {
  try {
    return JSON.parse(localStorage.getItem(CLE_INDEX) ?? '[]')
  } catch {
    return []
  }
}

const ecrireIndex = (index) => {
  try {
    localStorage.setItem(CLE_INDEX, JSON.stringify(index))
  } catch {
    // localStorage plein ou indisponible (navigation privée, quota atteint) :
    // le cache devient simplement inopérant, jamais une erreur qui remonte.
  }
}

// Place la clé en tête de l'index (plus récemment consultée) et purge les
// entrées au-delà de MAX_ENTREES.
const toucherIndex = (cle) => {
  const index = lireIndex().filter((c) => c !== cle)
  index.unshift(cle)
  const perimees = index.slice(MAX_ENTREES)
  perimees.forEach((c) => localStorage.removeItem(PREFIXE + c))
  ecrireIndex(index.slice(0, MAX_ENTREES))
}

export const ecrireCache = (cle, valeur) => {
  try {
    localStorage.setItem(
      PREFIXE + cle,
      JSON.stringify({ valeur, horodatage: new Date().toISOString() })
    )
    toucherIndex(cle)
  } catch {
    // Voir ecrireIndex ci-dessus.
  }
}

export const lireCache = (cle) => {
  try {
    const brut = localStorage.getItem(PREFIXE + cle)
    return brut ? JSON.parse(brut) : null
  } catch {
    return null
  }
}

/**
 * Essaie `fetchFn`. En cas d'échec (réseau coupé), retombe sur la dernière
 * version connue dans le cache si elle existe. Ne masque jamais l'origine de
 * la valeur : le résultat porte toujours `depuisCache`, pour que l'appelant
 * affiche un indicateur si besoin. Si `fetchFn` échoue et qu'aucun cache
 * n'existe, l'erreur d'origine remonte telle quelle.
 */
export async function lireAvecCache(cle, fetchFn) {
  try {
    const valeur = await fetchFn()
    ecrireCache(cle, valeur)
    return { valeur, depuisCache: false, horodatage: null }
  } catch (erreur) {
    const secours = lireCache(cle)
    if (secours) {
      return { valeur: secours.valeur, depuisCache: true, horodatage: secours.horodatage }
    }
    throw erreur
  }
}
