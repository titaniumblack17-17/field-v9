// navigator.onLine reste bloqué sur sa dernière valeur connue en PWA
// installée iOS pendant une coupure réseau réelle (mode avion via le Centre
// de contrôle) — bug WebKit documenté et non corrigé (voir bugs.webkit.org
// #171277 et #225645). Impossible donc de se fier à cette propriété, ni aux
// événements 'online'/'offline' qui en dépendent, pour savoir si l'app peut
// réellement joindre Supabase. `verifierConnexionReelle` pose la question
// directement au réseau plutôt qu'au navigateur.
const DELAI_PAR_DEFAUT_MS = 5000

/**
 * Vérifie la connexion réelle en tentant une requête légère vers Supabase.
 * `true` dès qu'une réponse HTTP arrive, quel que soit son code — même un
 * 401 sans clé API prouve que le DNS, le TLS et le réseau ont fonctionné.
 * `false` si la requête échoue ou dépasse `delaiMs` (coupure réelle, ou
 * requête qui traîne trop pour être utile ici).
 */
export async function verifierConnexionReelle(delaiMs = DELAI_PAR_DEFAUT_MS) {
  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), delaiMs)
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      signal: controleur.signal,
      cache: 'no-store',
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(minuteur)
  }
}
