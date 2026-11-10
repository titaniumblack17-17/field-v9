// Logique pure de la vérification « clé publique seule » (voir scripts/verifier-rls.mjs). Sans réseau : testable.
// Une table est FERMÉE si, avec la clé publique seule, la lecture renvoie [] (RLS filtre) ou une erreur HTTP/JSON d'accès refusé.
// Elle est OUVERTE (ÉCHEC) dès qu'une seule ligne revient.

export const TABLES_PROTEGEES = [
  'produits', 'carnet_contacts', 'rapport_hebdo', 'pipeline_snapshots', 'dossier_etapes_historique',
  'dossier_financement_historique', 'materiel', 'captures', 'client_notes', 'dossier_note_taches', 'rappels',
  'dossier_notes', 'dossier_financement', 'fichiers', 'clients', 'dossiers', 'loupe_memoire', 'loupe_runs',
]

/** @returns {{ferme: boolean, detail: string}} */
export function jugerReponse(status, corps) {
  let json
  try { json = JSON.parse(corps) } catch { json = undefined }
  if (status >= 200 && status < 300) {
    if (Array.isArray(json) && json.length === 0) return { ferme: true, detail: '[] (RLS filtre)' }
    if (Array.isArray(json)) return { ferme: false, detail: `${json.length} ligne(s) lisible(s) avec la clé publique` }
    return { ferme: false, detail: 'réponse 2xx inattendue — à examiner' }
  }
  if (status === 401 || status === 403 || (json && typeof json === 'object' && (json.code || json.message))) {
    return { ferme: true, detail: `refusé (${status}${json?.code ? ' ' + json.code : ''})` }
  }
  return { ferme: false, detail: `réponse imprévue ${status} — à examiner` }
}
