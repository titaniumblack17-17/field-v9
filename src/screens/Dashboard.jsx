import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { lireAvecCache } from '../lib/cacheLecture'
import { nomClient } from '../lib/client'
import { aujourdhui as calculerAujourdhui, etatEcheanceTache, etatRappel } from '../lib/rappel'
import { aTrancher, fourchette, variantesDe } from '../lib/documents'
import {
  ETAPES_PROJET_LABELS,
  ETAPES_SIGNEES,
  STATUTS_SAV_LABELS,
  TYPE_LABELS,
  estEnAttente,
  exerciceDe,
  joursDevisSansReponse,
} from '../constants/dossiers'
import { COULEURS_OBJECTIF, COULEUR_PIPELINE, FAMILLES } from '../constants/dashboard'
import FeuilleBasse from '../components/FeuilleBasse'
import PastilleAttente from '../components/PastilleAttente'
import EtatErreur from '../components/EtatErreur'

const euros = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €'
// Un montant vide n'est pas 0 € : c'est un montant à chiffrer.
// « à chiffrer » seulement pour les dossiers dont le devis est parti (RPC :
// a_chiffrer) — jamais sur un prospect ; un montant total nul sans dossier à
// chiffrer s'affiche « — », jamais « 0 € ».
const montantOuAChiffrer = (montant, aChiffrer, nb) => {
  if (nb === 0) return '—'
  if (montant === 0) return aChiffrer > 0 ? 'à chiffrer' : '—'
  return euros(montant) + (aChiffrer > 0 ? ` · ${aChiffrer} à chiffrer` : '')
}

const R = 50
const TRAIT = 18
const TAILLE = 124
const CIRCONFERENCE = 2 * Math.PI * R

// Anneau SVG : chaque segment est un arc cliquable. Le centre porte le chiffre clé.
function Anneau({ segments, centre, libelle }) {
  const total = segments.reduce((t, s) => t + s.valeur, 0)
  let decalage = 0
  return (
    <div className="relative flex-shrink-0" style={{ width: TAILLE, height: TAILLE }}>
      <svg width={TAILLE} height={TAILLE} viewBox={`0 0 ${TAILLE} ${TAILLE}`} role="img" aria-label={libelle}>
        <circle cx={TAILLE / 2} cy={TAILLE / 2} r={R} fill="none" stroke="#2A2C33" strokeWidth={TRAIT} />
        {total > 0 &&
          segments.map((s) => {
            if (s.valeur <= 0) return null
            const longueur = (s.valeur / total) * CIRCONFERENCE
            const arc = (
              <circle
                key={s.cle}
                cx={TAILLE / 2}
                cy={TAILLE / 2}
                r={R}
                fill="none"
                stroke={s.couleur}
                strokeWidth={TRAIT}
                strokeDasharray={`${longueur} ${CIRCONFERENCE - longueur}`}
                strokeDashoffset={-decalage}
                transform={`rotate(-90 ${TAILLE / 2} ${TAILLE / 2})`}
                data-segment={s.cle}
                role={s.onClick ? 'button' : undefined}
                tabIndex={s.onClick ? 0 : undefined}
                aria-label={s.onClick ? s.label : undefined}
                onClick={s.onClick}
                onKeyDown={(e) => s.onClick && (e.key === 'Enter' || e.key === ' ') && s.onClick()}
                style={{ cursor: s.onClick ? 'pointer' : 'default', outline: 'none' }}
              />
            )
            decalage += longueur
            return arc
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
        {centre}
      </div>
    </div>
  )
}

function LigneLegende({ couleur, titre, valeur, detail, onClick }) {
  const contenu = (
    <>
      <span className="flex-shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: couleur }} aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-texte truncate">{titre}</span>
        {detail && <span className="block text-xs text-texte-doux">{detail}</span>}
      </span>
      <span className="flex-shrink-0 text-sm font-semibold text-texte tabular-nums">{valeur}</span>
      {onClick && (
        <span className="flex-shrink-0 text-texte-faible" aria-hidden="true">
          ›
        </span>
      )}
    </>
  )
  const classes = 'w-full min-h-11 flex items-center gap-2 text-left'
  return onClick ? (
    <button onClick={onClick} className={classes}>
      {contenu}
    </button>
  ) : (
    <div className={classes}>{contenu}</div>
  )
}

function Tuile({ titre, valeur, detail, urgent, onClick, petit }) {
  return (
    <button
      onClick={onClick}
      className="bg-carte rounded-xl shadow-sm px-3 py-3 text-left min-h-[88px] min-w-0 active:scale-[0.98] transition"
    >
      <p className="text-xs text-texte-doux truncate">{titre}</p>
      <p className={`${petit ? 'text-[15px] leading-8 whitespace-nowrap' : 'text-2xl'} font-bold tabular-nums mt-1 ${urgent ? 'text-alerte' : 'text-texte'}`}>{valeur}</p>
      {detail && <p className="text-xs text-texte-faible mt-0.5 truncate">{detail}</p>}
    </button>
  )
}

// Évolution : deux séries (pipeline en cours, signé) issues de pipeline_snapshots.
// Moins de SEUIL_COURBE jours de données : une courbe serait trompeuse, on le dit.
const SEUIL_COURBE = 7

function Evolution({ serie }) {
  const [choisi, setChoisi] = useState(null)
  const n = serie.length
  if (n < SEUIL_COURBE) {
    const dernier = serie[n - 1]
    return (
      <div>
        <p className="text-sm text-texte-doux">Courbe en construction · {n} jour{n > 1 ? 's' : ''} de données</p>
        {dernier && (
          <p className="text-xs text-texte-faible mt-1 tabular-nums">
            Aujourd'hui — pipeline en cours {euros(dernier.pipeline)} · signé {euros(dernier.signe)}
          </p>
        )}
      </div>
    )
  }
  const L = 320
  const H = 120
  const max = Math.max(1, ...serie.flatMap((s) => [Number(s.pipeline), Number(s.signe)]))
  const x = (i) => (n === 1 ? L / 2 : (i / (n - 1)) * (L - 8) + 4)
  const y = (v) => H - 6 - (Number(v) / max) * (H - 14)
  const ligne = (cle) => serie.map((s, i) => `${x(i)},${y(s[cle])}`).join(' ')
  const sur = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const rel = ((e.clientX - r.left) / r.width) * L
    let proche = 0
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - rel) < Math.abs(x(proche) - rel)) proche = i
    setChoisi(proche)
  }
  const pt = choisi != null ? serie[choisi] : null
  return (
    <div>
      <svg viewBox={`0 0 ${L} ${H}`} className="w-full h-32" onClick={sur} role="img" aria-label="Évolution du pipeline et du signé">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={L} y1={H - 6 - f * (H - 14)} y2={H - 6 - f * (H - 14)} stroke="#2A2C33" strokeWidth="1" />
        ))}
        <polyline points={ligne('pipeline')} fill="none" stroke={COULEUR_PIPELINE} strokeWidth="2" />
        <polyline points={ligne('signe')} fill="none" stroke={COULEURS_OBJECTIF.signe} strokeWidth="2" />
        {pt && <line x1={x(choisi)} x2={x(choisi)} y1="0" y2={H} stroke="#8B8B93" strokeWidth="1" strokeDasharray="3 3" />}
      </svg>
      <p className="text-xs text-texte-doux tabular-nums min-h-8 mt-1">
        {pt
          ? `${new Date(pt.jour + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — pipeline en cours ${euros(pt.pipeline)} · signé ${euros(pt.signe)}`
          : 'Touchez la courbe pour lire une valeur.'}
      </p>
      <p className="text-xs text-texte-faible flex gap-3">
        <span><span style={{ color: COULEUR_PIPELINE }}>●</span> Pipeline en cours</span>
        <span><span style={{ color: COULEURS_OBJECTIF.signe }}>●</span> Signé</span>
      </p>
    </div>
  )
}

const lire = (cle, requete) => lireAvecCache(cle, () => requete().then(({ data, error }) => {
  if (error) throw new Error(error.message)
  return data ?? []
}))

export default function Dashboard({ onBack, onOpenDossier, onPipeline }) {
  const [chiffres, setChiffres] = useState(null)
  const [dossiers, setDossiers] = useState([])
  const [fichiers, setFichiers] = useState([])
  const [taches, setTaches] = useState([])
  const [depuisCache, setDepuisCache] = useState(false)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState(null)
  const [tentative, setTentative] = useState(0)
  const [feuille, setFeuille] = useState(null)
  const fermer = useCallback(() => setFeuille(null), [])

  const charger = useCallback(async () => {
    try {
      const [c, d, f, t] = await Promise.all([
        lireAvecCache('dashboard-chiffres', async () => {
          const { data, error } = await supabase.rpc('dashboard_chiffres')
          if (error) throw new Error(error.message)
          return data
        }),
        lire('brief-dossiers', () =>
          supabase
            .from('dossiers')
            .select('*, clients(id, prenom_praticien, nom_praticien, nom_cabinet, ville, telephone_portable, telephone_cabinet)')
        ),
        lire('dashboard-fichiers', () =>
          supabase
            .from('fichiers')
            .select('id, dossier_id, type_doc, montant_ttc, variantes, a_trancher_raison, decision, date_reprise, nom')
            .not('dossier_id', 'is', null)
        ),
        lire('brief-taches', () =>
          supabase.from('dossier_note_taches').select('*').eq('fait', false).not('echeance', 'is', null)
        ),
      ])
      setChiffres(c.valeur)
      setDossiers(d.valeur)
      setFichiers(f.valeur)
      setTaches(t.valeur)
      setDepuisCache(c.depuisCache || d.depuisCache || f.depuisCache || t.depuisCache)
      setErreur(null)
    } catch {
      setErreur('Impossible de charger le dashboard.')
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => {
    setChargement(true)
    charger()
  }, [charger, tentative])

  // Temps réel : INSERT, UPDATE et DELETE sur les quatre tables dont le Dashboard
  // dépend rechargent les chiffres (regroupés : un même geste en déclenche plusieurs).
  const minuteur = useRef(null)
  useEffect(() => {
    const replanifier = () => {
      clearTimeout(minuteur.current)
      minuteur.current = setTimeout(charger, 500)
    }
    let canal = supabase.channel('dashboard-temps-reel')
    for (const table of ['dossiers', 'fichiers', 'dossier_note_taches', 'pipeline_snapshots']) {
      canal = canal.on('postgres_changes', { event: '*', schema: 'public', table }, replanifier)
    }
    canal.subscribe()
    return () => {
      clearTimeout(minuteur.current)
      supabase.removeChannel(canal)
    }
  }, [charger])

  // ─── Listes derrière chaque chiffre : mêmes règles que la RPC ───
  const listes = useMemo(() => {
    if (!chiffres) return null
    const aujourdhui = calculerAujourdhui()
    const annee = chiffres.annee
    const projets = dossiers.filter((d) => d.type === 'projet')
    const parDossier = (type) => new Set(fichiers.filter((f) => f.type_doc === type).map((f) => f.dossier_id))
    const avecDevis = parDossier('devis')
    const avecCdc = parDossier('cdc')
    const nom = (d) => nomClient(d.clients) ?? '—'
    const ligne = (d, motif, cle = d.id) => ({ cle, dossier: d, nom: nom(d), titre: d.titre || TYPE_LABELS[d.type], motif })

    // Dossiers reportés : au moins un devis mis de côté, aucun retenu — hors signé et hors à trancher.
    const retenus = new Set(fichiers.filter((f) => f.type_doc === 'devis' && f.decision === 'retenu').map((f) => f.dossier_id))
    const misDeCote = fichiers.filter((f) => f.type_doc === 'devis' && f.decision === 'mis_de_cote')
    const reportesIds = new Set(misDeCote.map((f) => f.dossier_id).filter((id) => !retenus.has(id)))

    const signes = projets
      .filter((d) => !reportesIds.has(d.id) && d.statut !== 'perdu' && ETAPES_SIGNEES.includes(d.statut) && exerciceDe(d, annee) === annee)
      .map((d) =>
        ligne(d, `${ETAPES_PROJET_LABELS[d.statut] ?? d.statut} · ${d.montant_estime == null ? 'à chiffrer' : euros(d.montant_estime)}`)
      )

    const devisATrancher = fichiers.filter((f) => aTrancher(f) && !reportesIds.has(f.dossier_id))
    const dossiersATrancher = [...new Set(devisATrancher.map((f) => f.dossier_id))]
    const atrancher = dossiersATrancher
      .map((id) => dossiers.find((d) => d.id === id))
      .filter(Boolean)
      .map((d) => {
        const siens = devisATrancher.filter((f) => f.dossier_id === d.id)
        const motifs = siens.map((f) => {
          const r = fourchette(f)
          const offres = variantesDe(f).length
          const plage = r ? (r.min === r.max ? euros(r.min) : `${euros(r.min)} – ${euros(r.max)}`) : null
          return f.a_trancher_raison
            ? `HT ou TTC à préciser${plage ? ` (${plage})` : ''}`
            : `${offres} offres à trancher${plage ? ` · ${plage}` : ''}`
        })
        return ligne(d, `${siens.length} devis · ${motifs.join(' ; ')}`)
      })

    const apresDevis = ['devis_envoye', 'relance', 'visite_local', 'negociation', 'confirmation', 'financement', 'commande', 'reunion_chantier', 'installation', 'finition']
    const incomplets = projets
      .filter((d) => d.statut !== 'perdu' && d.statut !== 'termine')
      .map((d) => {
        const manques = []
        if (apresDevis.includes(d.statut) && !avecDevis.has(d.id)) manques.push('devis manquant')
        if (d.plan_statut && !avecCdc.has(d.id)) manques.push('cahier des charges manquant')
        return manques.length ? ligne(d, manques.join(' · ')) : null
      })
      .filter(Boolean)

    const reportes = [...reportesIds]
      .map((id) => dossiers.find((d) => d.id === id))
      .filter(Boolean)
      .map((d) => {
        const siens = misDeCote.filter((f) => f.dossier_id === d.id)
        const reprise = siens.map((f) => f.date_reprise).filter(Boolean).sort()[0]
        return ligne(d, `${siens.length} devis mis de côté${reprise ? ` · reprise le ${new Date(reprise + 'T00:00:00').toLocaleDateString('fr-FR')}` : ''}`)
      })

    const attente = dossiers.filter(estEnAttente).map((d) => ({ ...ligne(d, null), pastille: true }))

    const retard = []
    const rappelsDus = dossiers.filter((d) => d.rappel_date && d.rappel_date <= aujourdhui)
    const dusIds = new Set(rappelsDus.map((d) => d.id))
    for (const d of rappelsDus) {
      retard.push(ligne(d, `Rappel · ${etatRappel(d.rappel_date, d.rappel_heure)?.texte ?? ''}${d.rappel_note ? ` — ${d.rappel_note}` : ''}`, `rappel-${d.id}`))
    }
    for (const d of dossiers.filter((x) => x.type === 'sav' && !['clos', 'en_attente'].includes(x.statut))) {
      retard.push(ligne(d, `SAV ${STATUTS_SAV_LABELS[d.statut] ?? d.statut}`, `sav-${d.id}`))
    }
    for (const t of taches) {
      const d = dossiers.find((x) => x.id === t.dossier_id)
      if (d && etatEcheanceTache(t.echeance)?.echu) {
        retard.push(ligne(d, `Tâche · ${etatEcheanceTache(t.echeance)?.texte} — ${t.texte}`, `tache-${t.id}`))
      }
    }
    for (const d of projets) {
      const jours = joursDevisSansReponse(d)
      if (jours != null && !dusIds.has(d.id)) retard.push(ligne(d, `Devis sans réponse · ${jours} j`, `devis-${d.id}`))
    }

    return { signes, atrancher, nbDevisATrancher: devisATrancher.length, incomplets, attente, retard, reportes }
  }, [chiffres, dossiers, fichiers, taches])

  if (chargement && !chiffres) {
    return (
      <div className="min-h-screen bg-fond px-4 pt-6">
        <p className="text-texte-faible text-sm">Chargement…</p>
      </div>
    )
  }
  if (erreur && !chiffres) {
    return (
      <div className="min-h-screen bg-fond px-4 pt-6">
        <EtatErreur message={erreur} onReessayer={() => setTentative((t) => t + 1)} />
      </div>
    )
  }

  const { objectif, signe, a_trancher: at, familles, projets_actifs: nbActifs } = chiffres
  const pourcentage = Math.round((Number(signe.montant) / objectif) * 100)
  const aTrancherMontant = Number(at.montant_min_hors_signes)
  const reste = Math.max(0, objectif - Number(signe.montant) - aTrancherMontant)
  const serie = chiffres.serie ?? []

  const vers = (f) => onPipeline('projet', f.etapes[0], f)

  const configListe = {
    signes: { titre: `Signé · ${signe.nb} dossiers`, lignes: listes.signes },
    trancher: { titre: `À trancher · ${at.devis} devis · ${at.dossiers} dossier${at.dossiers > 1 ? 's' : ''}`, lignes: listes.atrancher },
    incomplets: { titre: `Incomplets · ${chiffres.incomplets.dossiers} dossiers`, lignes: listes.incomplets },
    attente: { titre: `En attente · ${chiffres.en_attente.dossiers}`, lignes: listes.attente },
    retard: { titre: `En retard · ${chiffres.en_retard.total}`, lignes: listes.retard },
    reportes: { titre: `Reportés · ${chiffres.reportes?.devis ?? 0} devis · ${chiffres.reportes?.dossiers ?? 0} dossier${(chiffres.reportes?.dossiers ?? 0) > 1 ? 's' : ''}`, lignes: listes.reportes },
  }
  const liste = feuille ? configListe[feuille] : null

  return (
    <div className="min-h-screen bg-fond">
      <header className="px-4 pt-6 pb-3 flex items-center gap-2">
        <button onClick={onBack} className="text-accent text-sm font-semibold h-11 -ml-2 pl-2 pr-1 flex items-center">
          ← Brief
        </button>
        <h1 className="text-lg font-bold text-texte">Dashboard</h1>
      </header>

      <main className="px-4 pb-10">
        {depuisCache && (
          <p className="text-xs text-alerte mb-2 px-1">⚠ Dernières valeurs connues — hors ligne, peut ne pas refléter les derniers changements</p>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tuile
            titre="À trancher"
            valeur={`${at.devis} devis · ${at.dossiers} dossier${at.dossiers > 1 ? 's' : ''}`}
            detail="offres ou HT/TTC à décider"
            petit
            urgent={at.devis > 0}
            onClick={() => setFeuille('trancher')}
          />
          <Tuile
            titre="Incomplets"
            valeur={chiffres.incomplets.dossiers}
            detail={`${chiffres.incomplets.sans_devis} sans devis · ${chiffres.incomplets.sans_cdc} sans CDC`}
            onClick={() => setFeuille('incomplets')}
          />
          <Tuile
            titre="En attente"
            valeur={chiffres.en_attente.dossiers}
            detail="un tiers doit répondre"
            onClick={() => setFeuille('attente')}
          />
          <Tuile
            titre="En retard"
            valeur={chiffres.en_retard.total}
            detail="comme « Aussi à traiter »"
            urgent={chiffres.en_retard.total > 0}
            onClick={() => setFeuille('retard')}
          />
        </div>

        {(chiffres.reportes?.dossiers ?? 0) > 0 && (
          <button
            onClick={() => setFeuille('reportes')}
            className="mt-3 w-full min-h-11 bg-carte rounded-xl px-4 flex items-center justify-between gap-3 text-left"
          >
            <span className="text-sm text-texte">Reportés</span>
            <span className="text-sm text-texte-doux tabular-nums">
              {chiffres.reportes.devis} devis · {chiffres.reportes.dossiers} dossier{chiffres.reportes.dossiers > 1 ? 's' : ''} ›
            </span>
          </button>
        )}

        <section className="mt-4 bg-carte rounded-xl p-4" aria-label="Objectif">
          <h2 className="text-xs text-texte-faible uppercase tracking-wider mb-3">Objectif {chiffres.annee}</h2>
          <div className="flex items-start gap-3">
            <Anneau
              libelle={`Objectif ${chiffres.annee} : ${pourcentage} % signé`}
              segments={[
                { cle: 'signe', valeur: Number(signe.montant), couleur: COULEURS_OBJECTIF.signe, label: 'Signé : voir les dossiers', onClick: () => setFeuille('signes') },
                { cle: 'a-trancher', valeur: aTrancherMontant, couleur: COULEURS_OBJECTIF.aTrancher, label: 'À trancher : voir les devis', onClick: () => setFeuille('trancher') },
                { cle: 'reste', valeur: reste, couleur: COULEURS_OBJECTIF.reste, label: 'Reste à faire' },
              ]}
              centre={
                <>
                  <span className="text-2xl font-bold text-texte tabular-nums leading-none">{pourcentage} %</span>
                  <span className="text-[11px] text-texte-doux mt-1">de 5 M€</span>
                </>
              }
            />
            <div className="flex-1 min-w-0">
              <LigneLegende
                couleur={COULEURS_OBJECTIF.signe}
                titre="Signé"
                valeur={euros(Number(signe.montant))}
                detail={`${signe.nb} dossiers${signe.sans_montant > 0 ? ` · ${signe.sans_montant} à chiffrer` : ''}`}
                onClick={() => setFeuille('signes')}
              />
              <LigneLegende
                couleur={COULEURS_OBJECTIF.aTrancher}
                titre="À trancher"
                valeur={aTrancherMontant > 0 ? `≥ ${euros(aTrancherMontant)}` : '—'}
                detail={`${at.devis} devis · ${at.dossiers} dossier${at.dossiers > 1 ? 's' : ''}`}
                onClick={() => setFeuille('trancher')}
              />
              <LigneLegende couleur={COULEURS_OBJECTIF.reste} titre="Reste à faire" valeur={euros(reste)} />
            </div>
          </div>
        </section>

        <section className="mt-4 bg-carte rounded-xl p-4" aria-label="Pipeline">
          <h2 className="text-xs text-texte-faible uppercase tracking-wider mb-3">Pipeline</h2>
          <div className="flex items-start gap-3">
            <Anneau
              libelle={`Pipeline : ${nbActifs} projets actifs`}
              segments={FAMILLES.map((f) => ({
                cle: f.cle,
                valeur: familles.find((x) => x.cle === f.cle)?.nb ?? 0,
                couleur: f.couleur,
                label: `${f.libelle} : voir dans le Pipeline`,
                onClick: () => vers(f),
              }))}
              centre={
                <>
                  <span className="text-2xl font-bold text-texte tabular-nums leading-none">{nbActifs}</span>
                  <span className="text-[11px] text-texte-doux mt-1">projets actifs</span>
                </>
              }
            />
            <div className="flex-1 min-w-0">
              {FAMILLES.map((f) => {
                const x = familles.find((y) => y.cle === f.cle) ?? { nb: 0, montant: 0, a_chiffrer: 0 }
                return (
                  <LigneLegende
                    key={f.cle}
                    couleur={f.couleur}
                    titre={f.libelle}
                    valeur={x.nb}
                    detail={montantOuAChiffrer(Number(x.montant), x.a_chiffrer, x.nb)}
                    onClick={() => vers(f)}
                  />
                )
              })}
            </div>
          </div>
        </section>

        <section className="mt-4 bg-carte rounded-xl p-4" aria-label="Évolution">
          <h2 className="text-xs text-texte-faible uppercase tracking-wider mb-3">Évolution</h2>
          <Evolution serie={serie} />
        </section>
      </main>

      {liste && (
        <FeuilleBasse titre={liste.titre} onFermer={fermer}>
          {liste.lignes.length === 0 ? (
            <p className="text-texte-faible text-sm py-4">Rien à afficher.</p>
          ) : (
            <ul className="divide-y divide-separateur">
              {liste.lignes.map((l) => (
                <li key={l.cle}>
                  <button
                    onClick={() => {
                      fermer()
                      onOpenDossier(l.dossier)
                    }}
                    className="w-full min-h-14 py-2 text-left"
                  >
                    <span className="block text-[15px] font-bold text-texte truncate">{l.nom}</span>
                    <span className="block text-xs text-texte-doux truncate">{l.titre}</span>
                    {l.pastille ? (
                      <PastilleAttente dossier={l.dossier} className="mt-1" />
                    ) : (
                      <span className="block text-xs text-alerte mt-0.5">{l.motif}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FeuilleBasse>
      )}
    </div>
  )
}
