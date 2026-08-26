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
import { etatRappel } from '../lib/rappel'
import { ETAPES_PROJET, STATUTS_SAV, PLAN_STATUT_LABELS } from '../constants/dossiers'

function Card({ dossier, onOpen, onMove, isDragging }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: dossier.id })
  const style = transform ? { transform: `translate(${transform.x}px,${transform.y}px)`, zIndex: 50 } : {}
  const client = dossier.clients

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(dossier)}
      className={`bg-carte rounded-xl border select-none cursor-pointer transition-all p-2.5 ${
        isDragging ? 'shadow-xl rotate-1 opacity-90' : 'border-bordure shadow-sm hover:border-bordure'
      }`}
    >
      <p className="text-[13px] font-medium text-texte leading-tight mb-0.5">
        {client ? [client.prenom_praticien, client.nom_praticien].filter(Boolean).join(' ') : '—'}
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
      {/* Un SAV « en attente » sans le motif force à ouvrir la fiche pour
          savoir quoi relancer — même logique que dans le brief du soir. */}
      {dossier.type === 'sav' && dossier.statut === 'en_attente' && (
        <p className="text-[10px] text-texte-doux mt-1 truncate">
          ⏳ En attente{dossier.bloque_par ? ` — ${dossier.bloque_par}` : ' — motif à préciser'}
        </p>
      )}
      {/* Le glisser-déposer ne peut pas franchir 14 colonnes sur un écran de
          téléphone : ce bouton ouvre la liste des étapes. */}
      {onMove && (
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

function Column({ etape, dossiers, colRef, onOpen, onMove, dropId }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? etape[0] })
  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        if (colRef) colRef(el)
      }}
      className="flex-shrink-0 w-48 flex flex-col"
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-texte-doux">{etape[1]}</span>
        {dossiers.length > 0 && (
          <span className="text-xs text-texte-faible bg-carte-douce px-1.5 py-0.5 rounded-full">{dossiers.length}</span>
        )}
      </div>
      <div
        className="flex flex-col gap-2 min-h-16 rounded-xl transition-colors p-1"
        style={{ background: isOver ? 'rgb(var(--accent) / 0.15)' : 'transparent' }}
      >
        {dossiers.map((d) => (
          <Card key={d.id} dossier={d} onOpen={onOpen} onMove={onMove} />
        ))}
      </div>
    </div>
  )
}

export default function Pipeline({ onBack, onOpenDossier, onCreate }) {
  const [dossiers, setDossiers] = useState([])
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

  // Étape actuellement à gauche de l'écran. Suivre le défilement plutôt que le
  // dernier appui : sans ça, un balayage à la main laisserait la barre
  // désigner une étape qu'on a quittée.
  const [etapeVue, setEtapeVue] = useState(null)
  const zoneRef = useRef(null)
  const pillRefs = useRef({})

  const suivreDefilement = () => {
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
    if (proche && proche !== etapeVue) {
      setEtapeVue(proche)
      pillRefs.current[proche]?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
    }
  }

  // Au premier rendu, aucune étape n'est marquée tant qu'on n'a pas défilé.
  // On désigne donc la première dès que les colonnes sont posées.
  useEffect(() => {
    if (dossiers.length) suivreDefilement()
  }, [dossiers.length])

  const allerA = (cle) => {
    colRefs.current[cle]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'start',
      block: 'nearest',
    })
  }

  const changerEtape = async (dossier, etape) => {
    setADeplacer(null)
    if (dossier.statut === etape) return
    setDossiers((current) => current.map((d) => (d.id === dossier.id ? { ...d, statut: etape } : d)))
    await supabase.from('dossiers').update({ statut: etape }).eq('id', dossier.id)
  }

  useEffect(() => {
    let active = true

    supabase
      .from('dossiers')
      .select('*, clients(id, prenom_praticien, nom_praticien, ville)')
      .in('type', ['projet', 'sav'])
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
          if (!['projet', 'sav'].includes(payload.new?.type)) return
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
  // Un statut sans colonne correspondante (valeur par défaut de la base,
  // import futur, étape retirée du code) atterrit dans « À classer » plutôt
  // que de disparaître du tableau sans un mot. Le SAV a son propre
  // vocabulaire de statuts : « À classer » n'existe pas pour lui, un SAV au
  // statut inconnu rejoint donc la première colonne SAV plutôt que d'être
  // perdu silencieusement.
  dossiers.forEach((d) => {
    if (d.type === 'sav') {
      const colonne = bySavEtape[d.statut] ? d.statut : STATUTS_SAV[0][0]
      bySavEtape[colonne].push(d)
    } else {
      const colonne = byEtape[d.statut] ? d.statut : 'a_classer'
      byEtape[colonne].push(d)
    }
  })

  // Une étape vide reste affichée si elle est la destination d'un glissé en
  // cours : la faire disparaître sous le doigt rendrait le dépôt impossible.
  const etapesVisibles = ETAPES_PROJET.filter(([cle]) => {
    if (cle === 'perdu') return montrerPerdus || activeDrag
    return montrerVides || byEtape[cle].length > 0 || activeDrag
  })
  const nbVides = ETAPES_PROJET.filter(([c]) => c !== 'perdu' && byEtape[c].length === 0).length

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
    // Les colonnes SAV portent un id préfixé « sav: » (voir dropId plus bas) :
    // Projet et SAV n'ont pas le même vocabulaire de statuts, donc un dossier
    // ne peut être déposé que sur une colonne de son propre type. Sans cette
    // garde, un dossier SAV lâché près d'une colonne Projet écrirait un
    // statut du mauvais vocabulaire (ou l'inverse).
    const estColonneSav = overId.startsWith('sav:')
    if (estColonneSav !== (d.type === 'sav')) return
    const statut = estColonneSav ? overId.slice(4) : overId
    if (d.statut === statut) return
    setDossiers((current) => current.map((x) => (x.id === d.id ? { ...x, statut } : x)))
    await supabase.from('dossiers').update({ statut }).eq('id', d.id)
  }

  return (
    <div className="flex flex-col h-screen bg-fond">
      <header className="px-4 pt-6 pb-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="text-accent text-sm font-medium h-11 -ml-2 pl-2 pr-1 flex items-center">
          ← Clients
        </button>
        <h1 className="text-lg font-semibold text-texte flex-1">Pipeline</h1>
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

      <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto flex-shrink-0">
        {ETAPES_PROJET.filter(([cle]) => cle !== 'perdu' && byEtape[cle].length > 0).map(([cle, libelle]) => (
          <button
            key={cle}
            ref={(el) => { pillRefs.current[cle] = el }}
            onClick={() => allerA(cle)}
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
        {byEtape.perdu.length > 0 && (
          <button
            onClick={() => {
              setMontrerPerdus((v) => !v)
              if (!montrerPerdus) setTimeout(() => allerA('perdu'), 100)
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

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div
          ref={zoneRef}
          onScroll={suivreDefilement}
          className="flex gap-3 px-4 pb-4 overflow-x-auto flex-1 items-start"
        >
          {etapesVisibles.map((etape) => (
            <Column
              key={etape[0]}
              etape={etape}
              dossiers={byEtape[etape[0]] || []}
              colRef={(el) => {
                colRefs.current[etape[0]] = el
              }}
              onOpen={onOpenDossier}
              onMove={setADeplacer}
            />
          ))}

          {/* Séparateur visuel entre les colonnes Projet et les colonnes SAV :
              deux pipelines distincts, pas une suite de colonnes du même flux.
              Le SAV reste peu volumineux (une poignée de dossiers) : pas
              besoin de la logique « vides »/« perdus » du Projet, toutes ses
              colonnes restent affichées en permanence. */}
          <div className="flex-shrink-0 self-stretch w-px bg-separateur mx-1" aria-hidden="true" />
          <div className="flex-shrink-0 flex flex-col">
            <div className="px-1 pb-2">
              <span className="text-xs font-medium uppercase tracking-wider text-texte-doux">SAV</span>
            </div>
          </div>
          {STATUTS_SAV.map((etape) => (
            <Column
              key={`sav:${etape[0]}`}
              etape={etape}
              dossiers={bySavEtape[etape[0]] || []}
              onOpen={onOpenDossier}
              onMove={setADeplacer}
              dropId={`sav:${etape[0]}`}
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
              {aDeplacer.clients
                ? [aDeplacer.clients.prenom_praticien, aDeplacer.clients.nom_praticien]
                    .filter(Boolean)
                    .join(' ')
                : aDeplacer.titre}
            </p>
            <p className="text-xs text-texte-faible mb-4">Choisir la nouvelle étape</p>

            <div className="flex flex-col gap-2">
              {/* Le menu « Déplacer » doit proposer le vocabulaire du bon
                  type : un dossier SAV n'a pas d'étape « Devis envoyé », et
                  un Projet n'a pas de statut « Clos ». */}
              {(aDeplacer.type === 'sav' ? STATUTS_SAV : ETAPES_PROJET).map(([valeur, libelle]) => {
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
