import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import { supabase } from '../lib/supabaseClient'
import { lireAvecCache } from '../lib/cacheLecture'
import { mettreEnFile } from '../lib/fileAttente'
import { etatRappel, assurerRappelDeRelance } from '../lib/rappel'
import { nomClient } from '../lib/client'
import EtatErreur from '../components/EtatErreur'
import {
  ETAPES_PROJET,
  STATUTS_SAV,
  STATUTS_PLAN,
  PLAN_STATUT_LABELS,
  COMMERCIAUX_LABELS,
  PLAN_SANS_COMMERCIAL,
  joursDevisSansReponse,
  styleDossier,
} from '../constants/dossiers'

function Card({ dossier, onOpen, onMove, isDragging, dansColonneActive }) {
  // Un plan encore dû sur son propre projet est emprunté au kanban Projet
  // pour se voir aussi dans Plan (sans dossier Plan séparé) : son statut
  // appartient au vocabulaire Projet, pas Plan — le glisser-déposer et le
  // bouton « Déplacer » n'ont donc pas de sens ici, seule l'ouverture reste.
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: dossier.id,
    disabled: dossier.emprunte,
  })
  // Un plan partagé avec un autre commercial se distingue au premier coup
  // d'œil — même violet que son badge dans la fiche — pour ne pas le
  // confondre avec un plan facturé normalement ou fait pour soi.
  const partage = dossier.type === 'plan' && dossier.remuneration_type === 'partage'
  const s = partage ? styleDossier(dossier) : null
  const style = {
    ...(transform ? { transform: `translate(${transform.x}px,${transform.y}px)`, zIndex: 50 } : {}),
    // Poids et couleur en style inline plutôt qu'en classe Tailwind : la
    // classe `border` (4 côtés) et une classe `border-l-[3px]` ciblent la
    // même propriété CSS avec la même spécificité, l'ordre de génération de
    // Tailwind n'étant pas garanti entre les deux.
    ...(partage ? { borderLeftColor: s.bordure, borderLeftWidth: 3 } : {}),
  }
  const client = dossier.clients

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(dossier)}
      // La colonne où on se trouve en faisant défiler le kanban ressort : ses
      // fiches restent nettes, celles des colonnes voisines à peine visibles
      // s'effacent — sans ça, impossible de dire d'un coup d'œil dans quelle
      // étape on est vraiment quand deux colonnes se partagent l'écran.
      // touch-none (touch-action: none) est indispensable ici, pas cosmétique :
      // sans lui, PointerSensor n'a aucun moyen d'empêcher Safari iOS de
      // traiter le geste comme un défilement de colonne — les deux anciens
      // sélecteurs CSS censés le poser ([data-dnd-kit-draggable], .draggable)
      // ne correspondaient à rien dans le DOM réel, retirés d'index.css.
      className={`bg-carte rounded-carte border select-none touch-none cursor-pointer transition-all p-2.5 ${
        isDragging
          ? 'border-accent shadow-drag scale-105 rotate-1 opacity-95'
          : dansColonneActive
            ? 'border-accent/50 shadow-sm ring-1 ring-accent/30'
            : 'border-bordure shadow-sm opacity-40'
      }`}
    >
      <p className="text-[13px] font-bold text-texte leading-tight mb-0.5">
        {nomClient(client) ?? '—'}
      </p>
      {dossier.titre && <p className="text-[11px] text-texte-doux mb-1 truncate">{dossier.titre}</p>}
      {dossier.montant_estime != null && (
        <p className="text-[11px] text-texte-doux">
          Estimé : <span className="font-semibold text-texte">{dossier.montant_estime} €</span>
        </p>
      )}
      {(() => {
        const r = etatRappel(dossier.rappel_date, dossier.rappel_heure)
        if (!r) return null
        return (
          <div className="mt-1">
            <p className={`text-[10px] ${r.classe}`}>⏰ {r.texte}</p>
            {/* Le compte à rebours seul ne dit pas de quoi il s'agit : sans
                l'objet, un rappel en retard oblige à ouvrir la fiche pour
                se souvenir de ce qu'il fallait faire. */}
            {dossier.rappel_note && (
              <p className="text-[10px] text-texte-doux truncate">{dossier.rappel_note}</p>
            )}
          </div>
        )
      })()}
      {/* Un plan encore dû se voit sans ouvrir le dossier : c'est du travail
          technique à produire, pas un simple attribut. */}
      {dossier.plan_statut && dossier.plan_statut !== 'fait' && (
        <p className="text-[10px] text-accent mt-1">
          📐 Plan {PLAN_STATUT_LABELS[dossier.plan_statut]?.toLowerCase()}
        </p>
      )}
      {/* Un devis resté sans réponse au-delà du seuil n'est plus une affaire
          en cours : il faut décider quoi en faire (relancer, perdu, refaire
          un devis), pas le laisser occuper la colonne indéfiniment. */}
      {joursDevisSansReponse(dossier) != null && (
        <p className="text-[10px] font-semibold text-alerte mt-1">
          ⚠ Sans réponse depuis {joursDevisSansReponse(dossier)} j
        </p>
      )}
      {/* Un SAV « en attente » sans le motif force à ouvrir la fiche pour
          savoir quoi relancer — même logique que dans le brief du soir. */}
      {dossier.type === 'sav' && dossier.statut === 'en_attente' && (
        <p className="text-[10px] text-texte-doux mt-1 truncate">
          ⏳ En attente{dossier.bloque_par ? ` — ${dossier.bloque_par}` : ' — motif à préciser'}
        </p>
      )}
      {/* Pour qui est ce plan se voit sans ouvrir la fiche : Bruce trie ses
          plans en premier lieu par commercial destinataire, pas par étape. */}
      {dossier.type === 'plan' && dossier.commercial && (
        <p
          className={`text-[10px] font-semibold mt-1 truncate ${partage ? '' : 'text-texte-doux'}`}
          style={partage ? { color: s.texte } : undefined}
        >
          👤 {COMMERCIAUX_LABELS[dossier.commercial] ?? dossier.commercial}
        </p>
      )}
      {PLAN_SANS_COMMERCIAL(dossier) && (
        <p className="text-[10px] font-semibold text-alerte mt-1">👤 Commercial ?</p>
      )}
      {/* Emprunté au Projet : jamais facturé, pas de commercial à préciser —
          la fiche le rappelle pour ne pas le confondre avec un vrai dossier Plan. */}
      {dossier.emprunte && (
        <p className="text-[10px] font-semibold text-texte-doux mt-1">👤 Vous — non facturé</p>
      )}
      {/* Le glisser-déposer ne peut pas franchir 14 colonnes sur un écran de
          téléphone : ce bouton ouvre la liste des étapes. */}
      {onMove && !dossier.emprunte && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onMove(dossier)
          }}
          className="mt-2 pt-2 border-t border-separateur w-full text-right text-[11px] text-accent"
        >
          Déplacer →
        </button>
      )}
    </div>
  )
}

function Column({ etape, dossiers, colRef, onOpen, onMove, dropId, actif, onSelect }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? etape[0] })
  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        if (colRef) colRef(el)
      }}
      className="flex-shrink-0 w-48 flex flex-col"
    >
      {/* Toucher l'en-tête choisit la colonne directement : attendre que le
          défilement la détecte tout seul est trop lent au doigt, surtout
          quand deux colonnes se partagent l'écran à peu près à égalité. */}
      <button
        type="button"
        onClick={() => onSelect?.(etape[0])}
        className="flex items-center justify-between px-1 pb-2 w-full text-left"
      >
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${actif ? 'text-accent' : 'text-texte-doux'}`}
        >
          {etape[1]}
        </span>
        {dossiers.length > 0 && (
          <span className="text-xs text-texte-doux bg-carte-douce px-1.5 py-0.5 rounded-full">{dossiers.length}</span>
        )}
      </button>
      <div
        className="flex flex-col gap-2 min-h-16 rounded-imbrique transition-colors p-1"
        style={{ background: isOver ? 'rgb(var(--accent) / 0.15)' : 'transparent' }}
      >
        {dossiers.map((d) => (
          <Card key={d.id} dossier={d} onOpen={onOpen} onMove={onMove} dansColonneActive={actif} />
        ))}
      </div>
    </div>
  )
}

// Mémorise la vue et la colonne actives d'une visite à l'autre : App.jsx ne
// garde qu'un seul écran monté à la fois, donc Pipeline est démonté puis
// remonté à neuf à chaque aller-retour vers une fiche — sans cette mémoire,
// son propre useState repartait de zéro et l'effet de montage désignait
// toujours la première colonne, quelle que soit celle quittée. Variables de
// module plutôt que remontées dans App.jsx : aucun des sites qui lisent ou
// écrivent vue/etapeVue plus bas dans ce fichier n'a besoin de changer.
let vueMemorisee = 'projet'
let etapeVueMemorisee = null

// Fenêtre pendant laquelle un déplacement par glisser-déposer reste
// annulable avant que l'écriture réelle ne parte (voir armerDeplacement).
const DUREE_ANNULATION_MS = 5000

export default function Pipeline({ onBack, onOpenDossier, onCreate }) {
  const [dossiers, setDossiers] = useState([])
  // Les deux pipelines n'ont ni le même vocabulaire d'étapes ni le même
  // volume : les montrer bout à bout obligeait à faire défiler loin pour
  // atteindre le SAV. Un seul kanban à l'écran à la fois, choisi ici.
  const [vue, setVue] = useState(() => vueMemorisee)
  const [activeDrag, setActiveDrag] = useState(null)
  const [aDeplacer, setADeplacer] = useState(null)
  // Un glisser-déposer touché par erreur (pouce qui frôle une carte en
  // faisant défiler ou en naviguant) ne doit jamais écrire en base sans
  // qu'on ait eu l'occasion de s'en rendre compte — contrairement au bouton
  // « Déplacer », qui exige déjà deux appuis délibérés et reste instantané.
  // La carte bouge tout de suite à l'écran, mais l'écriture réelle attend
  // DUREE_ANNULATION_MS derrière un bandeau « Annuler ».
  const [deplacementEnAttente, setDeplacementEnAttente] = useState(null)
  const enAttenteRef = useRef(null)
  const minuteurConfirmation = useRef(null)
  const colRefs = useRef({})
  // Treize étapes peuplées font sept écrans de balayage sur un iPhone. Les
  // étapes vides s'effacent, et la barre ci-dessous permet d'atteindre
  // n'importe laquelle d'un geste au lieu de les traverser toutes.
  const [montrerVides, setMontrerVides] = useState(false)
  // Un dossier perdu mérite d'être relu de temps en temps, pas de tenir une
  // colonne dans le champ de vision tous les jours.
  const [montrerPerdus, setMontrerPerdus] = useState(false)
  // Même logique pour les dossiers soldés : une fois terminés, ils sortent
  // du champ de vision quotidien sans quitter le tableau.
  const [montrerTermines, setMontrerTermines] = useState(false)

  // Étape actuellement à gauche de l'écran. Suivre le défilement plutôt que le
  // dernier appui : sans ça, un balayage à la main laisserait la barre
  // désigner une étape qu'on a quittée.
  const [etapeVue, setEtapeVue] = useState(() => etapeVueMemorisee)
  const zoneRef = useRef(null)
  const pillRefs = useRef({})

  // force ignore la comparaison avec l'étape courante : après un changement
  // de kanban, « en_cours » (SAV et Plan partagent cette clé) resterait sinon
  // désignée par erreur comme l'étape active de l'un parce qu'elle l'était
  // déjà pour l'autre, sans qu'aucun scroll ne vienne corriger l'erreur.
  // Le clic sur une pastille fixe etapeVue explicitement, puis lance un
  // défilement animé vers la colonne visée. Le détecteur ci-dessous
  // continue d'écouter les évènements de scroll pendant cette animation —
  // et sur un grand écran où tout tient déjà à l'écran (rien à faire
  // défiler), ou pendant les à-coups intermédiaires de l'animation, il
  // pouvait désigner une tout autre colonne que celle demandée, écrasant
  // le choix explicite. On l'ignore le temps que ça se stabilise.
  const ignorerDefilement = useRef(false)
  const minuteurDefilement = useRef(null)
  const nettoyageEcouteursDefilement = useRef(null)
  // Vrai jusqu'au premier passage de l'effet de montage ci-dessous : sert à
  // ne restaurer la colonne mémorisée qu'une fois par montage, pas à chaque
  // changement de kanban en cours de session (où repartir sur la première
  // colonne reste le bon comportement).
  const auMontage = useRef(true)

  const suivreDefilement = useCallback((force = false) => {
    const zone = zoneRef.current
    if (!zone) return
    const bord = zone.getBoundingClientRect().left
    let proche = null
    let ecart = Infinity
    for (const [cle, el] of Object.entries(colRefs.current)) {
      if (!el?.isConnected) continue
      const d = Math.abs(el.getBoundingClientRect().left - bord)
      if (d < ecart) { ecart = d; proche = cle }
    }
    if (proche && (force || proche !== etapeVue)) {
      setEtapeVue(proche)
      pillRefs.current[proche]?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
    }
  }, [etapeVue])

  // Un délai fixe ne peut pas garantir qu'il couvre toute la durée réelle
  // d'un scrollIntoView({behavior:'smooth'}) — un trajet plus long (ex.
  // Prospect -> Devis à faire) prend plus de temps qu'un trajet court, et un
  // délai calibré sur le court laisse échapper un événement de scroll en
  // pleine animation, qui écrase alors la sélection avant qu'elle ne soit
  // stabilisée. scrollend (natif, supporté sur Safari récent) dit avec
  // certitude quand le défilement s'est vraiment arrêté ; un filet de
  // secours par inactivité (se réarme à chaque scroll) couvre les
  // navigateurs qui ne le supportent pas encore, sans deviner de durée.
  const allerA = useCallback((cle) => {
    ignorerDefilement.current = true
    if (minuteurDefilement.current) clearTimeout(minuteurDefilement.current)
    nettoyageEcouteursDefilement.current?.()

    const zone = zoneRef.current
    const reprogrammerSecours = () => {
      if (minuteurDefilement.current) clearTimeout(minuteurDefilement.current)
      minuteurDefilement.current = setTimeout(finir, 150)
    }
    const finir = () => {
      ignorerDefilement.current = false
      minuteurDefilement.current = null
      zone?.removeEventListener('scrollend', finir)
      zone?.removeEventListener('scroll', reprogrammerSecours)
      nettoyageEcouteursDefilement.current = null
    }
    nettoyageEcouteursDefilement.current = finir

    zone?.addEventListener('scrollend', finir, { once: true })
    zone?.addEventListener('scroll', reprogrammerSecours, { passive: true })
    reprogrammerSecours()

    colRefs.current[cle]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'start',
      block: 'nearest',
    })
  }, [])

  useEffect(() => {
    return () => nettoyageEcouteursDefilement.current?.()
  }, [])

  // Aucune étape n'est marquée tant qu'on n'a pas défilé, ni juste après un
  // changement de kanban : on désigne donc la première dès que les colonnes
  // du kanban choisi sont posées — sauf au tout premier montage, où une
  // colonne mémorisée d'une visite précédente (voir vueMemorisee ci-dessus)
  // prime sur ce comportement par défaut.
  // suivreDefilement volontairement absente des dépendances : elle change
  // d'identité à chaque etapeVue (via useCallback), l'ajouter ici referait
  // tourner cet effet à chaque clic sur une pastille et écraserait la
  // sélection explicite avant la fin du défilement — seuls un changement de
  // kanban ou l'arrivée des dossiers doivent redéclencher le recalage
  // automatique.
  useEffect(() => {
    if (!dossiers.length) return
    if (auMontage.current) {
      auMontage.current = false
      if (etapeVue) {
        allerA(etapeVue)
        return
      }
    }
    suivreDefilement(true)
  }, [dossiers.length, vue])

  // Garde la mémoire à jour à chaque changement, qu'il vienne d'un clic, du
  // défilement ou de la restauration ci-dessus — pour que le prochain
  // montage reparte du dernier état vu, pas seulement du tout premier.
  useEffect(() => {
    vueMemorisee = vue
  }, [vue])
  useEffect(() => {
    etapeVueMemorisee = etapeVue
  }, [etapeVue])

  // Choisir une colonne au toucher, sans attendre que le défilement la
  // détecte : la mise en évidence doit réagir tout de suite, le recentrage
  // suit ensuite.
  const selectionnerEtape = useCallback((cle) => {
    setEtapeVue(cle)
    allerA(cle)
  }, [allerA])

  const changerEtape = useCallback(async (dossier, etape) => {
    setADeplacer(null)
    if (dossier.statut === etape) return
    setDossiers((current) => current.map((d) => (d.id === dossier.id ? { ...d, statut: etape } : d)))
    const { error } = await supabase.from('dossiers').update({ statut: etape }).eq('id', dossier.id)
    if (error) {
      mettreEnFile({ type: 'etape', dossierId: dossier.id, statut: etape })
      return
    }
    await assurerRappelDeRelance(dossier.id, etape)
  }, [])

  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState(null)
  const [tentative, setTentative] = useState(0)
  const [pipelineDepuisCache, setPipelineDepuisCache] = useState(false)

  useEffect(() => {
    let active = true
    setChargement(true)
    setErreur(null)

    lireAvecCache('pipeline-dossiers', () =>
      supabase
        .from('dossiers')
        .select('*, clients(id, prenom_praticien, nom_praticien, nom_cabinet, ville)')
        .in('type', ['projet', 'sav', 'plan'])
        .order('created_at', { ascending: false })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data ?? []
        })
    )
      .then(({ valeur, depuisCache }) => {
        if (!active) return
        setDossiers(valeur)
        setPipelineDepuisCache(depuisCache)
        setChargement(false)
      })
      .catch(() => {
        if (active) {
          // Sans ça, un chargement raté affichait un pipeline à zéro dossier
          // partout — indiscernable d'un vrai pipeline vide.
          setErreur('Impossible de charger le pipeline.')
          setChargement(false)
        }
      })

    const channel = supabase
      .channel('pipeline-dossiers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dossiers' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setDossiers((current) => current.filter((d) => d.id !== payload.old.id))
            return
          }
          if (!['projet', 'sav', 'plan'].includes(payload.new?.type)) return
          setDossiers((current) => {
            const exists = current.some((d) => d.id === payload.new.id)
            if (exists) {
              return current.map((d) => (d.id === payload.new.id ? { ...d, ...payload.new } : d))
            }
            return [{ ...payload.new, clients: null }, ...current]
          })
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [tentative])

  // Refait à chaque changement de `dossiers` seulement — sans ça, ce triple
  // regroupement (parcourt tous les dossiers, en pousse certains dans deux
  // colonnes à la fois pour les plans empruntés) tournait à chaque rendu, y
  // compris ceux déclenchés par un simple survol ou bascule d'affichage sans
  // rapport avec la liste elle-même.
  const { byEtape, bySavEtape, byPlanEtape } = useMemo(() => {
    const byEtape = {}
    ETAPES_PROJET.forEach(([id]) => {
      byEtape[id] = []
    })
    const bySavEtape = {}
    STATUTS_SAV.forEach(([id]) => {
      bySavEtape[id] = []
    })
    const byPlanEtape = {}
    STATUTS_PLAN.forEach(([id]) => {
      byPlanEtape[id] = []
    })
    // Un statut sans colonne correspondante (valeur par défaut de la base,
    // import futur, étape retirée du code) atterrit dans « À classer » plutôt
    // que de disparaître du tableau sans un mot. SAV et Plan ont chacun leur
    // propre vocabulaire de statuts : « À classer » n'existe pas pour eux, un
    // dossier au statut inconnu rejoint donc la première colonne de son propre
    // type plutôt que d'être perdu silencieusement.
    dossiers.forEach((d) => {
      if (d.type === 'sav') {
        const colonne = bySavEtape[d.statut] ? d.statut : STATUTS_SAV[0][0]
        bySavEtape[colonne].push(d)
      } else if (d.type === 'plan') {
        const colonne = byPlanEtape[d.statut] ? d.statut : STATUTS_PLAN[0][0]
        byPlanEtape[colonne].push(d)
      } else {
        const colonne = byEtape[d.statut] ? d.statut : 'a_classer'
        byEtape[colonne].push(d)
        // Un plan encore dû ou en cours sur sa propre vente doit se voir dans
        // Plan aussi, sans qu'un dossier Plan séparé n'existe : Bruce veut tout
        // son travail de plan au même endroit, facturé ou non. Une fois « fait »
        // il n'y a plus rien à suivre côté Plan (pas de facturation à solder).
        if (d.plan_statut === 'a_faire' || d.plan_statut === 'en_cours') {
          const colPlan = d.plan_statut === 'a_faire' ? 'a_planifier' : 'en_cours'
          byPlanEtape[colPlan].push({ ...d, emprunte: true })
        }
      }
    })
    return { byEtape, bySavEtape, byPlanEtape }
  }, [dossiers])

  // Compteurs des 3 onglets de kanban — mêmes formules que l'ancien menu
  // déroulant, juste extraites pour ne plus tripler les .filter() à chaque
  // rendu. Recalculés dès que `dossiers` change (temps réel, comme le reste
  // de l'écran, déjà abonné aux mises à jour Supabase).
  //
  // Statuts terminaux exclus des 3 : un SAV Clos, un projet Terminé/Perdu ou
  // un plan Soldé n'a plus rien d'actif à suivre — les compter grossirait le
  // chiffre de l'onglet sans rien dire de ce qui reste à traiter aujourd'hui.
  // Ces dossiers restent entièrement consultables (fiche client, colonnes
  // dédiées du kanban) : seul le compteur d'onglet change, rien n'est masqué
  // ni supprimé.
  const compteurs = useMemo(() => ({
    projet: dossiers.filter((d) => d.type === 'projet' && d.statut !== 'termine' && d.statut !== 'perdu').length,
    sav: dossiers.filter((d) => d.type === 'sav' && d.statut !== 'clos').length,
    plan: dossiers.filter(
      (d) =>
        (d.type === 'plan' && d.statut !== 'solde') ||
        (d.type === 'projet' && ['a_faire', 'en_cours'].includes(d.plan_statut))
    ).length,
  }), [dossiers])

  // Une étape vide reste affichée si elle est la destination d'un glissé en
  // cours : la faire disparaître sous le doigt rendrait le dépôt impossible.
  const etapesVisibles = useMemo(
    () =>
      ETAPES_PROJET.filter(([cle]) => {
        if (cle === 'perdu') return montrerPerdus || activeDrag
        if (cle === 'termine') return montrerTermines || activeDrag
        return montrerVides || byEtape[cle].length > 0 || activeDrag
      }),
    [byEtape, montrerPerdus, montrerTermines, montrerVides, activeDrag]
  )
  const nbVides = useMemo(
    () =>
      ETAPES_PROJET.filter(([c]) => c !== 'perdu' && c !== 'termine' && byEtape[c].length === 0).length,
    [byEtape]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const handleDragStart = useCallback(({ active }) => {
    setActiveDrag(dossiers.find((d) => d.id === active.id) || null)
  }, [dossiers])

  const libelleEtape = useCallback((type, statut) => {
    const liste = type === 'sav' ? STATUTS_SAV : type === 'plan' ? STATUTS_PLAN : ETAPES_PROJET
    return liste.find(([valeur]) => valeur === statut)?.[1] ?? statut
  }, [])

  // Écriture réelle, différée derrière la fenêtre d'annulation — même
  // logique de repli hors-ligne que changerEtape : une panne réseau à ce
  // moment-là met l'action en file plutôt que de la perdre silencieusement.
  const executerDeplacement = useCallback(async (dossierId, statut) => {
    const { error } = await supabase.from('dossiers').update({ statut }).eq('id', dossierId)
    if (error) {
      mettreEnFile({ type: 'etape', dossierId, statut })
      return
    }
    await assurerRappelDeRelance(dossierId, statut)
  }, [])

  const confirmerDeplacement = useCallback(() => {
    const attente = enAttenteRef.current
    enAttenteRef.current = null
    minuteurConfirmation.current = null
    setDeplacementEnAttente(null)
    if (attente) executerDeplacement(attente.dossierId, attente.statutCible)
  }, [executerDeplacement])

  const annulerDeplacement = useCallback(() => {
    const attente = enAttenteRef.current
    if (minuteurConfirmation.current) {
      clearTimeout(minuteurConfirmation.current)
      minuteurConfirmation.current = null
    }
    enAttenteRef.current = null
    setDeplacementEnAttente(null)
    if (attente) {
      setDossiers((current) =>
        current.map((x) => (x.id === attente.dossierId ? { ...x, statut: attente.statutOrigine } : x))
      )
    }
  }, [])

  // Arme la fenêtre d'annulation pour ce dossier. Un second glissement du
  // même dossier pendant la fenêtre remplace la demande précédente plutôt
  // que de s'empiler — et s'il revient à son statut de départ (bougé deux
  // fois, revenu à la case initiale), on annule purement et simplement :
  // aucune requête réseau n'est jamais envoyée.
  const armerDeplacement = useCallback((dossier, statutCible) => {
    if (minuteurConfirmation.current) clearTimeout(minuteurConfirmation.current)

    const enChaine = enAttenteRef.current?.dossierId === dossier.id
    const statutOrigine = enChaine ? enAttenteRef.current.statutOrigine : dossier.statut

    if (statutCible === statutOrigine) {
      enAttenteRef.current = null
      minuteurConfirmation.current = null
      setDeplacementEnAttente(null)
      setDossiers((current) => current.map((x) => (x.id === dossier.id ? { ...x, statut: statutOrigine } : x)))
      return
    }

    const attente = {
      dossierId: dossier.id,
      statutOrigine,
      statutCible,
      libelle: libelleEtape(dossier.type, statutCible),
    }
    enAttenteRef.current = attente
    setDeplacementEnAttente(attente)
    minuteurConfirmation.current = setTimeout(confirmerDeplacement, DUREE_ANNULATION_MS)
  }, [libelleEtape, confirmerDeplacement])

  // Quitter l'écran pendant la fenêtre d'annulation confirme le déplacement
  // au lieu de le perdre : Pipeline est démonté à chaque navigation vers une
  // fiche (voir vueMemorisee plus haut), un minuteur en attente n'aurait
  // sinon jamais l'occasion de se déclencher.
  useEffect(() => {
    return () => {
      if (minuteurConfirmation.current) {
        clearTimeout(minuteurConfirmation.current)
        const attente = enAttenteRef.current
        if (attente) executerDeplacement(attente.dossierId, attente.statutCible)
      }
    }
  }, [executerDeplacement])

  const handleDragEnd = useCallback(async ({ active, over }) => {
    setActiveDrag(null)
    if (!over) return
    const d = dossiers.find((x) => x.id === active.id)
    if (!d) return
    const overId = String(over.id)
    // Les colonnes SAV et Plan portent un id préfixé (« sav: », « plan: » —
    // voir dropId plus bas) : chaque type a son propre vocabulaire de
    // statuts, un dossier ne peut être déposé que sur une colonne de son
    // propre type. Sans cette garde, un dossier lâché près d'une colonne
    // d'un autre type écrirait un statut du mauvais vocabulaire.
    const prefixe = ['sav', 'plan'].find((p) => overId.startsWith(`${p}:`))
    if ((prefixe ?? 'projet') !== d.type) return
    const statut = prefixe ? overId.slice(prefixe.length + 1) : overId
    if (d.statut === statut) return
    setDossiers((current) => current.map((x) => (x.id === d.id ? { ...x, statut } : x)))
    armerDeplacement(d, statut)
  }, [dossiers, armerDeplacement])

  return (
    <div className="flex flex-col h-screen bg-fond">
      {/* overflow-x-hidden ici seulement, pas sur le conteneur racine : les
          colonnes du kanban plus bas défilent horizontalement à dessein,
          seul le header (qui ne doit jamais déborder) a besoin du filet. */}
      <header className="px-4 pt-6 pb-4 flex items-center gap-2 flex-shrink-0 overflow-x-hidden">
        <button onClick={onBack} className="text-accent text-sm font-semibold h-11 -ml-2 pl-2 pr-1 flex items-center">
          ← Clients
        </button>
        {/* Pas de titre « Pipeline » séparé : les 3 onglets juste à côté
            (Projet/Plan/SAV) disent déjà où on est — sur iPhone (375px), le
            titre en plus des onglets et du bouton « + » ne tenait pas sans
            déborder (vérifié : "SAV" coupé, body.scrollWidth > viewport). */}
        <div className="flex items-center gap-1">
          {[
            ['projet', 'Projet'],
            ['plan', 'Plan'],
            ['sav', 'SAV'],
          ].map(([cle, libelle]) => (
            <button
              key={cle}
              onClick={() => setVue(cle)}
              aria-label={`Kanban ${libelle}`}
              className={`flex-shrink-0 h-9 px-2 rounded-full text-xs font-semibold flex items-center gap-1 transition-colors ${
                vue === cle ? 'bg-accent text-white' : 'bg-carte text-texte-doux border border-bordure'
              }`}
            >
              {libelle}
              <span className={vue === cle ? 'text-white/70' : 'text-texte-doux'}>{compteurs[cle]}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {onCreate && (
          <button
            onClick={onCreate}
            aria-label="Nouveau client"
            className="w-11 h-11 flex-shrink-0 rounded-full bg-accent text-white text-xl leading-none flex items-center justify-center shadow"
          >
            +
          </button>
        )}
      </header>

      {chargement && <p className="text-texte-doux text-sm px-4">Chargement…</p>}

      {!chargement && !erreur && pipelineDepuisCache && (
        <p className="text-xs text-alerte px-4 mb-2">
          ⚠ Version hors ligne — peut ne pas refléter les derniers changements
        </p>
      )}

      {!chargement && erreur && (
        <EtatErreur message={erreur} onReessayer={() => setTentative((t) => t + 1)} />
      )}

      {!chargement && !erreur && (
        <>
      {vue === 'projet' && (
      <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto flex-shrink-0">
        {ETAPES_PROJET.filter(
          ([cle]) => cle !== 'perdu' && cle !== 'termine' && byEtape[cle].length > 0
        ).map(([cle, libelle]) => (
          <button
            key={cle}
            ref={(el) => { pillRefs.current[cle] = el }}
            onClick={() => selectionnerEtape(cle)}
            className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-colors ${
              etapeVue === cle ? 'bg-accent text-white' : 'bg-carte text-texte-doux'
            }`}
          >
            {libelle}
            <span className={etapeVue === cle ? 'text-white/70' : 'text-texte-doux'}>
              {byEtape[cle].length}
            </span>
          </button>
        ))}
        {byEtape.termine.length > 0 && (
          <button
            ref={(el) => { pillRefs.current.termine = el }}
            // Toujours révéler puis y aller — jamais un bascule. Un appui
            // sur cette pastille doit se comporter exactement comme sur
            // n'importe quelle autre : y aller, point. En toggle, un second
            // appui (colonne déjà révélée depuis plus tôt dans la session)
            // la masquait sans naviguer nulle part, et le réarrangement des
            // colonnes qui en résultait laissait le repère de défilement
            // sur une tout autre étape — l'appui semblait mener au hasard.
            onClick={() => {
              setMontrerTermines(true)
              setTimeout(() => selectionnerEtape('termine'), 100)
            }}
            className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-semibold shadow-sm flex items-center gap-1.5 ${
              etapeVue === 'termine' ? 'bg-accent text-white' : 'bg-carte text-texte-doux'
            }`}
          >
            Terminés
            <span className={etapeVue === 'termine' ? 'text-white/70' : 'text-texte-doux'}>
              {byEtape.termine.length}
            </span>
          </button>
        )}
        {byEtape.perdu.length > 0 && (
          <button
            ref={(el) => { pillRefs.current.perdu = el }}
            onClick={() => {
              setMontrerPerdus(true)
              setTimeout(() => selectionnerEtape('perdu'), 100)
            }}
            className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-semibold shadow-sm flex items-center gap-1.5 ${
              etapeVue === 'perdu' ? 'bg-accent text-white' : 'bg-carte text-texte-doux'
            }`}
          >
            Perdus
            <span className={etapeVue === 'perdu' ? 'text-white/70' : 'text-texte-doux'}>
              {byEtape.perdu.length}
            </span>
          </button>
        )}
        {nbVides > 0 && (
          <button
            onClick={() => setMontrerVides((v) => !v)}
            className="flex-shrink-0 h-11 px-3 rounded-full bg-carte text-accent text-xs font-semibold shadow-sm flex items-center"
          >
            {montrerVides ? 'Masquer les vides' : `+ ${nbVides} vide${nbVides > 1 ? 's' : ''}`}
          </button>
        )}
      </div>
      )}

      {/* SAV et Plan restent peu volumineux : toutes leurs étapes tiennent
          dans la barre, pas besoin des « vides »/« perdus » du Projet. */}
      {vue === 'sav' && (
        <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto flex-shrink-0">
          {STATUTS_SAV.map(([cle, libelle]) => (
            <button
              key={cle}
              ref={(el) => { pillRefs.current[cle] = el }}
              onClick={() => selectionnerEtape(cle)}
              className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-colors ${
                etapeVue === cle ? 'bg-accent text-white' : 'bg-carte text-texte-doux'
              }`}
            >
              {libelle}
              <span className={etapeVue === cle ? 'text-white/70' : 'text-texte-doux'}>
                {bySavEtape[cle].length}
              </span>
            </button>
          ))}
        </div>
      )}

      {vue === 'plan' && (
        <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto flex-shrink-0">
          {STATUTS_PLAN.map(([cle, libelle]) => (
            <button
              key={cle}
              ref={(el) => { pillRefs.current[cle] = el }}
              onClick={() => selectionnerEtape(cle)}
              className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-colors ${
                etapeVue === cle ? 'bg-accent text-white' : 'bg-carte text-texte-doux'
              }`}
            >
              {libelle}
              <span className={etapeVue === cle ? 'text-white/70' : 'text-texte-doux'}>
                {byPlanEtape[cle].length}
              </span>
            </button>
          ))}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div
          ref={zoneRef}
          onScroll={() => {
            if (!ignorerDefilement.current) suivreDefilement()
          }}
          className="flex gap-3 px-4 pb-4 overflow-x-auto flex-1 items-start"
        >
          {vue === 'projet' &&
            etapesVisibles.map((etape) => (
              <Column
                key={etape[0]}
                etape={etape}
                dossiers={byEtape[etape[0]] || []}
                colRef={(el) => {
                  colRefs.current[etape[0]] = el
                }}
                onOpen={onOpenDossier}
                onMove={setADeplacer}
                actif={!etapeVue || etape[0] === etapeVue}
                onSelect={selectionnerEtape}
              />
            ))}

          {vue === 'sav' &&
            STATUTS_SAV.map((etape) => (
              <Column
                key={`sav:${etape[0]}`}
                etape={etape}
                dossiers={bySavEtape[etape[0]] || []}
                colRef={(el) => {
                  colRefs.current[etape[0]] = el
                }}
                onOpen={onOpenDossier}
                onMove={setADeplacer}
                dropId={`sav:${etape[0]}`}
                actif={!etapeVue || etape[0] === etapeVue}
                onSelect={selectionnerEtape}
              />
            ))}

          {vue === 'plan' &&
            STATUTS_PLAN.map((etape) => (
              <Column
                key={`plan:${etape[0]}`}
                etape={etape}
                dossiers={byPlanEtape[etape[0]] || []}
                colRef={(el) => {
                  colRefs.current[etape[0]] = el
                }}
                onOpen={onOpenDossier}
                onMove={setADeplacer}
                dropId={`plan:${etape[0]}`}
                actif={!etapeVue || etape[0] === etapeVue}
                onSelect={selectionnerEtape}
              />
            ))}

          {/* Sans cette marge, une colonne proche de la fin (Terminé, Perdu)
              ne peut pas être alignée sur le bord gauche — il n'y a plus
              rien après elle à faire défiler pour l'y amener. Le
              défilement s'arrêtait alors quelques colonnes trop tôt, et le
              repère « colonne la plus proche du bord » désignait à tort
              une voisine plutôt que celle vraiment demandée. */}
          <div className="flex-shrink-0" style={{ width: '100vw' }} aria-hidden="true" />
        </div>
        <DragOverlay>{activeDrag && <Card dossier={activeDrag} onOpen={() => {}} isDragging />}</DragOverlay>
      </DndContext>
        </>
      )}

      {aDeplacer && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end"
          onClick={() => setADeplacer(null)}
        >
          <div
            className="bg-carte w-full rounded-t-carte p-4 max-h-[75vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-bold text-texte">
              {aDeplacer.clients ? (nomClient(aDeplacer.clients) ?? aDeplacer.titre) : aDeplacer.titre}
            </p>
            <p className="text-xs text-texte-doux mb-4">Choisir la nouvelle étape</p>

            <div className="flex flex-col gap-2">
              {/* Le menu « Déplacer » doit proposer le vocabulaire du bon
                  type : un dossier SAV n'a pas d'étape « Devis envoyé », et
                  un Projet n'a pas de statut « Clos » ou « Soldé ». */}
              {(aDeplacer.type === 'sav'
                ? STATUTS_SAV
                : aDeplacer.type === 'plan'
                  ? STATUTS_PLAN
                  : ETAPES_PROJET
              ).map(([valeur, libelle]) => {
                const courante = valeur === aDeplacer.statut
                return (
                  <button
                    key={valeur}
                    onClick={() => changerEtape(aDeplacer, valeur)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-imbrique border text-left text-sm ${
                      courante
                        ? 'border-accent bg-accent/15 text-accent font-semibold'
                        : 'border-bordure text-texte-doux'
                    }`}
                  >
                    {libelle}
                    {courante && <span className="ml-auto text-xs">✓ actuelle</span>}
                  </button>
                )
              })}
            </div>

            <button
              onClick={() => setADeplacer(null)}
              className="w-full mt-3 py-3 rounded-imbrique bg-carte-douce text-texte-doux text-sm font-semibold"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {deplacementEnAttente && (
        <div className="fixed bottom-4 left-4 right-4 z-40 bg-carte border border-accent rounded-carte shadow-drag px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-texte">
            Déplacé vers <span className="font-bold">{deplacementEnAttente.libelle}</span>
          </p>
          <button onClick={annulerDeplacement} className="text-accent text-sm font-bold flex-shrink-0">
            Annuler
          </button>
        </div>
      )}
    </div>
  )
}
