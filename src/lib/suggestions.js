import { supabase } from './supabaseClient'
import { STATUT_PAR_DEFAUT } from '../constants/dossiers'
import { mettreEnFile } from './fileAttente'

// La dictée ne fait que proposer : c'est toujours Bruce qui confirme la
// création du dossier, jamais l'IA seule.
const TITRE_PAR_TYPE = { sav: 'sav_titre', projet: 'projet_titre', plan: 'plan_titre' }
const LABEL_PAR_TYPE = { sav: 'SAV', projet: 'Projet', plan: 'Plan' }
const DOSSIER_CHAMP_PAR_TYPE = { sav: 'sav_dossier_id', projet: 'projet_dossier_id', plan: 'plan_dossier_id' }
const SUGGERE_CHAMP_PAR_TYPE = { sav: 'sav_suggere', projet: 'projet_suggere', plan: 'plan_suggere' }

export async function creerDossierDepuisSuggestion(capture, type) {
  if (!capture.client_id) return null
  const titre = capture[TITRE_PAR_TYPE[type]] || capture.resume || LABEL_PAR_TYPE[type]

  const { data: dossier, error: errDossier } = await supabase
    .from('dossiers')
    .insert({
      client_id: capture.client_id,
      type,
      statut: STATUT_PAR_DEFAUT[type],
      titre,
    })
    .select()
    .single()

  if (errDossier) return null

  // La dictée brute part au journal du dossier : c'est elle qui garde le
  // détail exact, le titre n'en est qu'un résumé. Échec réseau plausible
  // (pattern déjà établi ailleurs) : en file plutôt que perdue.
  const payloadNote = { dossier_id: dossier.id, texte: capture.texte }
  const { error: errNote } = await supabase.from('dossier_notes').insert(payloadNote)
  if (errNote) mettreEnFile({ type: 'note', table: 'dossier_notes', payload: payloadNote })

  // Sans ce lien, le bouton « Créer » de SuggestionCapture ne se cache
  // jamais — et reste affiché de façon persistante dans le journal du
  // client (pas seulement le temps de l'écran Capture). Un échec silencieux
  // ici expose à un doublon de dossier si Bruce retape « Créer » plus tard
  // en pensant que rien n'a été fait. En file pour réessayer au retour
  // réseau plutôt que de laisser le bouton dans le vide.
  const champ = DOSSIER_CHAMP_PAR_TYPE[type]
  const { error: errLien } = await supabase.from('captures').update({ [champ]: dossier.id }).eq('id', capture.id)
  if (errLien) mettreEnFile({ type: 'capture-lien', captureId: capture.id, champ, dossierId: dossier.id })

  return dossier
}

export async function ignorerSuggestion(capture, type) {
  const champ = SUGGERE_CHAMP_PAR_TYPE[type]
  await supabase.from('captures').update({ [champ]: false }).eq('id', capture.id)
}
