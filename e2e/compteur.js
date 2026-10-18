// Compteur des requêtes Supabase d'une passe : le navigateur (via le contexte Playwright) ET les aides de test côté Node
// (fetch). Chaque test écrit ses totaux dans test-results/requetes-supabase.jsonl ; le rapporteur (reporter-requetes.js)
// les additionne en fin de passe. Les pré-vérifications CORS (OPTIONS) du navigateur n'apparaissent pas ici selon le
// cas (voir PASSATION.md) : le total réel côté serveur se mesure avec le proxy de journalisation.
import fs from 'node:fs'

export const FICHIER_COMPTEUR = 'test-results/requetes-supabase.jsonl'

let courant = new Map() // chemin normalisé -> { n, octets }

/** « REST fichiers », « RPC dashboard_chiffres », « STORAGE sign », « AUTH token », « FN todoist-rappel »… */
export function cleDeChemin(url) {
  let p
  try {
    p = new URL(url, 'http://x').pathname
  } catch {
    return String(url).slice(0, 40)
  }
  for (const [motif, fmt] of [
    [/^\/rest\/v1\/rpc\/(\w+)/, 'RPC'],
    [/^\/rest\/v1\/(\w+)/, 'REST'],
    [/^\/storage\/v1\/object\/(\w+)/, 'STORAGE'],
    [/^\/auth\/v1\/(\w+)/, 'AUTH'],
    [/^\/functions\/v1\/([\w-]+)/, 'FN'],
    [/^\/realtime\/v1\/(\w+)/, 'WS'],
  ]) {
    const m = p.match(motif)
    if (m) return `${fmt} ${m[1]}`
  }
  return p.slice(0, 40)
}

export function compter(url, octets = 0) {
  const cle = cleDeChemin(url)
  const e = courant.get(cle) ?? { n: 0, octets: 0 }
  e.n += 1
  e.octets += octets
  courant.set(cle, e)
}

/** Écrit (et remet à zéro) les totaux accumulés depuis le dernier envoi, attribués à `titre`. */
export function envoyer(titre) {
  if (courant.size === 0) return
  try {
    fs.mkdirSync('test-results', { recursive: true })
    fs.appendFileSync(FICHIER_COMPTEUR, JSON.stringify({ titre, stats: Object.fromEntries(courant) }) + '\n')
  } catch {
    // le compteur ne doit jamais faire échouer un test
  }
  courant = new Map()
}
