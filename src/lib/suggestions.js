import { supabase } from './supabaseClient'
import { STATUT_PAR_DEFAUT } from '../constants/dossiers'

// La dictée ne fait que proposer : c'est toujours Bruce qui confirme la
// création du dossier, jamais l'IA seule.
export async function creerDossierDepuisSuggestion(capture, type) {
  if (!capture.client_id) return null
  const titre = (type === 'sav' ? capture.sav_titre : capture.projet_titre) || capture.resume || (type === 'sav' ? 'SAV' : 'Projet')

  const { data: dossier, error: errDossier } = await supabase
    .from('dossiers')
    .insert({
      client_id: capture.client_id,
      type,
      statut: type === 'sav' ? 'ouvert' : STATUT_PAR_DEFAUT.projet,
      titre,
    })
    .select()
    .single()

  if (errDossier) return null

  // La dictée brute part au journal du dossier : c'est elle qui garde le
  // détail exact, le titre n'en est qu'un résumé.
  await supabase.from('dossier_notes').insert({ dossier_id: dossier.id, texte: capture.texte })
  const champ = type === 'sav' ? 'sav_dossier_id' : 'projet_dossier_id'
  await supabase.from('captures').update({ [champ]: dossier.id }).eq('id', capture.id)

  return dossier
}

export async function ignorerSuggestion(capture, type) {
  const champ = type === 'sav' ? 'sav_suggere' : 'projet_suggere'
  await supabase.from('captures').update({ [champ]: false }).eq('id', capture.id)
}
