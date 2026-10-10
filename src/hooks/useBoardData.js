import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePrompt from './usePrompt'
import { supabase } from '../lib/supabaseClient'
import { lireAvecCache } from '../lib/cacheLecture'
import { mettreEnFile } from '../lib/fileAttente'
import { synchroniserTache, reconcilierTaches } from '../lib/todoistTaches'
import { cloreProchainRappel, reconcilierRappels } from '../lib/rappel'
import { calculerBilan, calculerBoard, calculerEnAttente, calculerATrancherPar } from '../lib/bilanBoard'
import { normaliser } from '../components/BoardBlocs'

/**
 * Données, calculs et gestes du Board, en un seul exemplaire : l'ancien accueil
 * et la zone « Aujourd'hui » de l'accueil unique lisent le même résultat, donc
 * le même N partout. Aucune règle n'a changé par rapport à l'ancien BriefSoir.
 */
export default function useBoardData() {
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
  // Feuille du bas ouverte : 'appeler' (À appeler), 'attente' (dossiers en
  // attente d'un tiers) ou 'trancher' (devis à départager), sinon null.
  const [feuille, setFeuille] = useState(null)
  const fermerFeuille = useCallback(() => setFeuille(null), [])
  // Devis sans montant (offres à trancher, HT/TTC douteux) : lignes brutes de
  // `fichiers`, rapprochées de leur dossier plus bas.
  const [devisSansMontant, setDevisSansMontant] = useState([])

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

  // « Aussi à traiter » replie par défaut ce qui dépasse la semaine (voir
  // groupesAussiATraiter) derrière un lien « Voir les N autres » — un board
  // qui force un défilement marathon avant d'atteindre les 7 sections
  // détaillées en dessous rate son objectif (constaté en vidéo réelle sur
  // iPhone, 25 éléments affichés à plat). Une fois déplié via le lien ou la
  // tuile KPI « À traiter », reste déplié pour le reste de la session.
  const [aussiATraiterDeplie, setAussiATraiterDeplie] = useState(false)
  const aussiATraiterRef = useRef(null)
  const objectifRef = useRef(null)

  // Bouton flottant « retour en haut » : apparaît une fois la grille KPI
  // défilée hors champ (repère fiable indépendant de la hauteur des
  // sections au-dessus, qui varie selon ce qu'il y a à traiter ce soir-là).
  const kpiRef = useRef(null)
  const [montrerRetourHaut, setMontrerRetourHaut] = useState(false)
  useEffect(() => {
    const surScroll = () => {
      const rect = kpiRef.current?.getBoundingClientRect()
      setMontrerRetourHaut(!!rect && rect.bottom < 0)
    }
    window.addEventListener('scroll', surScroll, { passive: true })
    return () => window.removeEventListener('scroll', surScroll)
  }, [])
  const retourEnHaut = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  // Rapport hebdo (loupe-rapport-hebdo, table rapport_hebdo) : dernière ligne
  // seulement, pas de temps réel — une synthèse hebdomadaire vieille de
  // quelques minutes n'a aucune conséquence.
  const [rapportHebdo, setRapportHebdo] = useState(null)

  // Anomalies détectées (loupe-audit-integrite) : lignes non résolues de
  // loupe_memoire. RLS n'autorise que la lecture côté client — passer une
  // anomalie à « traité » passe par la fonction Edge loupe-memoire-resoudre
  // (clé service_role), jamais une écriture directe depuis l'app.
  const [anomalies, setAnomalies] = useState([])

  // Garde-fou anti-doublon pour la synchro Todoist des tâches en retard : le
  // job planifié (pg_cron) est le mécanisme fiable, ceci n'est qu'un aller
  // plus rapide quand Bruce a déjà le Brief ouvert. Sans cette Set, un
  // recalcul de `bilan` avant que la réponse serveur ne soit revenue (et
  // n'ait posé todoist_task_id) redéclencherait le même appel en double.
  const syncTacheEnCours = useRef(new Set())

  // Seuls Anomalies détectées et Rapport hebdo restent de vrais accordéons
  // (01/10) — les 8 autres sont devenus des liens de navigation (voir plus
  // bas), qui n'ont plus besoin d'un état ouvert/fermé.
  const [sectionsOuvertes, setSectionsOuvertes] = useState({})
  const toggleSection = (cle) => setSectionsOuvertes((s) => ({ ...s, [cle]: !s[cle] }))

  // Tuile KPI « À traiter » : contourne le lien « Voir les N autres » — un
  // tap sur le chiffre doit montrer tout ce qu'il représente sans étape
  // intermédiaire.
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
    // relance_devis reste un rappel côté base (voir bilan ci-dessus) — même
    // clôture que 'rappel', seul le tag affiché diffère.
    if (item.type === 'rappel' || item.type === 'relance_devis') return rappelFait(item.dossier)
    if (item.type === 'tache') return tacheFaite(item.tache)
    if (item.type === 'sav') return savCloture(item.dossier)
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
    supabase
      .from('fichiers')
      .select('id, dossier_id, type_doc, montant_ttc, variantes, a_trancher_raison, decision')
      .eq('type_doc', 'devis')
      .not('dossier_id', 'is', null)
      .then(({ data, error }) => {
        if (actif && !error) setDevisSansMontant(data ?? [])
      })
      .catch(() => {})

    // INSERT, UPDATE et DELETE : un devis retenu sort de la liste, un devis
    // remis à trancher y revient, un devis supprimé disparaît.
    const canal = supabase
      .channel('brief-fichiers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fichiers' }, (p) => {
        setDevisSansMontant((cur) => {
          if (p.eventType === 'DELETE') return cur.filter((f) => f.id !== p.old.id)
          const f = p.new
          const concerne = f.type_doc === 'devis' && f.dossier_id
          const sans = cur.filter((x) => x.id !== f.id)
          return concerne ? [...sans, f] : sans
        })
      })
      .subscribe()

    return () => {
      actif = false
      supabase.removeChannel(canal)
    }
  }, [])

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

  // Rapport hebdo : dernière ligne écrite par la loupe (pg_cron, lundi matin).
  // Même secours hors-ligne que le reste de l'écran d'accueil.
  useEffect(() => {
    let actif = true
    lireAvecCache('brief-rapport-hebdo', () =>
      supabase
        .from('rapport_hebdo')
        .select('semaine, contenu, cree_le')
        .order('cree_le', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data ?? null
        })
    )
      .then(({ valeur }) => {
        if (actif) setRapportHebdo(valeur)
      })
      .catch(() => {})
    return () => {
      actif = false
    }
  }, [])

  // Anomalies détectées : uniquement celles non résolues.
  useEffect(() => {
    let actif = true
    lireAvecCache('brief-anomalies', () =>
      supabase
        .from('loupe_memoire')
        .select('id, type_erreur, contexte, date')
        .is('correction_appliquee', null)
        .order('date', { ascending: false })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data ?? []
        })
    )
      .then(({ valeur }) => {
        if (actif) setAnomalies(valeur)
      })
      .catch(() => {})
    return () => {
      actif = false
    }
  }, [])

  // Optimiste : l'anomalie disparaît tout de suite de la liste, l'écriture
  // réelle passe par la fonction Edge (RLS ferme l'écriture directe sur
  // loupe_memoire — voir son commentaire plus haut).
  const resoudreAnomalie = async (id) => {
    setAnomalies((cur) => cur.filter((a) => a.id !== id))
    await supabase.functions.invoke('loupe-memoire-resoudre', { body: { id } }).catch(() => {})
  }

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

  const bilan = useMemo(() => calculerBilan(dossiers, taches, devisSansMontant), [dossiers, taches, devisSansMontant])

  const board = useMemo(() => calculerBoard(bilan.elementsUrgents, ignores), [bilan.elementsUrgents, ignores])

  const enAttente = useMemo(() => calculerEnAttente(dossiers), [dossiers])

  const aTrancherPar = useMemo(() => calculerATrancherPar(devisSansMontant, dossiers), [devisSansMontant, dossiers])

  // Retour au tri continu unique (le sous-groupement temporel En retard/
  // Aujourd'hui/Cette semaine a été retiré le 01/10) : `board.aussiATraiter`
  // est déjà trié par ancienneté décroissante (joursRetard, voir bilan
  // ci-dessus), tous types confondus — plus vieux en tête, sans distinction
  // de famille. Repli après les 3 premiers, contre 6 avant : le total est
  // maintenant repris en tête de page (voir la ligne sous les KPI), plus
  // besoin d'en montrer beaucoup ici pour donner une idée du volume.
  const LIMITE_AUSSI_A_TRAITER = 3

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

  return {
    dossiers, chargement, erreur, setTentative, depuisCache,
    bilan, board, enAttente, aTrancherPar, couvertureFaible,
    feuille, setFeuille, fermerFeuille,
    rechercheTexte, setRechercheTexte, resultatsRecherche,
    aussiATraiterDeplie, setAussiATraiterDeplie, aussiATraiterRef, objectifRef, kpiRef,
    allerAAussiATraiter, allerAObjectif,
    montrerRetourHaut, retourEnHaut,
    rapportHebdo, anomalies, resoudreAnomalie,
    sectionsOuvertes, toggleSection,
    traiterElement, plusTard,
    boitePrompt: boîtePrompt,
    LIMITE_AUSSI_A_TRAITER,
  }
}
