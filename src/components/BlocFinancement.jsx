import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { lireAvecCache } from '../lib/cacheLecture'
import { mettreEnFile, ligneEnFile } from '../lib/fileAttente'
import { ajouterRappel, prochainJourOuvre } from '../lib/rappel'
import { MODES, STATUTS, STATUTS_LABELS, JOURS_RELANCE, ecartMontant, joursDepuis, resume } from '../lib/financement'

const euros = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €'
const dateFr = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

function Pastille({ actif, onClick, children, label }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={actif}
      aria-label={label}
      className={`flex-shrink-0 min-h-11 px-3 rounded-full border text-sm font-medium ${
        actif ? 'bg-accent text-white border-accent' : 'bg-carte text-texte-doux border-separateur'
      }`}
    >
      {children}
    </button>
  )
}

// Champ numérique facultatif : enregistré à la sortie du champ, vide = pas de valeur.
function ChampNombre({ id, libelle, valeur, unite, onSauver }) {
  const [saisie, setSaisie] = useState(valeur == null ? '' : String(valeur))
  useEffect(() => setSaisie(valeur == null ? '' : String(valeur)), [valeur])
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-xs text-texte-doux px-1">{libelle}</label>
      <div className="flex items-center gap-1 bg-fond rounded-imbrique border border-separateur px-3">
        <input
          id={id}
          inputMode="decimal"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onBlur={() => {
            const n = saisie.trim() === '' ? null : Number(saisie.replace(/\s/g, '').replace(',', '.'))
            if (n !== null && Number.isNaN(n)) return setSaisie(valeur == null ? '' : String(valeur))
            if (n !== (valeur == null ? null : Number(valeur))) onSauver(n)
          }}
          className="w-full min-h-11 bg-transparent text-texte outline-none tabular-nums"
        />
        {unite && <span className="text-xs text-texte-doux flex-shrink-0">{unite}</span>}
      </div>
    </div>
  )
}

/** Journal des changements de statut du financement (dossier_financement_historique). */
// `version` : updated_at de la ligne. Le journal est relu quand l'écho temps réel de la base la fait changer,
// donc APRÈS la validation de l'écriture (un rechargement au geste lirait avant la ligne de journal du déclencheur).
function Journal({ dossierId, statut, version }) {
  const [lignes, setLignes] = useState([])
  useEffect(() => {
    let actif = true
    lireAvecCache(`financement-journal-${dossierId}`, () =>
      supabase
        .from('dossier_financement_historique')
        .select('id, statut_avant, statut_apres, changed_at')
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
  }, [dossierId, statut, version])
  if (!lignes.length) return null
  return (
    <ul aria-label="Historique du financement" className="mt-3 space-y-1">
      {lignes.map((h) => (
        <li key={h.id} className="text-xs text-texte-doux flex justify-between gap-2">
          <span>{h.statut_avant ? `${STATUTS_LABELS[h.statut_avant]} → ${STATUTS_LABELS[h.statut_apres]}` : `Créé · ${STATUTS_LABELS[h.statut_apres]}`}</span>
          <span className="tabular-nums">{dateFr(h.changed_at)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Financement d'un projet : mode et statut en pastilles (un tap), montants facultatifs, organisme avec
 * autocomplétion sur ceux déjà saisis. Le montant financé est pré-rempli depuis le montant du dossier ;
 * un changement ultérieur de ce montant est signalé.
 */
export default function BlocFinancement({ dossier, fin, organismes, ecrire }) {
  const [relance, setRelance] = useState(null)
  const hors = fin && ligneEnFile('dossier_financement', fin.id)
  const montantDossier = dossier.montant_estime != null && Number(dossier.montant_estime) !== 0 ? Number(dossier.montant_estime) : null
  const ecart = fin ? ecartMontant(fin, { montant_estime: montantDossier }) : null
  const finance = fin && fin.mode !== 'comptant'
  const jours = fin?.statut === 'depose' ? joursDepuis(fin.date_statut) : null

  const choisirMode = (mode) => {
    if (fin?.mode === mode) return
    const champs = { mode }
    // Pré-remplissage : seulement un montant financé encore vide (une valeur saisie fait autorité).
    if (mode !== 'comptant' && fin?.montant_finance == null && montantDossier != null) {
      champs.montant_finance = montantDossier
      champs.montant_ref = montantDossier
    }
    ecrire(champs)
  }

  const programmerRelance = async () => {
    const base = new Date(`${fin.date_statut}T12:00:00`)
    base.setDate(base.getDate() + JOURS_RELANCE)
    const date = prochainJourOuvre(base.toISOString().slice(0, 10))
    const note = `Relancer le financement${fin.organisme ? ` (${fin.organisme})` : ''}`
    const res = await ajouterRappel(dossier.id, date, note)
    if (res?.erreur) mettreEnFile({ type: 'insert', table: 'rappels', payload: { dossier_id: dossier.id, date, note } })
    setRelance(date)
  }

  return (
    <section id="zone-financement" aria-label="Financement" className="mb-4 scroll-mt-20 bg-carte rounded-carte shadow-sm px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold text-texte">Financement</h2>
        {fin && <span className="text-sm text-texte-doux">{resume(fin)}</span>}
      </div>

      <div role="group" aria-label="Mode de financement" className="flex flex-wrap gap-2 mt-2">
        {MODES.map(([cle, libelle]) => (
          <Pastille key={cle} actif={fin?.mode === cle} onClick={() => choisirMode(cle)} label={`Mode : ${libelle}`}>
            {libelle}
          </Pastille>
        ))}
      </div>

      {finance && (
        <>
          <div role="group" aria-label="Statut du financement" className="flex flex-wrap gap-2 mt-2">
            {STATUTS.map(([cle, libelle]) => (
              <Pastille key={cle} actif={fin.statut === cle} onClick={() => fin.statut !== cle && ecrire({ statut: cle })} label={`Statut : ${libelle}`}>
                {libelle}
              </Pastille>
            ))}
          </div>

          {ecart && (
            <div role="alert" className="mt-3 rounded-imbrique border border-alerte/50 bg-alerte/10 px-3 py-2 text-sm text-alerte">
              <p>
                Le montant du dossier a changé : {euros(ecart.avant)} → {euros(ecart.apres)}. Montant financé :{' '}
                {fin.montant_finance != null ? euros(fin.montant_finance) : 'non renseigné'}.
              </p>
              <div className="flex gap-2 mt-1">
                <button onClick={() => ecrire({ montant_finance: ecart.apres, montant_ref: ecart.apres })} className="min-h-11 px-3 font-semibold">
                  Mettre à jour
                </button>
                <button onClick={() => ecrire({ montant_ref: ecart.apres })} className="min-h-11 px-3">
                  Garder
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="col-span-2 flex flex-col gap-0.5">
              <label htmlFor="fin-organisme" className="text-xs text-texte-doux px-1">Organisme</label>
              <input
                id="fin-organisme"
                list="fin-organismes"
                defaultValue={fin.organisme ?? ''}
                key={fin.organisme ?? ''}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null
                  if (v !== (fin.organisme ?? null)) ecrire({ organisme: v })
                }}
                className="w-full min-h-11 bg-fond rounded-imbrique border border-separateur px-3 text-texte outline-none"
              />
              <datalist id="fin-organismes">
                {organismes.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>
            <ChampNombre id="fin-montant" libelle="Montant financé" unite="€" valeur={fin.montant_finance} onSauver={(n) => ecrire({ montant_finance: n, montant_ref: n == null ? null : montantDossier })} />
            <ChampNombre id="fin-apport" libelle="Apport" unite="€" valeur={fin.apport} onSauver={(n) => ecrire({ apport: n })} />
            <ChampNombre id="fin-duree" libelle="Durée" unite="mois" valeur={fin.duree_mois} onSauver={(n) => ecrire({ duree_mois: n == null ? null : Math.round(n) })} />
            <ChampNombre id="fin-mensualite" libelle="Mensualité" unite="€" valeur={fin.mensualite} onSauver={(n) => ecrire({ mensualite: n })} />
          </div>

          {fin.statut === 'depose' && (
            <div className="mt-3 text-sm">
              <p className={jours != null && jours > JOURS_RELANCE ? 'text-alerte' : 'text-texte-doux'}>
                Déposé depuis {jours ?? 0} jour{jours > 1 ? 's' : ''}
              </p>
              {relance ? (
                <p className="text-texte-doux">Relance programmée le {new Date(`${relance}T12:00:00`).toLocaleDateString('fr-FR')}.</p>
              ) : (
                <button onClick={programmerRelance} className="min-h-11 px-3 -ml-3 text-accent-vif font-semibold">
                  Programmer une relance à {JOURS_RELANCE} jours
                </button>
              )}
            </div>
          )}

          <Journal dossierId={dossier.id} statut={fin.statut} version={fin.updated_at} />
        </>
      )}
      {hors && <p className="mt-2 text-xs text-alerte">Enregistré hors ligne — sera envoyé au retour du réseau.</p>}
    </section>
  )
}
