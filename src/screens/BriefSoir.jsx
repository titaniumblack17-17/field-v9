import React, { useEffect, useMemo, useRef, useState } from 'react'
import usePrompt from '../hooks/usePrompt'
import { supabase } from '../lib/supabaseClient'
import { lireAvecCache } from '../lib/cacheLecture'
import { mettreEnFile } from '../lib/fileAttente'
import EtatErreur from '../components/EtatErreur'
import JaugeObjectif from '../components/JaugeObjectif'
import { synchroniserTache, reconcilierTaches } from '../lib/todoistTaches'
import {
  etatRappel,
  etatEcheanceTache,
  cloreProchainRappel,
  reconcilierRappels,
  aujourdhui as calculerAujourdhui,
} from '../lib/rappel'
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
  SEUIL_DEVIS_SANS_REPONSE_JOURS,
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

// Même normalisation que ClientList.jsx/ChoixClient.jsx : insensible aux
// accents et à la casse, pour que « poirot » retrouve « Poirot ».
const normaliser = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const TAG_LABELS = { rappel: 'Rappel', sav: 'SAV', tache: 'Tâche', devis: 'Devis' }

// Au-delà de ce nombre, « Aussi à traiter » se replie derrière un lien
// « Voir les N autres » — un board qui force un défilement marathon avant
// d'atteindre les 7 sections détaillées en dessous rate son objectif
// (constaté en vidéo réelle sur iPhone, 25 éléments affichés à plat).
const LIMITE_AUSSI_A_TRAITER = 6

function Ligne({ dossier, onOuvrir, droite, droiteClasse, alerte, onFait, sousTitre, ligneSecondaire, tag }) {
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
          <p className="font-medium text-texte truncate">
            {/* Tag de type (Rappel/SAV/Tâche/Devis) : seulement dans la liste
                fusionnée « Aussi à traiter », où plusieurs familles se
                mélangent — inutile dans les 7 sections détaillées plus bas,
                déjà homogènes chacune sur son propre type. */}
            {tag && (
              <span className="inline-block align-middle text-[10px] font-semibold uppercase tracking-wide text-texte-faible bg-carte-douce rounded px-1.5 py-0.5 mr-1.5">
                {tag}
              </span>
            )}
            {nomClient(dossier.clients) ?? '—'}
          </p>
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
          aria-label="Marquer comme traité"
          title="Traité"
          className="w-14 flex-shrink-0 flex items-center justify-center text-texte-fantome text-xl active:text-accent disabled:opacity-40 border-l border-separateur"
        >
          {enCours ? '…' : '✓'}
        </button>
      )}
    </li>
  )
}

// En-tête de Section : chevron ▶ (rotate-90 à l'ouverture), titre, compteur
// coloré à droite — la même carte repliable pour les 7 sections de la page,
// jamais l'une qui détonne visuellement des autres. Toujours affiché, même
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

// Tuile compacte de la grille 2x2 : un chiffre à lire d'un coup d'œil, pas de
// détail — le détail, c'est le board et les 7 sections juste en dessous.
function TuileKPI({ titre, valeur, sousTitre, urgent, onClick }) {
  return (
    <button
      onClick={onClick}
      className="bg-carte rounded-xl shadow-sm px-3 py-3 text-left active:scale-[0.98] transition"
    >
      <p className="text-xs text-texte-doux truncate">{titre}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${urgent ? 'text-alerte' : 'text-texte'}`}>{valeur}</p>
      {sousTitre && <p className="text-xs text-texte-faible mt-0.5 truncate">{sousTitre}</p>}
    </button>
  )
}

// Carte « Priorité du jour » : le seul élément (tous types confondus) au
// retard le plus long. Accent ambre = le token `alerte` existant de l'app
// (déjà l'orange du code couleur des échéances), pas une couleur importée —
// cohérent avec le reste de l'interface plutôt qu'une nouvelle teinte.
function CartePriorite({ item, onOuvrir, onAppeler, onPlusTard }) {
  return (
    <section className="mt-4 bg-alerte/10 border border-alerte/40 rounded-xl px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-alerte mb-2">Priorité du jour</p>
      <button onClick={() => onOuvrir(item.dossier)} className="w-full text-left">
        <p className="font-semibold text-texte truncate">
          <span className="inline-block align-middle text-[10px] font-semibold uppercase tracking-wide text-alerte bg-carte rounded px-1.5 py-0.5 mr-1.5">
            {TAG_LABELS[item.type]}
          </span>
          {nomClient(item.dossier.clients) ?? '—'}
        </p>
        <p className="text-sm text-alerte font-medium mt-1">
          {item.joursRetard > 0
            ? `En retard de ${item.joursRetard} jour${item.joursRetard > 1 ? 's' : ''}`
            : "À traiter aujourd'hui"}
        </p>
        {item.libelle && <p className="text-sm text-texte-doux mt-0.5 truncate">{item.libelle}</p>}
      </button>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onAppeler(item)}
          className="flex-1 h-11 rounded-imbrique bg-accent text-white text-sm font-semibold"
        >
          Appeler
        </button>
        <button
          onClick={() => onPlusTard(item.cle)}
          className="flex-1 h-11 rounded-imbrique bg-carte text-texte-doux text-sm font-semibold"
        >
          Plus tard
        </button>
      </div>
    </section>
  )
}

export default function BriefSoir({ onOpenDossier, onOpenClient, onClients, onPipeline, onCapture }) {
  const [dossiers, setDossiers] = useState([])
  // Sous-tâches de note en retard, tous dossiers confondus : chargées à part
  // de `dossiers` (table séparée), rejointes à leur dossier localement dans
  // `bilan` plutôt que par une jointure SQL — le nom du client et le type
  // sont déjà dans `dossiers`, pas besoin de les redemander.
  const [taches, setTaches] = useState([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState(null)
  const [tentative, setTentative] = useState(0)
  const [demanderTexte, boîtePrompt] = usePrompt()

  // Écran d'entrée de l'app (depuis son passage en écran de démarrage) :
  // même secours hors-ligne que ClientList.jsx avait auparavant — sans lui,
  // une coupure réseau à l'ouverture (cave, ascenseur, parking) affichait
  // directement l'écran d'erreur, la toute première chose vue.
  const [depuisCache, setDepuisCache] = useState(false)

  // Recherche rapide (point 1 du board) : liste légère de clients chargée à
  // part, filtrée en local — même principe que ChoixClient.jsx, pas besoin
  // de temps réel pour un simple raccourci « sauter à une fiche ».
  const [rechercheTexte, setRechercheTexte] = useState('')
  const [clientsRecherche, setClientsRecherche] = useState([])

  // « Plus tard » (bouton de la carte Priorité du jour) : ignore l'élément
  // pour cette session seulement, jamais persisté — remonter l'app (ou
  // simplement revenir sur cet écran) le refait réapparaître naturellement,
  // puisque BriefSoir se démonte à chaque navigation ailleurs.
  const [ignores, setIgnores] = useState(() => new Set())

  // « Aussi à traiter » replié par défaut au-delà de LIMITE_AUSSI_A_TRAITER
  // (voir son commentaire) — une fois déplié via le lien ou la tuile KPI
  // « À traiter », reste déplié pour le reste de la session.
  const [aussiATraiterDeplie, setAussiATraiterDeplie] = useState(false)
  const aussiATraiterRef = useRef(null)
  const objectifRef = useRef(null)

  // Jauge Objectif puis pastilles de navigation tout en haut ; les pastilles
  // sautent directement à la section concernée plus bas via ces mêmes refs.
  const sectionRefs = useRef({})

  // Garde-fou anti-doublon pour la synchro Todoist des tâches en retard : le
  // job planifié (pg_cron) est le mécanisme fiable, ceci n'est qu'un aller
  // plus rapide quand Bruce a déjà le Brief ouvert. Sans cette Set, un
  // recalcul de `bilan` avant que la réponse serveur ne soit revenue (et
  // n'ait posé todoist_task_id) redéclencherait le même appel en double.
  const syncTacheEnCours = useRef(new Set())

  // SAV/Devis/À rappeler ouvertes par défaut : ce sont les décisions les
  // plus urgentes du soir, elles doivent se voir sans taper. Rappels à
  // venir/Plans/Règlements/À chiffrer repliées par défaut (clé absente) —
  // moins prioritaires par nature, pas besoin de défiler leur détail pour
  // voir juste le compteur. État levé ici plutôt que local à chaque
  // section, pour qu'une pastille puisse forcer l'ouverture de sa cible
  // avant d'y sauter.
  const [sectionsOuvertes, setSectionsOuvertes] = useState({ sav: true, devis: true, rappeler: true, taches: true })
  const toggleSection = (cle) => setSectionsOuvertes((s) => ({ ...s, [cle]: !s[cle] }))
  const allerASection = (cle) => {
    // Le haut de la section ne bouge pas quand son contenu se déplie en
    // dessous : pas besoin d'attendre le re-rendu avant de lancer le scroll.
    setSectionsOuvertes((s) => (s[cle] ? s : { ...s, [cle]: true }))
    sectionRefs.current[cle]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Tuile KPI « À traiter » : contourne le lien « Voir les N autres » — un
  // tap sur le chiffre doit montrer tout ce qu'il représente sans étape
  // intermédiaire, même mécanisme scrollIntoView que les pastilles.
  const allerAAussiATraiter = () => {
    setAussiATraiterDeplie(true)
    aussiATraiterRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Tuile KPI « Objectif » : défile jusqu'à la jauge détaillée plus bas.
  const allerAObjectif = () => {
    objectifRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  // Coche d'une sous-tâche de note directement depuis « Aussi à traiter » —
  // même logique que `basculerTache` dans DossierDetail.jsx (écriture
  // optimiste avec repli sur la file d'attente, synchro Todoist en tâche de
  // fond si la tâche avait été escaladée).
  const tacheFaite = async (tache) => {
    setTaches((cur) => cur.filter((t) => t.id !== tache.id))
    const { error } = await supabase.from('dossier_note_taches').update({ fait: true }).eq('id', tache.id)
    if (error) {
      mettreEnFile({ type: 'update', table: 'dossier_note_taches', rowId: tache.id, champs: { fait: true } })
    } else if (tache.todoist_task_id) {
      synchroniserTache(tache.id)
    }
  }

  // Clôture rapide d'un SAV depuis « Aussi à traiter » — même geste que
  // cocher un rappel ou une tâche, réversible depuis la fiche si besoin
  // (pas de confirmation : ce n'est pas une suppression, juste un statut).
  const savCloture = async (dossier) => {
    setDossiers((cur) => cur.map((d) => (d.id === dossier.id ? { ...d, statut: 'clos' } : d)))
    const { error } = await supabase.from('dossiers').update({ statut: 'clos' }).eq('id', dossier.id)
    if (error) {
      mettreEnFile({ type: 'update', table: 'dossiers', rowId: dossier.id, champs: { statut: 'clos' } })
    }
  }

  // Aiguille vers le bon traitement selon le type de l'élément fusionné. Le
  // devis n'a pas de bouton ✓ (voir `aussiATraiter` plus bas) : rien
  // n'équivaut à « clore un devis » en un geste, ça se décide en fiche.
  const traiterElement = (item) => {
    if (item.type === 'rappel') return rappelFait(item.dossier)
    if (item.type === 'tache') return tacheFaite(item.tache)
    if (item.type === 'sav') return savCloture(item.dossier)
  }

  const appeler = (item) => {
    const tel = item.dossier.clients?.telephone_portable || item.dossier.clients?.telephone_cabinet
    if (tel) {
      window.location.href = `tel:${tel}`
    } else {
      onOpenDossier(item.dossier)
    }
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
        lireAvecCache('brief-dossiers', () =>
          supabase
            .from('dossiers')
            .select(
              '*, clients(id, prenom_praticien, nom_praticien, nom_cabinet, ville, telephone_portable, telephone_cabinet)'
            )
            .then(({ data, error }) => {
              if (error) throw new Error(error.message)
              return data ?? []
            })
        )
      )
      .then(({ valeur, depuisCache }) => {
        if (!actif) return
        setDossiers(valeur)
        setDepuisCache(depuisCache)
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

  useEffect(() => {
    let actif = true

    // Réconcilier avant de lire, même principe que pour les rappels
    // juste au-dessus : une tâche cochée sur la montre ne doit pas continuer
    // à s'afficher « en retard » dans le Brief qu'on est en train de lire.
    //
    // « En retard » se dérive du jour qui passe, pas d'un filtre côté
    // requête (même logique que rappel_date pour `dossiers` juste au-dessus) :
    // on charge toute tâche non faite avec une échéance, et `bilan` isole
    // celles qui sont dépassées.
    reconcilierTaches()
      .then(() =>
        lireAvecCache('brief-taches', () =>
          supabase
            .from('dossier_note_taches')
            .select('*')
            .eq('fait', false)
            .not('echeance', 'is', null)
            .then(({ data, error }) => {
              if (error) throw new Error(error.message)
              return data ?? []
            })
        )
      )
      .then(({ valeur }) => {
        if (actif) setTaches(valeur)
      })
      .catch(() => {})

    const canal = supabase
      .channel('brief-taches')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dossier_note_taches' },
        (payload) => {
          setTaches((cur) => {
            if (payload.eventType === 'INSERT') {
              if (!payload.new.echeance || payload.new.fait) return cur
              return cur.some((t) => t.id === payload.new.id) ? cur : [...cur, payload.new]
            }
            if (payload.eventType === 'UPDATE') {
              // Cochée ou vidée de son échéance : elle sort de la liste,
              // comme un rappel clos disparaît de « À rappeler ».
              if (!payload.new.echeance || payload.new.fait) {
                return cur.filter((t) => t.id !== payload.new.id)
              }
              return cur.some((t) => t.id === payload.new.id)
                ? cur.map((t) => (t.id === payload.new.id ? payload.new : t))
                : [...cur, payload.new]
            }
            if (payload.eventType === 'DELETE') {
              return cur.filter((t) => t.id !== payload.old.id)
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

  // Recherche rapide : liste complète des clients, chargée une fois avec le
  // même secours hors-ligne que le reste de l'écran d'accueil. Pas de canal
  // temps réel : un résultat vieux de quelques minutes est sans conséquence
  // pour un simple raccourci de navigation.
  useEffect(() => {
    let actif = true
    lireAvecCache('brief-clients-recherche', () =>
      supabase
        .from('clients')
        .select('id, prenom_praticien, nom_praticien, nom_cabinet, ville')
        .order('nom_praticien', { ascending: true })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data ?? []
        })
    )
      .then(({ valeur }) => {
        if (actif) setClientsRecherche(valeur)
      })
      .catch(() => {})
    return () => {
      actif = false
    }
  }, [])

  const resultatsRecherche = useMemo(() => {
    const q = normaliser(rechercheTexte).trim()
    if (!q) return []
    return clientsRecherche
      .filter((c) =>
        normaliser(
          [c.prenom_praticien, c.nom_praticien, c.nom_cabinet, c.ville].filter(Boolean).join(' ')
        ).includes(q)
      )
      .slice(0, 8)
  }, [clientsRecherche, rechercheTexte])

  const bilan = useMemo(() => {
    // Date locale (versISO via rappel.js), pas toISOString() : sinon un
    // rappel du jour classé « à venir » au lieu d'« à rappeler » entre
    // minuit et 1h-2h du matin heure de Paris — décalage UTC déjà corrigé
    // dans rappel.js, redéfini ici par erreur, désormais réutilisé.
    const aujourdhui = calculerAujourdhui()
    const annee = new Date().getFullYear()
    const projets = dossiers.filter((d) => d.type === 'projet')

    // Les affaires réglées lors d'un exercice passé sont soldées : elles ne
    // pèsent plus sur l'objectif de cette année.
    const actifs = projets.filter(
      (d) => d.statut !== 'perdu' && exerciceDe(d, annee) === annee
    )

    // Un plan livré ou en cours de règlement n'a plus de travail dû : seul
    // « soldé » ferme réellement le dossier — sert au KPI « Dossiers actifs »
    // (Projet + Plan + SAV), pas au détail « Plans à produire » plus bas.
    const plansActifs = dossiers.filter((d) => d.type === 'plan' && d.statut !== 'solde')

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

    // Une échéance du jour compte comme en retard (echu), même logique que
    // « À rappeler aujourd'hui » ci-dessus : ça se décide ce soir, pas demain.
    // Le dossier peut manquer (pas encore chargé, ou supprimé entre-temps) —
    // sans lui, rien à afficher pour situer la tâche.
    const tachesEnRetard = taches
      .filter((t) => etatEcheanceTache(t.echeance)?.echu)
      .map((t) => ({ ...t, dossier: dossiers.find((d) => d.id === t.dossier_id) }))
      .filter((t) => t.dossier)
      .sort((a, b) => (a.echeance ?? '').localeCompare(b.echeance ?? ''))

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

    // Score commun « jours de retard équivalent » : chaque famille a sa
    // propre référence de retard (une deadline explicite pour rappel/tâche,
    // le franchissement d'un seuil pour le devis, l'ouverture pour un SAV
    // actionnable), mais le résultat se compare en jours, quel que soit le
    // type — c'est ce qui permet un tri unique « tous types confondus ».
    const joursDepuisJour = (dateISO) =>
      Math.round((new Date(aujourdhui + 'T00:00:00') - new Date(dateISO + 'T00:00:00')) / 86_400_000)
    const joursDepuisHorodatage = (ts) => Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000)

    const elementsUrgents = [
      ...aRappeler.map((d) => ({
        cle: `rappel-${d.id}`,
        type: 'rappel',
        dossier: d,
        joursRetard: joursDepuisJour(d.rappel_date),
        libelle: d.rappel_note || d.titre || TYPE_LABELS[d.type],
        droite: etatRappel(d.rappel_date, d.rappel_heure)?.texte,
      })),
      ...savOuverts
        // Un SAV « en_attente » patiente sur un tiers (pièce, fournisseur) —
        // ce n'est pas un oubli de Bruce, il ne concourt donc pas ici (même
        // logique que `alerte={statut !== 'en_attente'}` dans la section
        // détaillée plus bas).
        .filter((d) => d.statut !== 'en_attente')
        .map((d) => ({
          cle: `sav-${d.id}`,
          type: 'sav',
          dossier: d,
          joursRetard: joursDepuisHorodatage(d.created_at),
          libelle: d.titre || 'SAV',
          droite: STATUTS_SAV_LABELS[d.statut] ?? d.statut,
        })),
      ...tachesEnRetard.map((t) => ({
        cle: `tache-${t.id}`,
        type: 'tache',
        dossier: t.dossier,
        tache: t,
        joursRetard: joursDepuisJour(t.echeance),
        libelle: t.texte,
        droite: etatEcheanceTache(t.echeance)?.texte,
      })),
      ...devisSansReponse.map((d) => ({
        cle: `devis-${d.id}`,
        type: 'devis',
        dossier: d,
        // Jours au-delà du seuil de 30j, pas le total depuis le changement
        // de statut : sinon un devis à J+31 (1 jour de vrai retard) battrait
        // à tort un rappel vieux de 2 jours, alors que les 30 premiers jours
        // sont un délai normal, pas un retard.
        joursRetard: joursDevisSansReponse(d) - SEUIL_DEVIS_SANS_REPONSE_JOURS,
        libelle: d.titre || TYPE_LABELS[d.type],
        droite: `${joursDevisSansReponse(d)} j sans réponse`,
      })),
    ].sort((a, b) => b.joursRetard - a.joursRetard)

    return {
      savOuverts,
      devisSansReponse,
      aRappeler,
      aVenir,
      tachesEnRetard,
      plansAProduire,
      reglements,
      elementsUrgents,
      duParPlans: reglements.length * 500,
      projection: somme(actifs),
      signe: somme(signes),
      facture: somme(factures),
      pourcentageObjectif: Math.round((somme(signes) / OBJECTIF_ANNUEL) * 100),
      totalActifsTousTypes: actifs.length + plansActifs.length + savOuverts.length,
      totalATraiter: aRappeler.length + savOuverts.length + tachesEnRetard.length,
      savEnRetard: savOuverts.filter((d) => d.statut !== 'en_attente').length,
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
  }, [dossiers, taches])

  // Priorité du jour = le premier élément non ignoré (« Plus tard ») du tri
  // unique ; « Aussi à traiter » garde tout le monde, y compris les ignorés
  // — ignorer ne fait que céder la place en haut, pas disparaître de la
  // liste complète.
  const board = useMemo(() => {
    const disponibles = bilan.elementsUrgents.filter((e) => !ignores.has(e.cle))
    const prioriteJour = disponibles[0] ?? null
    const aussiATraiter = bilan.elementsUrgents.filter((e) => e.cle !== prioriteJour?.cle)
    return { prioriteJour, aussiATraiter }
  }, [bilan.elementsUrgents, ignores])

  const plusTard = (cle) => setIgnores((cur) => new Set(cur).add(cle))

  // Aller Todoist immédiat pour les tâches fraîchement en retard, en plus du
  // job planifié (pg_cron, la garantie qui ne dépend pas de l'ouverture de
  // l'app) — même logique de filet que le service worker dans main.jsx
  // (vérification immédiate + repasse périodique indépendante). Ne fait rien
  // pour une tâche déjà liée (todoist_task_id posé) : le serveur est de
  // toute façon idempotent, cette Set n'évite qu'un aller réseau redondant
  // pendant que la réponse précédente n'est pas encore revenue.
  useEffect(() => {
    for (const t of bilan.tachesEnRetard) {
      if (t.todoist_task_id || syncTacheEnCours.current.has(t.id)) continue
      syncTacheEnCours.current.add(t.id)
      synchroniserTache(t.id).finally(() => syncTacheEnCours.current.delete(t.id))
    }
  }, [bilan.tachesEnRetard])

  const couvertureFaible =
    bilan.signesSansMontant > 0 || (bilan.totalActifs > 0 && bilan.chiffres < bilan.totalActifs / 2)

  // Une pastille par section peuplée, colorée quand elle attend une décision
  // ce soir plutôt qu'un simple suivi. L'ordre reprend celui des sections :
  // sauter à une pastille retrouve toujours la même section plus bas.
  const pastilles = [
    { cle: 'sav', titre: 'SAV', compte: bilan.savOuverts.length, urgent: bilan.savOuverts.some((d) => d.statut !== 'en_attente') },
    { cle: 'devis', titre: 'Devis oubliés', compte: bilan.devisSansReponse.length, urgent: bilan.devisSansReponse.length > 0 },
    { cle: 'rappeler', titre: 'À rappeler', compte: bilan.aRappeler.length, urgent: bilan.aRappeler.length > 0 },
    { cle: 'taches', titre: 'Tâches en retard', compte: bilan.tachesEnRetard.length, urgent: bilan.tachesEnRetard.length > 0 },
    { cle: 'avenir', titre: 'À venir', compte: bilan.aVenir.length, urgent: false },
    { cle: 'plans', titre: 'Plans', compte: bilan.plansAProduire.length, urgent: false },
    { cle: 'reglements', titre: 'Règlements', compte: bilan.reglements.length, urgent: bilan.reglements.some((d) => d.statut === 'reglement_demande') },
    { cle: 'chiffrer', titre: 'À chiffrer', compte: bilan.sansMontant.length, urgent: false },
  ].filter((p) => p.compte > 0)

  return (
    <div className="min-h-screen bg-fond">
      <div className="sticky top-0 z-10 bg-fond/90 backdrop-blur">
        <header className="px-4 pt-6 pb-3 overflow-x-hidden">
          <div className="relative">
            {/* Même halo que ClientList.jsx (porté par le div, pas l'input —
                voir son commentaire pour la raison iOS/Safari). */}
            <div className="rounded-carte shadow-halo-recherche focus-within:shadow-halo-recherche-focus transition-shadow duration-200">
              <input
                value={rechercheTexte}
                onChange={(e) => setRechercheTexte(e.target.value)}
                type="search"
                placeholder="Rechercher un praticien, une ville…"
                aria-label="Rechercher un client"
                className="w-full bg-carte rounded-carte pl-5 pr-10 py-4 text-texte outline-none placeholder:text-texte-faible"
              />
            </div>
            {rechercheTexte && (
              <button
                onClick={() => setRechercheTexte('')}
                aria-label="Effacer la recherche"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-texte-fantome text-lg leading-none"
              >
                ×
              </button>
            )}
            {rechercheTexte && (
              <ul className="absolute left-0 right-0 mt-1 bg-carte rounded-xl shadow-lg overflow-hidden z-20 max-h-72 overflow-y-auto">
                {resultatsRecherche.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-texte-faible">Aucun client pour « {rechercheTexte} ».</li>
                ) : (
                  resultatsRecherche.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => {
                          onOpenClient(c)
                          setRechercheTexte('')
                        }}
                        className="w-full text-left px-4 py-3 active:bg-carte-douce"
                      >
                        <p className="text-texte font-medium truncate">{nomClient(c) ?? 'Client'}</p>
                        {(c.nom_cabinet || c.ville) && (
                          <p className="text-xs text-texte-doux truncate">
                            {[c.nom_cabinet, c.ville].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-3">
            <button
              onClick={onClients}
              className="flex-shrink-0 px-3 h-9 rounded-full bg-carte text-accent text-xs font-semibold shadow"
            >
              Clients
            </button>
            <button
              onClick={onPipeline}
              className="flex-shrink-0 px-3 h-9 rounded-full bg-carte text-accent text-xs font-semibold shadow"
            >
              Pipeline
            </button>
            <button
              onClick={onCapture}
              className="flex-shrink-0 px-3 h-9 rounded-full bg-carte text-accent text-xs font-semibold shadow"
            >
              Capture
            </button>
          </div>
        </header>
      </div>

      <main className="px-4 pb-8">
        {chargement && <p className="text-texte-faible text-sm">Point avec Todoist…</p>}

        {!chargement && erreur && (
          <EtatErreur message={erreur} onReessayer={() => setTentative((t) => t + 1)} />
        )}

        {!chargement && !erreur && (
          <>
            {depuisCache && (
              <p className="text-xs text-alerte mb-2 px-1">
                ⚠ Version hors ligne — peut ne pas refléter les derniers changements
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <TuileKPI
                titre="Dossiers actifs"
                valeur={bilan.totalActifsTousTypes}
                onClick={() => onPipeline()}
              />
              <TuileKPI
                titre={`Objectif ${bilan.annee}`}
                valeur={`${bilan.pourcentageObjectif} %`}
                sousTitre={euros(bilan.signe)}
                onClick={allerAObjectif}
              />
              <TuileKPI
                titre="À traiter"
                valeur={bilan.totalATraiter}
                urgent={bilan.totalATraiter > 0}
                onClick={allerAAussiATraiter}
              />
              <TuileKPI
                titre="SAV ouverts"
                valeur={bilan.savOuverts.length}
                sousTitre={bilan.savEnRetard > 0 ? `dont ${bilan.savEnRetard} en retard` : null}
                urgent={bilan.savEnRetard > 0}
                onClick={() => onPipeline('sav')}
              />
            </div>

            {board.prioriteJour && (
              <CartePriorite
                item={board.prioriteJour}
                onOuvrir={onOpenDossier}
                onAppeler={appeler}
                onPlusTard={plusTard}
              />
            )}

            <section ref={aussiATraiterRef} className="mt-6 scroll-mt-32">
              <div className="flex items-center gap-2 px-1 mb-2">
                <h2 className="text-xs text-texte-faible uppercase tracking-wider flex-1">Aussi à traiter</h2>
                <span className={`text-sm font-semibold ${board.aussiATraiter.length > 0 ? 'text-alerte' : 'text-texte-doux'}`}>
                  {board.aussiATraiter.length}
                </span>
              </div>
              {board.aussiATraiter.length === 0 ? (
                <p className="text-texte-faible text-sm px-1">Rien d'autre en attente.</p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {(aussiATraiterDeplie
                      ? board.aussiATraiter
                      : board.aussiATraiter.slice(0, LIMITE_AUSSI_A_TRAITER)
                    ).map((item) => (
                      <Ligne
                        key={item.cle}
                        dossier={item.dossier}
                        onOuvrir={onOpenDossier}
                        tag={TAG_LABELS[item.type]}
                        ligneSecondaire={item.libelle}
                        droite={item.droite}
                        alerte
                        onFait={item.type === 'devis' ? undefined : () => traiterElement(item)}
                      />
                    ))}
                  </ul>
                  {!aussiATraiterDeplie && board.aussiATraiter.length > LIMITE_AUSSI_A_TRAITER && (
                    <button
                      onClick={() => setAussiATraiterDeplie(true)}
                      className="w-full text-center text-sm text-accent font-semibold py-3"
                    >
                      Voir les {board.aussiATraiter.length - LIMITE_AUSSI_A_TRAITER} autres
                    </button>
                  )}
                </>
              )}
            </section>

            <section ref={objectifRef} className="mt-6 scroll-mt-32">
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

            {pastilles.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto mt-4 pb-1">
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
              sectionRef={(el) => (sectionRefs.current.taches = el)}
              titre="Tâches en retard"
              compte={bilan.tachesEnRetard.length}
              urgent
              vide="Aucune tâche en retard."
              ouverte={!!sectionsOuvertes.taches}
              onToggle={() => toggleSection('taches')}
            >
              {bilan.tachesEnRetard.map((t) => (
                <Ligne
                  key={t.id}
                  dossier={t.dossier}
                  onOuvrir={onOpenDossier}
                  ligneSecondaire={t.texte}
                  droite={etatEcheanceTache(t.echeance)?.texte}
                  droiteClasse={etatEcheanceTache(t.echeance)?.classe}
                  alerte
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
