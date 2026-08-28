import React, { useEffect, useRef, useState } from 'react'
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
import { etatRappel, assurerRappelDeRelance } from '../lib/rappel'
import { nomClient } from '../lib/client'
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
      className={`bg-carte rounded-xl border select-none cursor-pointer transition-all p-2.5 ${
        isDragging
          ? 'shadow-xl rotate-1 opacity-90'
          : dansColonneActive
            ? 'border-accent/50 shadow-sm ring-1 ring-accent/30'
            : 'border-bordure shadow-sm opacity-40'
      }`}
    >
      <p className="text-[13px] font-medium text-texte leading-tight mb-0.5">
        {nomClient(client) ?? '—'}
      </p>
      {dossier.titre && <p className="text-[11px] text-texte-faible mb-1 truncate">{dossier.titre}</p>}
      {dossier.montant_estime != null && (
        <p className="text-[11px] text-texte-doux">
          Estimé : <span className="font-medium text-texte">{dossier.montant_estime} €</span>
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
        <p className="text-[10px] font-medium text-alerte mt-1">
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
          className={`text-[10px] font-medium mt-1 truncate ${partage ? '' : 'text-texte-doux'}`}
          style={partage ? { color: s.texte } : undefined}
        >
          👤 {COMMERCIAUX_LABELS[dossier.commercial] ?? dossier.commercial}
        </p>
      )}
      {PLAN_SANS_COMMERCIAL(dossier) && (
        <p className="text-[10px] font-medium text-alerte mt-1">👤 Commercial ?</p>
      )}
      {/* Emprunté au Projet : jamais facturé, pas de commercial à préciser —
          la fiche le rappelle pour ne pas le confondre avec un vrai dossier Plan. */}
      {dossier.emprunte && (
        <p className="text-[10px] font-medium text-texte-doux mt-1">👤 Vous — non facturé</p>
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
          className={`text-xs font-medium uppercase tracking-wider ${actif ? 'text-accent' : 'text-texte-doux'}`}
        >
          {etape[1]}
        </span>
        {dossiers.length > 0 && (
          <span className="text-xs text-texte-faible bg-carte-douce px-1.5 py-0.5 rounded-full">{dossiers.length}</span>
        )}
      </button>
      <div
        className="flex flex-col gap-2 min-h-16 rounded-xl transition-colors p-1"
        style={{ background: isOver ? 'rgb(var(--accent) / 0.15)' : 'transparent' }}
      >
        {dossiers.map((d) => (
          <Card key={d.id} dossier={d} onOpen={onOpen} onMove={onMove} dansColonneActive={actif} />
        ))}
      </div>
    </div>
  )
}

export default function Pipeline({ onBack, onOpenDossier, onCreate }) {
  const [dossiers, setDossiers] = useState([])
  // Les deux pipelines n'ont ni le même vocabulaire d'étapes ni le même
  // volume : les montrer bout à bout obligeait à faire défiler loin pour
  // atteindre le SAV. Un seul kanban à l'écran à la fois, choisi ici.
  const [vue, setVue] = useState('projet')
  const [activeDrag, setActiveDrag] = useState(null)
  const [aDeplacer, setADeplacer] = useState(null)
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
  const [etapeVue, setEtapeVue] = useState(null)
  const zoneRef = useRef(null)
  const pillRefs = useRef({})

  // force ignore la comparaison avec l'étape courante : après un changement
  // de kanban, « en_cours » (SAV et Plan partagent cette clé) resterait sinon
  // désignée par erreur comme l'étape active de l'un parce qu'elle l'était
  // déjà pour l'autre, sans qu'aucun scroll ne vienne corriger l'erreur.
  const suivreDefilement = (force = false) => {
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
  }

  // Aucune étape n'est marquée tant qu'on n'a pas défilé, ni juste après un
  // changement de kanban : on désigne donc la première dès que les colonnes
  // du kanban choisi sont posées.
  useEffect(() => {
    if (dossiers.length) suivreDefilement(true)
  }, [dossiers.length, vue])

  const allerA = (cle) => {
    colRefs.current[cle]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'start',
      block: 'nearest',
    })
  }

  // Choisir une colonne au toucher, sans attendre que le défilement la
  // détecte : la mise en évidence doit réagir tout de suite, le recentrage
  // suit ensuite.
  const selectionnerEtape = (cle) => {
    setEtapeVue(cle)
    allerA(cle)
  }

  const changerEtape = async (dossier, etape) => {
    setADeplacer(null)
    if (dossier.statut === etape) return
    setDossiers((current) => current.map((d) => (d.id === dossier.id ? { ...d, statut: etape } : d)))
    await supabase.from('dossiers').update({ statut: etape }).eq('id', dossier.id)
    await assurerRappelDeRelance(dossier.id, etape)
  }

  useEffect(() => {
    let active = true

    supabase
      .from('dossiers')
      .select('*, clients(id, prenom_praticien, nom_praticien, nom_cabinet, ville)')
      .in('type', ['projet', 'sav', 'plan'])
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (active) setDossiers(data ?? [])
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
  }, [])

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

  // Une étape vide reste affichée si elle est la destination d'un glissé en
  // cours : la faire disparaître sous le doigt rendrait le dépôt impossible.
  const etapesVisibles = ETAPES_PROJET.filter(([cle]) => {
    if (cle === 'perdu') return montrerPerdus || activeDrag
    if (cle === 'termine') return montrerTermines || activeDrag
    return montrerVides || byEtape[cle].length > 0 || activeDrag
  })
  const nbVides = ETAPES_PROJET.filter(
    ([c]) => c !== 'perdu' && c !== 'termine' && byEtape[c].length === 0
  ).length

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const handleDragStart = ({ active }) => {
    setActiveDrag(dossiers.find((d) => d.id === active.id) || null)
  }

  const handleDragEnd = async ({ active, over }) => {
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
    await supabase.from('dossiers').update({ statut }).eq('id', d.id)
    await assurerRappelDeRelance(d.id, statut)
  }

  return (
    <div className="flex flex-col h-screen bg-fond">
      <header className="px-4 pt-6 pb-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="text-accent text-sm font-medium h-11 -ml-2 pl-2 pr-1 flex items-center">
          ← Clients
        </button>
        <h1 className="text-lg font-semibold text-texte">Pipeline</h1>
        <select
          value={vue}
          onChange={(e) => setVue(e.target.value)}
          aria-label="Choisir le kanban"
          className="bg-carte text-texte-doux text-sm font-medium rounded-full h-9 pl-3 pr-2 outline-none border border-bordure"
        >
          <option value="projet">Projet · {dossiers.filter((d) => d.type === 'projet').length}</option>
          <option value="sav">SAV · {dossiers.filter((d) => d.type === 'sav').length}</option>
          <option value="plan">
            Plan ·{' '}
            {dossiers.filter(
              (d) => d.type === 'plan' || (d.type === 'projet' && ['a_faire', 'en_cours'].includes(d.plan_statut))
            ).length}
          </option>
        </select>
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

      {vue === 'projet' && (
      <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto flex-shrink-0">
        {ETAPES_PROJET.filter(
          ([cle]) => cle !== 'perdu' && cle !== 'termine' && byEtape[cle].length > 0
        ).map(([cle, libelle]) => (
          <button
            key={cle}
            ref={(el) => { pillRefs.current[cle] = el }}
            onClick={() => selectionnerEtape(cle)}
            className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-medium shadow-sm flex items-center gap-1.5 transition-colors ${
              etapeVue === cle ? 'bg-accent text-white' : 'bg-carte text-texte-doux'
            }`}
          >
            {libelle}
            <span className={etapeVue === cle ? 'text-white/70' : 'text-texte-faible'}>
              {byEtape[cle].length}
            </span>
          </button>
        ))}
        {byEtape.termine.length > 0 && (
          <button
            onClick={() => {
              setMontrerTermines((v) => !v)
              if (!montrerTermines) setTimeout(() => selectionnerEtape('termine'), 100)
            }}
            className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-medium shadow-sm flex items-center gap-1.5 ${
              montrerTermines ? 'bg-accent text-white' : 'bg-carte text-texte-faible'
            }`}
          >
            Terminés
            <span className={montrerTermines ? 'text-white/70' : 'text-texte-fantome'}>
              {byEtape.termine.length}
            </span>
          </button>
        )}
        {byEtape.perdu.length > 0 && (
          <button
            onClick={() => {
              setMontrerPerdus((v) => !v)
              if (!montrerPerdus) setTimeout(() => selectionnerEtape('perdu'), 100)
            }}
            className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-medium shadow-sm flex items-center gap-1.5 ${
              montrerPerdus ? 'bg-accent text-white' : 'bg-carte text-texte-faible'
            }`}
          >
            Perdus
            <span className={montrerPerdus ? 'text-white/70' : 'text-texte-fantome'}>
              {byEtape.perdu.length}
            </span>
          </button>
        )}
        {nbVides > 0 && (
          <button
            onClick={() => setMontrerVides((v) => !v)}
            className="flex-shrink-0 h-11 px-3 rounded-full bg-carte text-accent text-xs font-medium shadow-sm flex items-center"
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
              className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-medium shadow-sm flex items-center gap-1.5 transition-colors ${
                etapeVue === cle ? 'bg-accent text-white' : 'bg-carte text-texte-doux'
              }`}
            >
              {libelle}
              <span className={etapeVue === cle ? 'text-white/70' : 'text-texte-faible'}>
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
              className={`flex-shrink-0 h-11 px-3 rounded-full text-xs font-medium shadow-sm flex items-center gap-1.5 transition-colors ${
                etapeVue === cle ? 'bg-accent text-white' : 'bg-carte text-texte-doux'
              }`}
            >
              {libelle}
              <span className={etapeVue === cle ? 'text-white/70' : 'text-texte-faible'}>
                {byPlanEtape[cle].length}
              </span>
            </button>
          ))}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div
          ref={zoneRef}
          onScroll={() => suivreDefilement()}
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
        </div>
        <DragOverlay>{activeDrag && <Card dossier={activeDrag} onOpen={() => {}} isDragging />}</DragOverlay>
      </DndContext>

      {aDeplacer && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end"
          onClick={() => setADeplacer(null)}
        >
          <div
            className="bg-carte w-full rounded-t-2xl p-4 max-h-[75vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-texte">
              {aDeplacer.clients ? (nomClient(aDeplacer.clients) ?? aDeplacer.titre) : aDeplacer.titre}
            </p>
            <p className="text-xs text-texte-faible mb-4">Choisir la nouvelle étape</p>

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
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-sm ${
                      courante
                        ? 'border-accent bg-accent/15 text-accent font-medium'
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
              className="w-full mt-3 py-3 rounded-xl bg-carte-douce text-texte-doux text-sm font-medium"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
