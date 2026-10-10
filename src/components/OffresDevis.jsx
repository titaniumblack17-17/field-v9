import React, { useState } from 'react'
import { ETATS_OFFRE, offresDe, ttcDepuisHt } from '../lib/documents'

const eur = (n) => new Intl.NumberFormat('fr-FR').format(n)

const STYLE_ETAT = {
  retenue: 'bg-accent text-white border-accent',
  a_trancher: 'bg-alerte/20 text-alerte border-alerte/50',
  ecartee: 'bg-carte-douce text-texte border-separateur',
  reportee: 'bg-texte/10 text-texte border-texte/30',
}

/**
 * Offres d'un devis : un état par offre en un tap (Retenue / À trancher / Écartée /
 * Reportée), une étiquette de projet facultative, et pour une offre reportée une date
 * de reprise facultative (qui crée un rappel). Quand le devis laisse un doute HT/TTC,
 * retenir une offre pose d'abord la question, avec le calcul de TVA avant confirmation.
 * Les écritures passent par `onEtat` / `onProjet` (annulation 8 s, file hors-ligne).
 */
export default function OffresDevis({ f, onEtat, onProjet, onEcarterAutres }) {
  const offres = offresDe(f)
  // { i, etape: 'question' | 'calcul' } : question HT/TTC en cours pour l'offre i.
  const [question, setQuestion] = useState(null)
  // { i, date } : saisie de la date de reprise pour l'offre i.
  const [report, setReport] = useState(null)
  const doute = Boolean(f.a_trancher_raison)
  const ouvertes = offres.filter((o) => o.etat === 'a_trancher').length
  const aUneRetenue = offres.some((o) => o.etat === 'retenue')

  const toucher = (o, etat) => {
    setQuestion(null)
    setReport(null)
    if (o.etat === etat) return
    if (etat === 'reportee') return setReport({ i: o.i, date: '' })
    if (etat === 'retenue' && doute && !o.base) return setQuestion({ i: o.i, etape: 'question' })
    onEtat(f, o.i, etat, {})
  }

  return (
    <div className="px-4 pb-3 -mt-1">
      {doute && <p className="text-xs text-alerte mb-2">{f.a_trancher_raison}</p>}
      <p className="text-xs text-texte-faible mb-1.5">Offres : décidez chacune (elles peuvent se cumuler)</p>
      <ul className="space-y-2">
        {offres.map((o) => (
          <li key={o.i} className="rounded-imbrique border border-separateur bg-fond px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-texte min-w-0">{o.libelle}</span>
              <span className="text-sm text-texte font-medium tabular-nums flex-shrink-0">
                {eur(o.montant)} €{o.base === 'ht' && o.etat === 'retenue' ? ' HT' : ''}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 mt-2" role="group" aria-label={`État de l'offre ${o.libelle}`}>
              {ETATS_OFFRE.map(([cle, libelle]) => (
                <button
                  key={cle}
                  onClick={() => toucher(o, cle)}
                  aria-pressed={o.etat === cle}
                  className={`min-h-11 px-1 rounded-imbrique border text-[11px] font-medium leading-tight ${
                    o.etat === cle ? STYLE_ETAT[cle] : 'bg-fond text-texte-doux border-separateur'
                  }`}
                >
                  {libelle}
                </button>
              ))}
            </div>
            {o.etat === 'reportee' && o.date_reprise && (
              <p className="text-xs text-texte-doux mt-1">
                Reprise le {new Date(o.date_reprise + 'T00:00:00').toLocaleDateString('fr-FR')}
              </p>
            )}
            <input
              defaultValue={o.projet}
              key={`${o.i}-${o.projet}`}
              maxLength={30}
              placeholder="Projet (facultatif) — ex. Projet A"
              aria-label={`Projet de l'offre ${o.libelle}`}
              onBlur={(e) => e.target.value.trim() !== o.projet && onProjet(f, o.i, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="w-full h-11 mt-2 px-3 text-sm text-texte bg-carte border border-separateur rounded-imbrique outline-none focus:border-accent placeholder:text-texte-fantome"
            />

            {question?.i === o.i && (
              <div className="mt-2 rounded-imbrique border border-alerte/40 bg-alerte/10 px-3 py-3">
                <p className="text-sm text-texte">
                  {question.etape === 'calcul'
                    ? `${eur(o.montant)} € HT × 1,20 = ${eur(ttcDepuisHt(o.montant))} € TTC`
                    : `Ce montant est HT ou TTC ? ${o.libelle} — ${eur(o.montant)} €`}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {question.etape === 'calcul' ? (
                    <button
                      onClick={() => {
                        setQuestion(null)
                        onEtat(f, o.i, 'retenue', { base: 'ht' })
                      }}
                      className="min-h-11 px-4 rounded-full text-sm bg-accent text-white"
                    >
                      Confirmer {eur(ttcDepuisHt(o.montant))} € TTC
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setQuestion({ i: o.i, etape: 'calcul' })}
                        className="min-h-11 px-5 rounded-full text-sm bg-fond text-texte border border-separateur"
                      >
                        HT
                      </button>
                      <button
                        onClick={() => {
                          setQuestion(null)
                          onEtat(f, o.i, 'retenue', { base: 'ttc' })
                        }}
                        className="min-h-11 px-5 rounded-full text-sm bg-fond text-texte border border-separateur"
                      >
                        TTC
                      </button>
                    </>
                  )}
                  <button onClick={() => setQuestion(null)} className="min-h-11 px-4 text-sm text-texte-doux">
                    Annuler
                  </button>
                </div>
              </div>
            )}

            {report?.i === o.i && (
              <div className="mt-2">
                <p className="text-xs text-texte-faible mb-1.5">Date de reprise (facultative) — crée un rappel</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="date"
                    aria-label="Date de reprise de l'offre"
                    value={report.date}
                    onChange={(e) => setReport({ ...report, date: e.target.value })}
                    className="h-11 px-3 bg-carte border border-separateur rounded-imbrique text-texte"
                  />
                  <button
                    onClick={() => {
                      const date = report.date || null
                      setReport(null)
                      onEtat(f, o.i, 'reportee', { date_reprise: date })
                    }}
                    className="min-h-11 px-4 rounded-full text-sm bg-accent text-white"
                  >
                    Reporter l'offre
                  </button>
                  <button onClick={() => setReport(null)} className="min-h-11 px-2 text-sm text-texte-doux">
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {/* Proposition, jamais automatique : une offre est retenue, d'autres traînent « à trancher ». */}
      {onEcarterAutres && aUneRetenue && ouvertes > 0 && (
        <button
          onClick={() => onEcarterAutres(f)}
          className="mt-2 w-full min-h-11 px-4 rounded-imbrique border border-separateur bg-fond text-sm text-texte"
        >
          Écarter les autres offres de ce devis ({ouvertes})
        </button>
      )}
    </div>
  )
}
