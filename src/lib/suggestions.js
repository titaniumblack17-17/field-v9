import { supabase } from './supabaseClient'
import { STATUT_PAR_DEFAUT } from '../constants/dossiers'

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
  // détail exact, le titre n'en est qu'un résumé.
  await supabase.from('dossier_notes').insert({ dossier_id: dossier.id, texte: capture.texte })
  const champ = DOSSIER_CHAMP_PAR_TYPE[type]
  await supabase.from('captures').update({ [champ]: dossier.id }).eq('id', capture.id)

  return dossier
}

export async function ignorerSuggestion(capture, type) {
  const champ = SUGGERE_CHAMP_PAR_TYPE[type]
  await supabase.from('captures').update({ [champ]: false }).eq('id', capture.id)
}
