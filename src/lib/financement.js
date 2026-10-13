import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { lireAvecCache } from './cacheLecture'
import { mettreEnFile, ligneEnFile } from './fileAttente'
import { aujourdhui } from './rappel'

export const MODES = [
  ['comptant', 'Comptant'],
  ['banque', 'Banque'],
  ['leasing', 'Leasing'],
  ['echelonne', 'Échelonné'],
  ['mixte', 'Mixte'],
]
export const STATUTS = [
  ['a_proposer', 'À proposer'],
  ['depose', 'Déposé'],
  ['accord', 'Accord'],
  ['refus', 'Refus'],
  ['debloque', 'Débloqué'],
]
export const MODES_LABELS = Object.fromEntries(MODES)
export const STATUTS_LABELS = Object.fromEntries(STATUTS)

/** Un délai de relance du dossier déposé : au-delà, on relance l'organisme. */
export const JOURS_RELANCE = 10

/** Résumé en une ligne : « Banque · Accord ». Comptant n'a pas de statut à suivre. */
export const resume = (fin) => {
  if (!fin) return null
  const mode = MODES_LABELS[fin.mode] ?? fin.mode
  return fin.mode === 'comptant' ? mode : `${mode} · ${STATUTS_LABELS[fin.statut] ?? fin.statut}`
}

const nombre = (v) => (v == null || v === '' ? null : Number(v))

/** Le montant du dossier a changé depuis le pré-remplissage du montant financé. */
export const ecartMontant = (fin, dossier) => {
  const ref = nombre(fin?.montant_ref)
  const actuel = nombre(dossier?.montant_estime)
  if (ref == null || actuel == null || ref === actuel) return null
  return { avant: ref, apres: actuel }
}

// Définitions communes à la RPC dashboard_chiffres() (clé « financement »), à la liste des projets et au Pilotage.
const aFinancer = (fin) => Boolean(fin) && fin.mode !== 'comptant'
/** Déposé, accord pas encore reçu (le dossier doit être un projet actif : à vérifier par l'appelant). */
export const enAttenteAccord = (fin) => aFinancer(fin) && fin.statut === 'depose'
/** Ni accordé ni débloqué : le financement n'est pas confirmé. */
export const nonConfirme = (fin) => aFinancer(fin) && ['a_proposer', 'depose', 'refus'].includes(fin.statut)

/** Jours écoulés depuis `date_statut` (date locale, sans heure). */
export const joursDepuis = (isoDate) =>
  isoDate ? Math.max(0, Math.round((new Date(`${aujourdhui()}T12:00:00`) - new Date(`${isoDate}T12:00:00`)) / 86_400_000)) : null

/**
 * Financement d'un dossier + organismes déjà saisis (autocomplétion). Écritures optimistes : l'état local
 * change tout de suite ; si l'écriture échoue (hors-ligne), elle part en file avec le `rowId` de la ligne
 * (identifiant créé côté client, la file rejoue l'insertion puis les mises à jour dans l'ordre).
 * Tant qu'une écriture de cette ligne attend dans la file, la base ne fait pas foi : on ignore ses échos.
 */
export function useFinancement(dossierId) {
  const [fin, setFin] = useState(null)
  const [organismes, setOrganismes] = useState([])
  const courant = useRef(null)
  courant.current = fin

  useEffect(() => {
    let actif = true
    const charger = () =>
      lireAvecCache(`financement-${dossierId}`, () =>
        supabase
          .from('dossier_financement')
          .select('*')
          .eq('dossier_id', dossierId)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) throw new Error(error.message)
            return data ?? null
          })
      )
        .then(({ valeur }) => {
          if (!actif) return
          if (valeur && ligneEnFile('dossier_financement', valeur.id)) return
          if (!valeur && courant.current && ligneEnFile('dossier_financement', courant.current.id)) return
          setFin(valeur)
        })
        .catch(() => {})
    charger()
    supabase
      .from('dossier_financement')
      .select('organisme')
      .not('organisme', 'is', null)
      .then(({ data }) => {
        if (actif && data) setOrganismes([...new Set(data.map((r) => r.organisme.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')))
      })
    const canal = supabase
      .channel(`financement-${dossierId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dossier_financement', filter: `dossier_id=eq.${dossierId}` }, (p) => {
        if (p.eventType === 'DELETE') {
          setFin((cur) => (cur && ligneEnFile('dossier_financement', cur.id) ? cur : null))
          return
        }
        if (ligneEnFile('dossier_financement', p.new.id)) return
        setFin(p.new)
      })
      .subscribe((statut) => {
        if (statut === 'SUBSCRIBED') charger()
      })
    return () => {
      actif = false
      supabase.removeChannel(canal)
    }
  }, [dossierId])

  /** Écrit des champs (création à la première écriture). Retourne quand l'écriture est faite ou mise en file. */
  const ecrire = useCallback(
    async (champs) => {
      const existant = courant.current
      if (!existant) {
        const ligne = { id: crypto.randomUUID(), dossier_id: dossierId, mode: 'banque', statut: 'a_proposer', date_statut: aujourdhui(), ...champs }
        courant.current = ligne
        setFin(ligne)
        const { error } = await supabase.from('dossier_financement').insert(ligne)
        if (error) mettreEnFile({ type: 'insert', table: 'dossier_financement', payload: ligne })
        return
      }
      const patch = { ...champs }
      if (patch.statut && patch.statut !== existant.statut) patch.date_statut = aujourdhui()
      const suivant = { ...existant, ...patch }
      courant.current = suivant
      setFin(suivant)
      const { error } = await supabase.from('dossier_financement').update(patch).eq('id', existant.id)
      if (error) mettreEnFile({ type: 'update', table: 'dossier_financement', rowId: existant.id, champs: patch })
    },
    [dossierId]
  )

  return { fin, organismes, ecrire }
}
