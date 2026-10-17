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
