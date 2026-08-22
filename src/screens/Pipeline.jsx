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
import { ETAPES_PROJET, PLAN_STATUT_LABELS } from '../constants/dossiers'

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
        return r ? <p className={`text-[10px] mt-1 ${r.classe}`}>⏰ {r.texte}</p> : null
      })()}
      {/* Un plan encore dû se voit sans ouvrir le dossier : c'est du travail
          technique à produire, pas un simple attribut. */}
      {dossier.plan_statut && dossier.plan_statut !== 'fait' && (
        <p className="text-[10px] text-accent mt-1">
          📐 Plan {PLAN_STATUT_LABELS[dossier.plan_statut]?.toLowerCase()}
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

function Column({ etape, dossiers, colRef, onOpen, onMove }) {
  const { setNodeRef, isOver } = useDroppable({ id: etape[0] })
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

export default function Pipeline({ onBack, onOpenDossier }) {
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
      .eq('type', 'projet')
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
          if (payload.new?.type !== 'projet') return
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
  // Un statut sans colonne correspondante (valeur par défaut de la base,
  // import futur, étape retirée du code) atterrit dans « À classer » plutôt
  // que de disparaître du tableau sans un mot.
  dossiers.forEach((d) => {
    const colonne = byEtape[d.statut] ? d.statut : 'a_classer'
    byEtape[colonne].push(d)
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
    if (!d || d.statut === over.id) return
    setDossiers((current) => current.map((x) => (x.id === d.id ? { ...x, statut: over.id } : x)))
    await supabase.from('dossiers').update({ statut: over.id }).eq('id', d.id)
  }

  return (
    <div className="flex flex-col h-screen bg-fond">
      <header className="px-4 pt-6 pb-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="text-accent text-sm font-medium h-11 -ml-2 pl-2 pr-1 flex items-center">
          ← Clients
        </button>
        <h1 className="text-lg font-semibold text-texte">Pipeline</h1>
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
              {ETAPES_PROJET.map(([valeur, libelle]) => {
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
