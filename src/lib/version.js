import { ecouterTailleFile, tailleFile } from './fileAttente'

// Identité du build, injectée par vite.config.js (voir là-bas). Sans injection (tests unitaires, outil externe) :
// valeurs neutres, jamais d'exception.
/* global __BUILD_COMMIT__, __BUILD_TIME__ */
export const VERSION = {
  commit: typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'local',
  builtAt: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date(0).toISOString(),
}

export const HOTE_PRODUCTION = 'field-v9.vercel.app'

/** « 14/10 16:00 », heure de Paris. */
export const dateCourte = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  )
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`
}

export const libelleVersion = (v = VERSION) => `Version ${v.commit} · ${dateCourte(v.builtAt)}`

/**
 * Adresse de test : tout hôte autre que la production. Le poste de développement (localhost) n'en est pas une : il
 * n'est pas joignable depuis l'iPhone, personne ne peut le confondre avec la production.
 */
export const estAdresseDeTest = (hote) =>
  hote !== HOTE_PRODUCTION && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(hote)

/** Une version en ligne plus récente : commit différent ET construite après la nôtre (un retour arrière n'en est pas une). */
export const estPlusRecente = (distante, locale = VERSION) =>
  Boolean(distante?.commit) &&
  distante.commit !== locale.commit &&
  Date.parse(distante.builtAt) > Date.parse(locale.builtAt)

/** version.json en ligne, ou null (hors ligne, erreur, réponse qui n'est pas du JSON de version). Jamais d'exception. */
export async function lireVersionEnLigne() {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const v = await r.json()
    return v && typeof v.commit === 'string' && typeof v.builtAt === 'string' ? v : null
  } catch {
    return null
  }
}

/**
 * Recharge la page, mais seulement quand plus aucune écriture n'attend dans la file hors ligne : recharger avant
 * l'envoi n'en perdrait rien (la file vit dans localStorage), mais on ne coupe pas un rejeu en cours. Retourne une
 * fonction d'annulation. `viderCaches` : vide aussi le cache du service worker avant de recharger.
 */
export function rechargerQuandFileVide({ viderCaches = false, auRechargement = () => window.location.reload() } = {}) {
  let desabonner = () => {}
  let fait = false
  const aller = async () => {
    if (fait) return
    fait = true
    desabonner()
    if (viderCaches && window.caches) {
      try {
        const cles = await caches.keys()
        await Promise.all(cles.map((c) => caches.delete(c)))
      } catch {
        // cache inaccessible : le rechargement suffit, le service worker est réseau d'abord
      }
    }
    auRechargement()
  }
  if (tailleFile() === 0) {
    aller()
  } else {
    desabonner = ecouterTailleFile((n) => n === 0 && aller())
  }
  return () => {
    fait = true
    desabonner()
  }
}
