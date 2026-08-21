import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { reconcilierRappels } from '../lib/todoist'
import {
  ETAPES_PROJET,
  PLAN_STATUT_LABELS,
  STATUTS_PLAN_LABELS,
  TYPE_LABELS,
  styleDossier,
} from '../constants/dossiers'

// Objectif annuel de la spec (§1) : 5 M€ TTC.
const OBJECTIF_ANNUEL = 5_000_000

// Un dossier est considéré engagé à partir de la commande signée.
const ETAPES_ENGAGEES = ['commande', 'reunion_chantier', 'installation', 'finition', 'financement']

const euros = (n) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €'

const nomClient = (c) =>
  c ? [c.prenom_praticien, c.nom_praticien].filter(Boolean).join(' ') : '—'

const libelleEtape = (v) => ETAPES_PROJET.find(([k]) => k === v)?.[1] ?? v

function Ligne({ dossier, onOuvrir, droite, alerte }) {
  const s = styleDossier(dossier)
  return (
    <li>
      <button
        onClick={() => onOuvrir(dossier)}
        style={{ borderColor: s.bordure }}
        className="w-full text-left bg-carte rounded-xl px-4 py-3 shadow-sm border-l-[7px] active:scale-[0.98] transition flex items-center gap-3"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-texte truncate">{nomClient(dossier.clients)}</p>
          <p className="text-sm text-texte-doux truncate">
            {dossier.titre || TYPE_LABELS[dossier.type]}
          </p>
        </div>
        {droite && (
          <span className={`text-sm flex-shrink-0 ${alerte ? 'text-alerte font-medium' : 'text-texte-doux'}`}>
            {droite}
          </span>
        )}
      </button>
    </li>
  )
}

function Section({ titre, compte, vide, children }) {
  return (
    <section className="mt-5">
      <div className="flex items-baseline gap-2 px-1 mb-2">
        <h2 className="text-xs text-texte-faible uppercase tracking-wider">{titre}</h2>
        {compte > 0 && <span className="text-xs text-texte-faible">{compte}</span>}
      </div>
      {compte === 0 ? <p className="text-texte-faible text-sm px-1">{vide}</p> : <ul className="space-y-2">{children}</ul>}
    </section>
  )
}

export default function BriefSoir({ onBack, onOpenDossier }) {
  const [dossiers, setDossiers] = useState([])
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    let actif = true

    // Réconcilier avant de lire, jamais après : le Brief est le moment où l'on
    // décide quoi faire ce soir. Réclamer un appel déjà passé sur la montre
    // ferait perdre la confiance dans la liste entière.
    reconcilierRappels()
      .then(() =>
        supabase
          .from('dossiers')
          .select('*, clients(id, prenom_praticien, nom_praticien, ville)')
      )
      .then(({ data }) => {
        if (actif) {
          setDossiers(data ?? [])
          setChargement(false)
        }
      })

    return () => {
      actif = false
    }
  }, [])

  const bilan = useMemo(() => {
    const aujourdhui = new Date().toISOString().slice(0, 10)
    const projets = dossiers.filter((d) => d.type === 'projet')
    const actifs = projets.filter((d) => d.statut !== 'perdu')

    const aRappeler = dossiers
      .filter((d) => d.rappel_date && d.rappel_date <= aujourdhui)
      .sort((a, b) => a.rappel_date.localeCompare(b.rappel_date))

    const aVenir = dossiers
      .filter((d) => d.rappel_date && d.rappel_date > aujourdhui)
      .sort((a, b) => a.rappel_date.localeCompare(b.rappel_date))
      .slice(0, 5)

    // Travail technique dû : plans intégrés à une vente, et plans encore à
    // fabriquer.
    const plansAProduire = [
      ...projets.filter((d) => d.plan_statut && d.plan_statut !== 'fait'),
      ...dossiers.filter(
        (d) => d.type === 'plan' && ['a_planifier', 'en_cours'].includes(d.statut)
      ),
    ]

    // Un plan livré n'est pas un plan soldé. Ceux-là ne demandent plus de
    // travail : ils demandent d'être payés, et c'est en les oubliant qu'on
    // travaille gratuitement.
    const reglements = dossiers.filter(
      (d) =>
        d.type === 'plan' &&
        d.remuneration_type === 'facture' &&
        ['installe', 'reglement_demande'].includes(d.statut)
    )

    const somme = (liste) => liste.reduce((t, d) => t + (Number(d.montant_estime) || 0), 0)
    const engages = actifs.filter((d) => ETAPES_ENGAGEES.includes(d.statut))

    return {
      aRappeler,
      aVenir,
      plansAProduire,
      reglements,
      duParPlans: reglements.length * 500,
      pipeline: somme(actifs),
      engage: somme(engages),
      chiffres: actifs.filter((d) => d.montant_estime != null).length,
      totalActifs: actifs.length,
      sansMontant: actifs.filter((d) => d.montant_estime == null),
      planFacture: dossiers.filter(
        (d) => d.type === 'plan' && d.remuneration_type === 'facture' && d.statut === 'solde'
      ).length,
    }
  }, [dossiers])

  const couvertureFaible = bilan.totalActifs > 0 && bilan.chiffres < bilan.totalActifs / 2
  const partObjectif = Math.min(100, Math.round((bilan.engage / OBJECTIF_ANNUEL) * 100))

  return (
    <div className="min-h-screen bg-fond">
      <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-accent text-sm font-medium">
          ← Clients
        </button>
        <h1 className="text-lg font-semibold text-texte">Brief soir</h1>
      </header>

      <main className="px-4 pb-8">
        {chargement && <p className="text-texte-faible text-sm">Point avec Todoist…</p>}

        {!chargement && (
          <>
            <Section
              titre="À rappeler"
              compte={bilan.aRappeler.length}
              vide="Aucun rappel en retard. "
            >
              {bilan.aRappeler.map((d) => (
                <Ligne key={d.id} dossier={d} onOuvrir={onOpenDossier} droite={d.rappel_date} alerte />
              ))}
            </Section>

            <Section titre="Rappels à venir" compte={bilan.aVenir.length} vide="Rien de programmé.">
              {bilan.aVenir.map((d) => (
                <Ligne key={d.id} dossier={d} onOuvrir={onOpenDossier} droite={d.rappel_date} />
              ))}
            </Section>

            <Section
              titre="Plans à produire"
              compte={bilan.plansAProduire.length}
              vide="Aucun plan en attente."
            >
              {bilan.plansAProduire.map((d) => (
                <Ligne
                  key={d.id}
                  dossier={d}
                  onOuvrir={onOpenDossier}
                  droite={
                    d.plan_statut
                      ? PLAN_STATUT_LABELS[d.plan_statut]
                      : STATUTS_PLAN_LABELS[d.statut] ?? libelleEtape(d.statut)
                  }
                />
              ))}
            </Section>

            <Section
              titre="Règlements de plans à encaisser"
              compte={bilan.reglements.length}
              vide="Aucun plan en attente de règlement."
            >
              {bilan.reglements.map((d) => (
                <Ligne
                  key={d.id}
                  dossier={d}
                  onOuvrir={onOpenDossier}
                  droite={STATUTS_PLAN_LABELS[d.statut]}
                  alerte={d.statut === 'reglement_demande'}
                />
              ))}
            </Section>

            {bilan.reglements.length > 0 && (
              <p className="text-xs text-texte-doux px-1 mt-2">
                {euros(bilan.duParPlans)} facturables, plans livrés et non réglés.
              </p>
            )}

            <section className="mt-6">
              <h2 className="text-xs text-texte-faible uppercase tracking-wider px-1 mb-2">
                Objectif annuel
              </h2>
              <div className="bg-carte rounded-xl shadow-sm px-4 py-4">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-texte font-medium">{euros(bilan.engage)} engagés</span>
                  <span className="text-sm text-texte-doux">sur {euros(OBJECTIF_ANNUEL)}</span>
                </div>
                <div className="h-2 rounded-full bg-carte-douce overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full"
                    style={{ width: `${partObjectif}%` }}
                  />
                </div>
                <p className="text-xs text-texte-faible mt-2">
                  Engagé = commande signée et au-delà. Pipeline actif : {euros(bilan.pipeline)}.
                </p>
                {bilan.planFacture > 0 && (
                  <p className="text-xs text-texte-doux mt-1">
                    Casquette technique : {bilan.planFacture} plan
                    {bilan.planFacture > 1 ? 's' : ''} facturé{bilan.planFacture > 1 ? 's' : ''} ·{' '}
                    {euros(bilan.planFacture * 500)}
                  </p>
                )}
              </div>
            </section>

            {couvertureFaible && (
              <section className="mt-4">
                <div className="bg-alerte/10 border border-alerte/30 rounded-xl px-4 py-3">
                  <p className="text-sm text-texte">
                    Ces montants ne valent pas grand-chose : seuls {bilan.chiffres} dossiers sur{' '}
                    {bilan.totalActifs} portent un montant estimé.
                  </p>
                  <p className="text-xs text-texte-doux mt-1">
                    Tant que les autres ne sont pas chiffrés, le suivi de l'objectif reste indicatif.
                  </p>
                </div>
              </section>
            )}

            <Section
              titre="À chiffrer"
              compte={bilan.sansMontant.length}
              vide="Tous les dossiers actifs sont chiffrés."
            >
              {bilan.sansMontant.map((d) => (
                <Ligne
                  key={d.id}
                  dossier={d}
                  onOuvrir={onOpenDossier}
                  droite={libelleEtape(d.statut)}
                />
              ))}
            </Section>
          </>
        )}
      </main>
    </div>
  )
}
