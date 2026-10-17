// Session de connexion (Supabase Auth, code à usage unique par e-mail). Ce fichier ne dépend pas du client Supabase :
// il lit seulement ce que le client a enregistré, pour décider SANS réseau s'il existe une session locale.

/** Clé de stockage de la session (réglée dans supabaseClient.js). */
export const CLE_SESSION = 'fv9-auth-token'
const CLE_DERNIER_EMAIL = 'fv9:dernier-email'
export const EMAIL_PAR_DEFAUT = 'titaniumblack17@gmail.com'

/** Durée de validité d'un code (réglage Supabase par défaut : 1 h). Sert seulement à choisir le message d'erreur. */
export const VALIDITE_CODE_MS = 60 * 60 * 1000
/** Délai avant de pouvoir redemander un code (limite d'envoi de Supabase : 1 par minute). */
export const DELAI_RENVOI_S = 60

/**
 * Session enregistrée localement, ou null. Un jeton d'accès périmé ne compte pas : seule l'absence de jeton de
 * renouvellement veut dire « pas de session ». Hors ligne, la session reste donc connue et l'app démarre.
 */
export function sessionLocale() {
  try {
    const s = JSON.parse(localStorage.getItem(CLE_SESSION) ?? 'null')
    return s && s.refresh_token ? s : null
  } catch {
    return null
  }
}

export const dernierEmail = () => {
  try {
    return localStorage.getItem(CLE_DERNIER_EMAIL) || EMAIL_PAR_DEFAUT
  } catch {
    return EMAIL_PAR_DEFAUT
  }
}
export const retenirEmail = (email) => {
  try {
    localStorage.setItem(CLE_DERNIER_EMAIL, email)
  } catch {
    // stockage indisponible : l'adresse par défaut sera proposée
  }
}

/**
 * Mode des tests automatiques : uniquement sur un serveur de DÉVELOPPEMENT lancé avec VITE_E2E_SANS_CONNEXION=1
 * (`import.meta.env.DEV` est faux dans tout build de production : ce code y est supprimé). Les scénarios qui testent la
 * connexion elle-même réactivent la vraie porte avec le drapeau local `fv9:e2e-connexion-reelle`. Jamais sur le site publié.
 */
export const connexionDesactiveePourTests = () => {
  try {
    return import.meta.env.DEV && import.meta.env.VITE_E2E_SANS_CONNEXION === '1' && localStorage.getItem('fv9:e2e-connexion-reelle') !== '1'
  } catch {
    return false
  }
}

// ── Retour du lien reçu par e-mail ────────────────────────────────────────────────────────────────
// Flux implicite : le lien ramène sur l'app avec la session dans l'adresse (#access_token=…) — elle s'ouvre donc dans
// n'importe quel navigateur, pas seulement celui qui a demandé le lien. Une erreur (lien expiré, déjà utilisé, invalide)
// revient aussi dans l'adresse (#error=access_denied&error_code=otp_expired&…) ou dans la requête.

/** Lit l'adresse d'ouverture : { jetons: bool, erreur: { code, description } | null }. Pure (testable). */
export function lireRetourLien(location) {
  const parametres = new URLSearchParams((location.hash ?? '').replace(/^#/, ''))
  for (const [cle, valeur] of new URLSearchParams(location.search ?? '')) if (!parametres.has(cle)) parametres.set(cle, valeur)
  const jetons = parametres.has('access_token') && parametres.has('refresh_token')
  const code = parametres.get('error_code') || parametres.get('error')
  const erreur = code || parametres.get('error_description') ? { code: code ?? 'unspecified', description: parametres.get('error_description') ?? '' } : null
  return { jetons, erreur }
}

/** Message affiché pour un lien refusé. Supabase répond pareil pour un lien expiré et un lien déjà utilisé. */
export function messageLien(erreur) {
  if (!erreur) return ''
  if (erreur.code === 'otp_expired' || /expired|already|used/i.test(erreur.description)) return 'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.'
  return "Ce lien n'est pas valide. Demandez-en un nouveau."
}

/** Retire les paramètres de connexion de l'adresse affichée (jetons, erreurs) sans recharger. */
export function nettoyerAdresse() {
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname)
  } catch {
    // contexte sans historique : sans conséquence
  }
}

// Lu UNE FOIS, avant que le client Supabase ne démarre. Une erreur est mémorisée puis effacée de l'adresse tout de
// suite (le client n'y verra plus de lien à traiter) ; des jetons sont laissés en place : le client les lit, ouvre la session et les efface.
const retour = typeof window !== 'undefined' ? lireRetourLien(window.location) : { jetons: false, erreur: null }
let retourLien = { erreur: retour.erreur, jetons: retour.jetons }
/** Ce que l'adresse d'ouverture contenait (valable jusqu'à ce que l'écran de connexion l'ait pris en compte). */
export const retourLienInitial = () => retourLien
export const effacerRetourLien = () => {
  retourLien = { erreur: null, jetons: false }
}
if (retour.erreur && !retour.jetons) nettoyerAdresse()

const estReseau = (err) =>
  err?.name === 'AuthRetryableFetchError' ||
  err?.status === 0 ||
  /failed to fetch|network|load failed|fetch/i.test(String(err?.message ?? '')) ||
  (typeof navigator !== 'undefined' && navigator.onLine === false)

/**
 * Message affiché pour une erreur d'envoi ou de vérification de code. `phase` : 'envoi' | 'verification'.
 * Supabase répond la même chose pour un code faux et un code périmé : on les distingue par le temps écoulé depuis l'envoi.
 */
export function messageConnexion(err, { phase, envoyeA = null, maintenant = Date.now() } = {}) {
  const texte = String(err?.message ?? '')
  if (estReseau(err)) return 'Pas de réseau. Reconnectez-vous puis réessayez.'
  if (err?.status === 429 || /rate limit|too many|security purposes|over_(email|request)_send_rate_limit/i.test(`${texte} ${err?.code ?? ''}`)) {
    return 'Trop de demandes. Patientez une minute avant de redemander un code.'
  }
  if (phase === 'envoi') {
    if (/signups? not allowed|otp_disabled|user not found/i.test(`${texte} ${err?.code ?? ''}`)) return "Cette adresse n'est pas autorisée."
    return "Impossible d'envoyer le code. Réessayez dans un instant."
  }
  if (/expired|invalid|otp_expired/i.test(`${texte} ${err?.code ?? ''}`) || err?.status === 403 || err?.status === 422) {
    if (envoyeA != null && maintenant - envoyeA > VALIDITE_CODE_MS) return 'Code expiré. Demandez-en un nouveau.'
    return 'Code incorrect. Vérifiez les 6 chiffres, ou demandez un nouveau code.'
  }
  return 'Connexion impossible. Réessayez.'
}
