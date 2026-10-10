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
 * `true` dès qu'une réponse HTTP arrive, quel que soit son code — le DNS, le
 * TLS et le réseau ont fonctionné. La sonde porte la clé publique et vise une
 * route de données (la racine /rest/v1/ répond 401 même avec la clé, ce qui
 * laissait une erreur rouge en console à chaque retour de réseau).
 * `false` si la requête échoue ou dépasse `delaiMs` (coupure réelle, ou
 * requête qui traîne trop pour être utile ici).
 */
export async function verifierConnexionReelle(delaiMs = DELAI_PAR_DEFAUT_MS) {
  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), delaiMs)
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/clients?select=id&limit=1`, {
      method: 'HEAD',
      headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
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
