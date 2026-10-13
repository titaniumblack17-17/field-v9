import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { lireAvecCache } from '../lib/cacheLecture'
import { offresPlat } from '../lib/documents'
import { familleDe, estSigne } from '../lib/projets'
import Rubrique from './Rubrique'
import { ETAPES_PROJET_LABELS, aChiffrer } from '../constants/dossiers'

const euros = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €'
const ETAPES_APRES_DEVIS = [
  'devis_envoye', 'relance', 'visite_local', 'negociation', 'confirmation',
  'financement', 'commande', 'reunion_chantier', 'installation', 'finition',
]

/** Fichiers du dossier (devis, CDC, plans…), temps réel INSERT / UPDATE / DELETE. */
export function useFichiersDossier(dossierId) {
  const [fichiers, setFichiers] = useState([])
  useEffect(() => {
    let actif = true
    lireAvecCache(`fiche-fichiers-${dossierId}`, () =>
      supabase
        .from('fichiers')
        .select('id, dossier_id, type_doc, nom, montant_ttc, variantes, decision, a_trancher_raison, date_reprise, created_at')
        .eq('dossier_id', dossierId)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data ?? []
        })
    )
      .then(({ valeur }) => actif && setFichiers(valeur))
      .catch(() => {})
    const canal = supabase
      .channel(`fiche-fichiers-${dossierId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fichiers', filter: `dossier_id=eq.${dossierId}` }, (p) => {
        setFichiers((cur) => {
          if (p.eventType === 'DELETE') return cur.filter((f) => f.id !== p.old.id)
          const sans = cur.filter((f) => f.id !== p.new.id)
          return [...sans, p.new]
        })
      })
      .subscribe()
    return () => {
      actif = false
      supabase.removeChannel(canal)
    }
  }, [dossierId])
  return fichiers
}

export { estSigne }

const carte = 'bg-carte rounded-carte shadow-sm'

/**
 * Synthèse d'un projet : étape (famille colorée), montant, objectif signé / non signé, devis. Chaque zone
 * mène à son écran : l'étape au Pipeline filtré, le montant et les devis à la zone Documents, l'objectif au
 * Pilotage.
 */
export function SyntheseProjet({ dossier, fichiers, onPipeline, onDocuments, onAccueil }) {
  const famille = familleDe(dossier.statut)
  const devis = fichiers.filter((f) => f.type_doc === 'devis')
  const offres = useMemo(() => offresPlat(devis), [devis])
  const retenues = offres.filter((o) => o.etat === 'retenue').length
  const aTrancher = offres.filter((o) => o.etat === 'a_trancher').length
  const signe = estSigne(dossier, fichiers)
  const montant = dossier.montant_estime != null && Number(dossier.montant_estime) !== 0 ? Number(dossier.montant_estime) : null
  return (
    <section aria-label="Synthèse du projet" className="mb-4 grid grid-cols-2 gap-2">
      <button
        onClick={() => onPipeline?.('projet', dossier.statut, famille)}
        aria-label={`Étape : ${ETAPES_PROJET_LABELS[dossier.statut] ?? dossier.statut} — voir dans le Pipeline`}
        className={`${carte} px-3 py-3 min-h-[72px] text-left border-l-[7px]`}
        style={{ borderColor: famille?.couleur ?? 'transparent' }}
      >
        <span className="block text-xs text-texte-doux">Étape{famille ? ` · ${famille.libelle}` : ''}</span>
        <span className="block text-[15px] font-bold text-texte">{ETAPES_PROJET_LABELS[dossier.statut] ?? dossier.statut}</span>
      </button>
      <button onClick={onDocuments} aria-label="Montant — voir les devis" className={`${carte} px-3 py-3 min-h-[72px] text-left`}>
        <span className="block text-xs text-texte-doux">Montant</span>
        <span className={`block text-[15px] font-bold tabular-nums ${montant == null && aChiffrer(dossier) ? 'text-alerte' : 'text-texte'}`}>
          {montant != null ? euros(montant) : aChiffrer(dossier) ? 'à chiffrer' : '—'}
        </span>
      </button>
      <button onClick={onAccueil} aria-label="Objectif — voir le Pilotage" className={`${carte} px-3 py-3 min-h-[72px] text-left`}>
        <span className="block text-xs text-texte-doux">Objectif {new Date().getFullYear()}</span>
        <span className={`block text-[15px] font-bold ${signe ? 'text-texte' : 'text-texte-doux'}`}>{signe ? 'Signé' : 'Non signé'}</span>
      </button>
      <button onClick={onDocuments} aria-label="Devis — voir les décisions" className={`${carte} px-3 py-3 min-h-[72px] text-left`}>
        <span className="block text-xs text-texte-doux">Devis</span>
        <span className="block text-[15px] font-bold text-texte tabular-nums">
          {devis.length === 0 ? 'aucun' : `${devis.length} devis · ${offres.length} offre${offres.length > 1 ? 's' : ''}`}
        </span>
        {devis.length > 0 && (
          <span className={`block text-xs ${aTrancher > 0 ? 'text-alerte' : 'text-texte-doux'}`}>
            {retenues} retenue{retenues > 1 ? 's' : ''}
            {aTrancher > 0 ? ` · ${aTrancher} à trancher` : ''}
          </span>
        )}
      </button>
    </section>
  )
}

/** Documents typés du dossier (devis, CDC, plans) ; les manquants sont signalés. Chaque puce ouvre la zone Documents. */
export function DocumentsTypes({ dossier, fichiers, onDocuments }) {
  const n = (type) => fichiers.filter((f) => f.type_doc === type).length
  const projet = dossier.type === 'projet'
  const devisManquant = projet && ETAPES_APRES_DEVIS.includes(dossier.statut) && n('devis') === 0
  const cdcManquant = projet && Boolean(dossier.plan_statut) && n('cdc') === 0
  const puces = [
    ['Devis', n('devis'), devisManquant],
    ['Cahier des charges', n('cdc'), cdcManquant],
    ['Plans', n('plan'), false],
  ]
  return (
    <section aria-label="Documents typés" className="mb-4">
      <p className="text-xs text-texte-doux px-1 mb-1">Documents</p>
      <div className="flex flex-wrap gap-2">
        {puces.map(([libelle, nombre, manquant]) => (
          <button
            key={libelle}
            onClick={onDocuments}
            aria-label={`${libelle} : ${manquant ? 'manquant' : nombre}`}
            className={`min-h-11 px-3 rounded-full border text-sm flex items-center gap-1.5 ${
              manquant ? 'border-alerte/50 bg-alerte/10 text-alerte' : 'border-separateur bg-carte text-texte-doux'
            }`}
          >
            {libelle}
            <span className="tabular-nums font-semibold">{manquant ? 'manquant' : nombre}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

const dateFr = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Historique des étapes (dossier_etapes_historique) : chaque ligne mène au Pipeline filtré sur l'étape atteinte. */
export function HistoriqueEtapes({ dossierId, statutActuel, onPipeline }) {
  const [lignes, setLignes] = useState([])
  useEffect(() => {
    let actif = true
    lireAvecCache(`fiche-etapes-${dossierId}`, () =>
      supabase
        .from('dossier_etapes_historique')
        .select('id, statut_avant, statut_apres, changed_at, avant_inconnu')
        .eq('dossier_id', dossierId)
        .order('changed_at', { ascending: false })
        .order('id', { ascending: false })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data ?? []
        })
    )
      .then(({ valeur }) => actif && setLignes(valeur))
      .catch(() => {})
    return () => {
      actif = false
    }
  }, [dossierId, statutActuel])
  if (!lignes.length) return null
  const libelle = (s) => ETAPES_PROJET_LABELS[s] ?? s
  return (
    <Rubrique titre="Historique des étapes" compte={lignes.length}>
      <ul aria-label="Historique des étapes" className="space-y-2">
        {lignes.map((h) => (
          <li key={h.id}>
            <button
              onClick={() => onPipeline?.('projet', h.statut_apres, familleDe(h.statut_apres))}
              className={`${carte} w-full text-left px-4 py-3 min-h-14`}
            >
              <span className="block text-sm text-texte">
                {h.statut_avant ? `${libelle(h.statut_avant)} → ${libelle(h.statut_apres)}` : h.avant_inconnu ? `Arrivé en ${libelle(h.statut_apres)}` : `Création · ${libelle(h.statut_apres)}`}
              </span>
              <span className="block text-xs text-texte-doux tabular-nums">{dateFr(h.changed_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Rubrique>
  )
}
