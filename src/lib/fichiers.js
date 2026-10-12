import { supabase } from './supabaseClient'
import { typeParNom } from './documents'

export const TAILLE_MAX = 25 * 1024 * 1024

const EXTENSION_PAR_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

// Safari iOS livre parfois un fichier sans type MIME (PDF enregistré depuis
// WhatsApp dans Fichiers, HEIC…). Envoyé tel quel, le dépôt le refuse ou le
// range en octet-stream : on déduit alors le type de l'extension.
const MIME_PAR_EXTENSION = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
}
const extensionDe = (nom) => (nom.includes('.') ? nom.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '')
export const typeMime = (fichier, nom) => fichier.type || MIME_PAR_EXTENSION[extensionDe(nom)] || ''

// Traduit une erreur du dépôt ou du réseau en message lisible, jamais muet.
const messageEnvoi = (nom, err) => {
  const brut = String(err?.message ?? err ?? '')
  if (/failed to fetch|network|load failed|fetch/i.test(brut)) {
    return `Pas de réseau : « ${nom} » n’a pas été envoyé. Réessayez une fois reconnecté.`
  }
  if (/mime|not supported|invalid/i.test(brut)) return `« ${nom} » : format non accepté (PDF ou image uniquement).`
  if (/size|exceed|too large|payload/i.test(brut)) return `« ${nom} » dépasse la limite de 25 Mo.`
  return `« ${nom} » n’a pas pu être envoyé (${brut || 'erreur inconnue'}).`
}

// Un fichier collé (capture d'écran, image copiée) arrive souvent sans nom
// exploitable — ou avec un nom générique imposé par le navigateur (« image.png »
// quel que soit le contenu). L'horodatage reste le seul repère fiable pour le
// retrouver ensuite dans la liste ; l'extension vient du type MIME plutôt que
// du nom, absent ou trompeur dans ce cas.
const nommer = (fichier) => {
  if (fichier.name?.trim()) return fichier.name
  const ext = EXTENSION_PAR_TYPE[fichier.type] ?? 'bin'
  const maintenant = new Date()
  const date = maintenant.toLocaleDateString('fr-FR').replace(/\//g, '-')
  const heure = maintenant
    .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    .replace(':', 'h')
  return `Collé le ${date} ${heure}.${ext}`
}

/**
 * Envoie un fichier (choisi via le sélecteur, ou collé) vers le dépôt privé
 * et l'enregistre dans `fichiers` — même chemin que le bouton « + Ajouter »
 * de PiecesJointes.jsx, factorisé ici pour être réutilisé depuis le collage
 * (PiecesJointes.jsx, Capture.jsx) sans dupliquer la logique d'upload et son
 * rattrapage (retirer le fichier du dépôt si l'insertion en base échoue,
 * pour ne jamais laisser un fichier orphelin, invisible et introuvable dans
 * l'app).
 *
 * Passer exactement un des deux : clientId ou dossierId.
 */
export async function envoyerFichier({ clientId, dossierId, fichier }) {
  const nom = nommer(fichier)

  if (fichier.size > TAILLE_MAX) {
    return { erreur: `« ${nom} » dépasse la limite de 25 Mo.` }
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { erreur: `Pas de réseau : « ${nom} » n’a pas été envoyé. Réessayez une fois reconnecté.`, horsLigne: true }
  }

  const colonne = clientId ? 'client_id' : 'dossier_id'
  const valeur = clientId ?? dossierId
  const mime = typeMime(fichier, nom)

  // Chemin non devinable, et extension conservée pour que l'ouverture depuis
  // le lien signé reste correcte.
  const ext = extensionDe(nom) ? `.${extensionDe(nom)}` : ''
  const chemin = `${colonne}/${valeur}/${crypto.randomUUID()}${ext}`

  try {
    const { error: errEnvoi } = await supabase.storage
      .from('documents')
      .upload(chemin, fichier, { contentType: mime || undefined })
    if (errEnvoi) return { erreur: messageEnvoi(nom, errEnvoi) }

    const { data: ligne, error: errBase } = await supabase
      .from('fichiers')
      .insert({
        [colonne]: valeur,
        chemin,
        nom,
        taille: fichier.size,
        type_mime: mime || null,
        ...typeParNom(nom),
      })
      .select()
      .single()

    if (errBase) {
      // Sans cette ligne, le fichier resterait dans le dépôt sans référence :
      // invisible dans l'app et impossible à retrouver.
      await supabase.storage.from('documents').remove([chemin])
      return { erreur: messageEnvoi(nom, errBase) }
    }
    return { ligne }
  } catch (err) {
    return { erreur: messageEnvoi(nom, err) }
  }
}

/**
 * Extrait un fichier d'un événement `paste`, s'il y en a un — image collée
 * (capture d'écran, image copiée) ou fichier générique selon ce que le
 * navigateur transmet réellement (voir PASSATION.md pour les limites de
 * compatibilité constatées, notamment sur iOS Safari). `null` si le
 * presse-papiers ne contenait que du texte : à laisser filer vers le
 * comportement par défaut du champ (collage de texte normal).
 */
export function fichierColle(evenement) {
  const items = evenement.clipboardData?.items
  if (!items) return null
  for (const item of items) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) return f
    }
  }
  return null
}
