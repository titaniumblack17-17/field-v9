import React, { useEffect, useMemo, useRef, useState } from 'react'
import usePrompt from '../hooks/usePrompt'
import { supabase } from '../lib/supabaseClient'
import EtatErreur from '../components/EtatErreur'
import JaugeObjectif from '../components/JaugeObjectif'
import { etatRappel, cloreProchainRappel, reconcilierRappels } from '../lib/rappel'
import { nomClient } from '../lib/client'
import {
  ETAPES_PROJET,
  PLAN_STATUT_LABELS,
  STATUTS_PLAN_LABELS,
  STATUTS_SAV_LABELS,
  PLAN_SANS_COMMERCIAL,
  TYPE_LABELS,
  styleDossier,
  joursDevisSansReponse,
} from '../constants/dossiers'

// Objectif annuel de la spec (§1) : 5 M€ TTC.
const OBJECTIF_ANNUEL = 5_000_000

// Un dossier réglé appartient à l'exercice de son règlement ; un dossier
// encore ouvert appartient à l'exercice en cours. Le 1er janvier, ce qui n'a
// pas été réglé bascule donc de lui-même sur la nouvelle année — sans clôture
// à faire, sans report à saisir.
const exerciceDe = (dossier, anneeCourante) => {
  if (!ETAPES_FACTUREES.includes(dossier.statut)) return anneeCourante
  const regle = dossier.closed_at ?? dossier.date_installation
  return regle ? Number(String(regle).slice(0, 4)) : anneeCourante
}

// Signé : la commande est passée, la vente est faite. Ce qui suit relève de la
// logistique, pas de la prospection. « Terminé » en fait partie : classer un
// dossier ne doit pas le faire disparaître de l'objectif de l'année.
const ETAPES_SIGNEES = ['commande', 'reunion_chantier', 'installation', 'finition', 'financement', 'termine']

// Facturé : l'installation est terminée. Aucune étape ne s'appelait « facturé »
// avant « Terminé » — la finition en tenait lieu, et continue de compter une
// fois le dossier classé.
const ETAPES_FACTUREES = ['finition', 'termine']

const euros = (n) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €'

const libelleEtape = (v) => ETAPES_PROJET.find(([k]) => k === v)?.[1] ?? v

function Ligne({ dossier, onOuvrir, droite, droiteClasse, alerte, onFait, sousTitre, ligneSecondaire }) {
  const s = styleDossier(dossier)
  const [enCours, setEnCours] = useState(false)

  const fait = async (e) => {
    e.stopPropagation()
    setEnCours(true)
    await onFait(dossier)
    setEnCours(false)
  }

  return (
    <li
      style={{ borderColor: s.bordure }}
      className="bg-carte rounded-xl shadow-sm border-l-[7px] flex items-stretch"
    >
      <button
        onClick={() => onOuvrir(dossier)}
        className="flex-1 min-w-0 text-left px-4 py-3 active:scale-[0.98] transition flex items-center gap-3"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-texte truncate">{nomClient(dossier.clients) ?? '—'}</p>
          <p className="text-sm text-texte-doux truncate">
            {dossier.commercial ? `${dossier.commercial} · ` : ''}
            {/* Le titre du dossier est souvent vide ou générique
                (« Projet de vente ») : sur un rappel, ce qui compte, c'est
                l'objet de l'appel, pas le type du dossier. */}
            {ligneSecondaire || dossier.titre || TYPE_LABELS[dossier.type]}
          </p>
          {sousTitre && <p className="text-xs text-alerte mt-0.5">{sousTitre}</p>}
          {PLAN_SANS_COMMERCIAL(dossier) && (
            <p className="text-xs text-alerte mt-0.5">Commercial à préciser</p>
          )}
        </div>
        {droite && (
          // Une couleur fournie l'emporte : un retard doit rester rouge même
          // dans une section dont le défaut est orange.
          <span
            className={`text-sm flex-shrink-0 text-right ${
              droiteClasse ?? (alerte ? 'text-alerte font-medium' : 'text-texte-doux')
            }`}
          >
            {droite}
          </span>
        )}
      </button>
      {onFait && (
        <button
          onClick={fait}
          disabled={enCours}
          aria-label="Marquer le rappel comme fait"
          title="Rappel fait"
          className="w-14 flex-shrink-0 flex items-center justify-center text-texte-fantome text-xl active:text-accent disabled:opacity-40 border-l border-separateur"
        >
          {enCours ? '…' : '✓'}
        </button>
      )}
    </li>
  )
}

// En-tête partagé par Section et CarteResume : une seule apparence de carte
// repliable (chevron ▶ rotate-90 à l'ouverture, compteur coloré à droite)
// pour toute la page, du premier regard jusqu'à « À chiffrer » — jamais de
// section qui détonne visuellement des deux autres. Toujours affiché, même
// à 0 : le chevron ne se cache pas selon le contenu, seul le corps change.
function EnTeteCarte({ titre, compte, urgent, ouverte, onToggle }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-3 text-left">
      <span
        className={`text-texte-faible text-[10px] flex-shrink-0 transition-transform ${ouverte ? 'rotate-90' : ''}`}
        aria-hidden="true"
      >
        ▶
      </span>
      <span className="flex-1 text-sm font-medium text-texte truncate">{titre}</span>
      <span className={`text-sm font-semibold flex-shrink-0 ${urgent ? 'text-alerte' : 'text-texte-doux'}`}>
        {compte}
      </span>
    </button>
  )
}

// État ouvert/fermé toujours contrôlé par le parent (pas de useState local) :
// sauter à une section via une pastille ou un lien « Voir les N autres »
// doit pouvoir la forcer ouverte avant d'y défiler.
function Section({ sectionRef, titre, compte, urgent, vide, ouverte, onToggle, children }) {
  return (
    <section ref={sectionRef} className="mt-6 scroll-mt-32 bg-carte rounded-xl overflow-hidden">
      <EnTeteCarte titre={titre} compte={compte} urgent={urgent && compte > 0} ouverte={ouverte} onToggle={onToggle} />
      {ouverte && (
        <div className="px-4 pb-3">
          {compte === 0 ? (
            <p className="text-texte-faible text-sm">{vide}</p>
          ) : (
            <ul className="space-y-2">{children}</ul>
          )}
        </div>
      )}
    </section>
  )
}

// Une carte par information critique du premier regard (SAV, À rappeler,
// Devis sans réponse — l'Objectif s'affiche à part, en jauge complète juste
// au-dessus). Le compte et les 2 dossiers les plus urgents sont visibles
// sans taper : le tap replie/déplie pour dégager de la place une fois le
// point fait, jamais pour révéler une info qui devrait déjà être là.
function CarteResume({ titre, compte, urgent, vide, items, onVoirTout }) {
  const [ouverte, setOuverte] = useState(compte > 0)
  const restants = compte - items.length

  return (
    <div className="bg-carte rounded-xl overflow-hidden">
      <EnTeteCarte titre={titre} compte={compte} urgent={urgent} ouverte={ouverte} onToggle={() => setOuverte((v) => !v)} />
      {ouverte && (
        <div className="px-4 pb-3">
          {compte === 0 ? (
            <p className="text-xs text-texte-doux">{vide}</p>
          ) : (
            <div className="space-y-1.5">
              {items.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-texte truncate">{it.nom}</span>
                  <span className={`flex-shrink-0 ${it.classe}`}>{it.droite}</span>
                </div>
              ))}
              {restants > 0 && (
                <button onClick={onVoirTout} className="text-accent text-xs pt-0.5">
                  Voir {restants > 1 ? `les ${restants} autres` : `l'autre`} →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BriefSoir({ onBack, onOpenDossier }) {
  const [dossiers, setDossiers] = useState([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState(null)
  const [tentative, setTentative] = useState(0)
  const [demanderTexte, boîtePrompt] = usePrompt()

  // Premier regard : jauge Objectif + cartes-résumé (À rappeler, SAV,
  // Devis) tout en haut, sans défiler. Les pastilles plus bas (Rappels à
  // venir, Plans, Règlements, À chiffrer inclus) et les liens « Voir les
  // N autres » des cartes-résumé partagent les mêmes refs pour sauter
  // directement à la section concernée.
  const sectionRefs = useRef({})

  // SAV/Devis/À rappeler ouvertes par défaut (on y arrive via « Voir les N
  // autres » depuis leur carte-résumé — un second tap pour voir ce qu'on est
  // venu chercher serait absurde) ; Rappels à venir/Plans/Règlements/À
  // chiffrer repliées par défaut (clé absente). État levé ici plutôt que
  // local à chaque section, pour qu'une pastille ou un lien « Voir les N
  // autres » puisse forcer l'ouverture de sa cible avant d'y sauter.
  const [sectionsOuvertes, setSectionsOuvertes] = useState({ sav: true, devis: true, rappeler: true })
  const toggleSection = (cle) => setSectionsOuvertes((s) => ({ ...s, [cle]: !s[cle] }))
  const allerASection = (cle) => {
    // Le haut de la section ne bouge pas quand son contenu se déplie en
    // dessous : pas besoin d'attendre le re-rendu avant de lancer le scroll.
    setSectionsOuvertes((s) => (s[cle] ? s : { ...s, [cle]: true }))
    sectionRefs.current[cle]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Retrait immédiat plutôt qu'attendre une relecture : on vient de le faire,
  // le voir rester dans « À rappeler » ferait douter que ça ait pris.
  const rappelFait = async (dossier) => {
    // Le commentaire se demande au moment du geste : c'est là qu'on sait ce
    // qui s'est dit, pas au prochain passage sur la fiche.
    const commentaire = await demanderTexte('Qu\'est-ce qu\'il faut en retenir ?', {
      titre: dossier.rappel_note || dossier.titre || 'Rappel',
      confirmLabel: 'Valider',
    })
    if (commentaire === null) return
    const r = await cloreProchainRappel(dossier.id, commentaire)
    if (r?.erreur) return
    setDossiers((cur) =>
      cur.map((d) => (d.id === dossier.id ? { ...d, rappel_date: null, rappel_note: null } : d))
    )
  }

  useEffect(() => {
    let actif = true
    setChargement(true)
    setErreur(null)

    // Réconcilier avant de lire, jamais après : le Brief est le moment où l'on
    // décide quoi faire ce soir. Réclamer un appel déjà passé sur la montre
    // ferait perdre la confiance dans la liste entière.
    reconcilierRappels()
      .then(() =>
        supabase
          .from('dossiers')
          .select('*, clients(id, prenom_praticien, nom_praticien, nom_cabinet, ville)')
      )
      .then(({ data, error }) => {
        if (!actif) return
        if (error) {
          setErreur('Impossible de charger le brief.')
          setChargement(false)
          return
        }
        setDossiers(data ?? [])
        setChargement(false)
      })
      .catch(() => {
        if (actif) {
          setErreur('Impossible de charger le brief.')
          setChargement(false)
        }
      })

    // Seul écran de l'app sans abonnement temps réel jusqu'ici : un rappel
    // clos sur l'iPhone restait visible sur un onglet Mac déjà ouvert, sans
    // aucun moyen de le savoir sans recharger. Un dossier suffit à recevoir
    // le reflet (rappel_date/heure/note) posé par le déclencheur en base ;
    // pas besoin d'écouter la table rappels séparément.
    const canal = supabase
      .channel('brief-dossiers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dossiers' },
        (payload) => {
          setDossiers((cur) => {
            if (payload.eventType === 'INSERT') {
              return cur.some((d) => d.id === payload.new.id) ? cur : [...cur, payload.new]
            }
            if (payload.eventType === 'UPDATE') {
              // Le realtime ne renvoie pas la jointure clients : on la
              // reprend de la ligne locale pour ne pas perdre le nom affiché.
              return cur.map((d) =>
                d.id === payload.new.id ? { ...payload.new, clients: d.clients } : d
              )
            }
            if (payload.eventType === 'DELETE') {
              return cur.filter((d) => d.id !== payload.old.id)
            }
            return cur
          })
        }
      )
      .subscribe()

    return () => {
      actif = false
      supabase.removeChannel(canal)
    }
  }, [tentative])

  const bilan = useMemo(() => {
    const aujourdhui = new Date().toISOString().slice(0, 10)
    const annee = new Date().getFullYear()
    const projets = dossiers.filter((d) => d.type === 'projet')

    // Les affaires réglées lors d'un exercice passé sont soldées : elles ne
    // pèsent plus sur l'objectif de cette année.
    const actifs = projets.filter(
      (d) => d.statut !== 'perdu' && exerciceDe(d, annee) === annee
    )

    // Un SAV ouvert, c'est un praticien qui ne peut pas travailler. Ça passe
    // avant un rappel commercial, et ça n'a pas besoin d'un écran à soi : un
    // onglet séparé qu'on n'ouvre pas serait pire que rien.
    const savOuverts = dossiers
      .filter((d) => d.type === 'sav' && d.statut !== 'clos')
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))

    // Un devis sans réponse depuis plus d'un mois n'est plus une affaire en
    // cours : soit il se relance, soit il faut le passer perdu et rouvrir un
    // nouveau dossier si le client revient — mais ça se décide, ça ne se
    // laisse pas dormir en « Devis envoyé ».
    const devisSansReponse = dossiers
      .filter((d) => joursDevisSansReponse(d) != null)
      .sort((a, b) => joursDevisSansReponse(b) - joursDevisSansReponse(a))

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
    const signes = actifs.filter((d) => ETAPES_SIGNEES.includes(d.statut))
    const factures = actifs.filter((d) => ETAPES_FACTUREES.includes(d.statut))

    return {
      savOuverts,
      devisSansReponse,
      aRappeler,
      aVenir,
      plansAProduire,
      reglements,
      duParPlans: reglements.length * 500,
      projection: somme(actifs),
      signe: somme(signes),
      facture: somme(factures),
      // Le trou le plus coûteux n'est pas dans le pipeline lointain : c'est une
      // commande signée sans montant, qui manque à l'objectif sans se voir.
      signesSansMontant: signes.filter((d) => d.montant_estime == null).length,
      nbSignes: signes.length,
      annee,
      // Ce qui basculera sur l'exercice suivant s'il n'est pas réglé d'ici là.
      reportables: signes.filter((d) => !ETAPES_FACTUREES.includes(d.statut)).length,
      chiffres: actifs.filter((d) => d.montant_estime != null).length,
      totalActifs: actifs.length,
      sansMontant: actifs.filter((d) => d.montant_estime == null),
      planFacture: dossiers.filter(
        (d) => d.type === 'plan' && d.remuneration_type === 'facture' && d.statut === 'solde'
      ).length,
    }
  }, [dossiers])

  const couvertureFaible =
    bilan.signesSansMontant > 0 || (bilan.totalActifs > 0 && bilan.chiffres < bilan.totalActifs / 2)

  // Une pastille par section peuplée, colorée quand elle attend une décision
  // ce soir plutôt qu'un simple suivi. L'ordre reprend celui des sections :
  // sauter à une pastille retrouve toujours la même section plus bas.
  const pastilles = [
    { cle: 'sav', titre: 'SAV', compte: bilan.savOuverts.length, urgent: bilan.savOuverts.some((d) => d.statut !== 'en_attente') },
    { cle: 'devis', titre: 'Devis oubliés', compte: bilan.devisSansReponse.length, urgent: bilan.devisSansReponse.length > 0 },
    { cle: 'rappeler', titre: 'À rappeler', compte: bilan.aRappeler.length, urgent: bilan.aRappeler.length > 0 },
    { cle: 'avenir', titre: 'À venir', compte: bilan.aVenir.length, urgent: false },
    { cle: 'plans', titre: 'Plans', compte: bilan.plansAProduire.length, urgent: false },
    { cle: 'reglements', titre: 'Règlements', compte: bilan.reglements.length, urgent: bilan.reglements.some((d) => d.statut === 'reglement_demande') },
    { cle: 'chiffrer', titre: 'À chiffrer', compte: bilan.sansMontant.length, urgent: false },
  ].filter((p) => p.compte > 0)

  return (
    <div className="min-h-screen bg-fond">
      <div className="sticky top-0 z-10 bg-fond/90 backdrop-blur">
        <header className="px-4 pt-6 pb-3 flex items-center gap-3">
          <button onClick={onBack} className="text-accent text-sm font-medium h-11 -ml-2 pl-2 pr-1 flex items-center">
            ← Clients
          </button>
          <h1 className="text-lg font-semibold text-texte">Brief soir</h1>
        </header>
      </div>

      <main className="px-4 pb-8">
        {chargement && <p className="text-texte-faible text-sm">Point avec Todoist…</p>}

        {!chargement && erreur && (
          <EtatErreur message={erreur} onReessayer={() => setTentative((t) => t + 1)} />
        )}

        {!chargement && !erreur && (
          <>
            <section className="mt-6">
              <h2 className="text-xs text-texte-faible uppercase tracking-wider px-1 mb-2">
                Objectif {bilan.annee}
              </h2>
              <JaugeObjectif
                annee={bilan.annee}
                projection={bilan.projection}
                signe={bilan.signe}
                facture={bilan.facture}
                reportables={bilan.reportables}
              />
              {bilan.planFacture > 0 && (
                <p className="text-xs text-texte-doux mt-2 px-1">
                  Casquette technique, hors objectif : {bilan.planFacture} plan
                  {bilan.planFacture > 1 ? 's' : ''} soldé{bilan.planFacture > 1 ? 's' : ''} ·{' '}
                  {euros(bilan.planFacture * 500)}
                </p>
              )}
            </section>

            {/* Pas dans les 4 informations du premier regard demandées :
                l'alerte pousserait « Devis sans réponse » sous la ligne de
                flottaison à 375px quand elle est active. Elle reste juste
                avant « À chiffrer », la section qu'elle concerne. */}

            <div className="mt-4 space-y-2">
              <CarteResume
                titre="À rappeler"
                compte={bilan.aRappeler.length}
                urgent={bilan.aRappeler.length > 0}
                vide="Aucun rappel en retard."
                items={bilan.aRappeler.slice(0, 2).map((d) => ({
                  id: d.id,
                  nom: nomClient(d.clients) ?? '—',
                  droite: etatRappel(d.rappel_date, d.rappel_heure)?.texte,
                  classe: etatRappel(d.rappel_date, d.rappel_heure)?.classe,
                }))}
                onVoirTout={() => allerASection('rappeler')}
              />
              <CarteResume
                titre="SAV ouverts"
                compte={bilan.savOuverts.length}
                urgent={bilan.savOuverts.some((d) => d.statut !== 'en_attente')}
                vide="Aucun SAV en cours."
                items={bilan.savOuverts.slice(0, 2).map((d) => ({
                  id: d.id,
                  nom: nomClient(d.clients) ?? '—',
                  droite: STATUTS_SAV_LABELS[d.statut] ?? d.statut,
                  classe: d.statut !== 'en_attente' ? 'text-alerte font-medium' : 'text-texte-doux',
                }))}
                onVoirTout={() => allerASection('sav')}
              />
              <CarteResume
                titre="Devis sans réponse"
                compte={bilan.devisSansReponse.length}
                urgent={bilan.devisSansReponse.length > 0}
                vide="Aucun devis oublié."
                items={bilan.devisSansReponse.slice(0, 2).map((d) => ({
                  id: d.id,
                  nom: nomClient(d.clients) ?? '—',
                  droite: `${joursDevisSansReponse(d)} j`,
                  classe: 'text-alerte font-medium',
                }))}
                onVoirTout={() => allerASection('devis')}
              />
            </div>

            {pastilles.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto mt-6 pb-1">
                {pastilles.map((p) => (
                  <button
                    key={p.cle}
                    onClick={() => allerASection(p.cle)}
                    className={`flex-shrink-0 h-9 px-3 rounded-full text-xs font-medium shadow-sm flex items-center gap-1.5 ${
                      p.urgent ? 'bg-alerte/10 text-alerte' : 'bg-carte text-texte-doux'
                    }`}
                  >
                    {p.titre}
                    <span className={p.urgent ? 'text-alerte/70' : 'text-texte-faible'}>{p.compte}</span>
                  </button>
                ))}
              </div>
            )}

            <Section
              sectionRef={(el) => (sectionRefs.current.sav = el)}
              titre="SAV ouverts"
              compte={bilan.savOuverts.length}
              urgent={bilan.savOuverts.some((d) => d.statut !== 'en_attente')}
              vide="Aucun SAV en cours."
              ouverte={!!sectionsOuvertes.sav}
              onToggle={() => toggleSection('sav')}
            >
              {bilan.savOuverts.map((d) => (
                <Ligne
                  key={d.id}
                  dossier={d}
                  onOuvrir={onOpenDossier}
                  droite={STATUTS_SAV_LABELS[d.statut] ?? d.statut}
                  alerte={d.statut !== 'en_attente'}
                  sousTitre={
                    d.statut === 'en_attente'
                      ? `En attente${d.bloque_par ? ` — ${d.bloque_par}` : ' — motif à préciser'}`
                      : null
                  }
                />
              ))}
            </Section>

            <Section
              sectionRef={(el) => (sectionRefs.current.devis = el)}
              titre="Devis sans réponse"
              compte={bilan.devisSansReponse.length}
              urgent
              vide="Aucun devis oublié."
              ouverte={!!sectionsOuvertes.devis}
              onToggle={() => toggleSection('devis')}
            >
              {bilan.devisSansReponse.map((d) => (
                <Ligne
                  key={d.id}
                  dossier={d}
                  onOuvrir={onOpenDossier}
                  droite={`${joursDevisSansReponse(d)} j`}
                  alerte
                />
              ))}
            </Section>

            <Section
              sectionRef={(el) => (sectionRefs.current.rappeler = el)}
              titre="À rappeler"
              compte={bilan.aRappeler.length}
              urgent
              vide="Aucun rappel en retard. "
              ouverte={!!sectionsOuvertes.rappeler}
              onToggle={() => toggleSection('rappeler')}
            >
              {bilan.aRappeler.map((d) => (
                <Ligne
                  key={d.id}
                  dossier={d}
                  onOuvrir={onOpenDossier}
                  droite={etatRappel(d.rappel_date, d.rappel_heure)?.texte}
                  droiteClasse={etatRappel(d.rappel_date, d.rappel_heure)?.classe}
                  ligneSecondaire={d.rappel_note}
                  alerte
                  onFait={rappelFait}
                />
              ))}
            </Section>

            <Section
              sectionRef={(el) => (sectionRefs.current.avenir = el)}
              titre="Rappels à venir"
              compte={bilan.aVenir.length}
              vide="Rien de programmé."
              ouverte={!!sectionsOuvertes.avenir}
              onToggle={() => toggleSection('avenir')}
            >
              {bilan.aVenir.map((d) => (
                <Ligne
                  key={d.id}
                  dossier={d}
                  onOuvrir={onOpenDossier}
                  droite={etatRappel(d.rappel_date, d.rappel_heure)?.texte}
                  droiteClasse={etatRappel(d.rappel_date, d.rappel_heure)?.classe}
                  ligneSecondaire={d.rappel_note}
                  onFait={rappelFait}
                />
              ))}
            </Section>

            <Section
              sectionRef={(el) => (sectionRefs.current.plans = el)}
              titre="Plans à produire"
              compte={bilan.plansAProduire.length}
              vide="Aucun plan en attente."
              ouverte={!!sectionsOuvertes.plans}
              onToggle={() => toggleSection('plans')}
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
              sectionRef={(el) => (sectionRefs.current.reglements = el)}
              titre="Règlements de plans à encaisser"
              compte={bilan.reglements.length}
              urgent={bilan.reglements.some((d) => d.statut === 'reglement_demande')}
              vide="Aucun plan en attente de règlement."
              ouverte={!!sectionsOuvertes.reglements}
              onToggle={() => toggleSection('reglements')}
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

            {couvertureFaible && (
              <section className="mt-6">
                <div className="bg-alerte/10 border border-alerte/30 rounded-xl px-4 py-3">
                  <p className="text-sm text-texte">
                    {bilan.signesSansMontant > 0
                      ? `${bilan.signesSansMontant} dossier${bilan.signesSansMontant > 1 ? 's' : ''} sur ${bilan.nbSignes} déjà signé${bilan.nbSignes > 1 ? 's' : ''} n'${bilan.signesSansMontant > 1 ? 'ont' : 'a'} pas de montant : ${bilan.signesSansMontant > 1 ? 'ils manquent' : 'il manque'} à l'objectif sans se voir.`
                      : `Seuls ${bilan.chiffres} dossiers sur ${bilan.totalActifs} portent un montant estimé.`}
                  </p>
                  <p className="text-xs text-texte-doux mt-1">
                    Tant que les autres ne sont pas chiffrés, la jauge dit moins que la réalité.
                  </p>
                </div>
              </section>
            )}

            <Section
              sectionRef={(el) => (sectionRefs.current.chiffrer = el)}
              titre="À chiffrer"
              compte={bilan.sansMontant.length}
              vide="Tous les dossiers actifs sont chiffrés."
              ouverte={!!sectionsOuvertes.chiffrer}
              onToggle={() => toggleSection('chiffrer')}
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
      {boîtePrompt}
    </div>
  )
}
