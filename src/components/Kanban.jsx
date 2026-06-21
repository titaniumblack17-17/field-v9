import { useState, useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCorners, useDroppable } from '@dnd-kit/core'
import { db, ETAPES, ETAPE_MAP, avancerEtape, seedDemo } from '../data/db'
import { calculerProjectionCA } from '../utils/aiEngine'
import Drawer from './Drawer'
import CardKanban from './CardKanban'
import TopBar from './TopBar'
import BriefPanel from './BriefPanel'

export default function Kanban() {
  const [drawerDossier, setDrawerDossier] = useState(null)
  const [drawerCabinet, setDrawerCabinet] = useState(null)
  const [activeDrag, setActiveDrag] = useState(null)
  const [showBrief, setShowBrief] = useState(false)
  const colRefs = useRef({})
  const dossiers  = useLiveQuery(()=>db.dossiers.toArray(),[],[])
  const cabinets  = useLiveQuery(()=>db.cabinets.toArray(),[],[])
  const activites = useLiveQuery(()=>db.activites.toArray(),[],[])
  const rappels   = useLiveQuery(()=>db.rappels.where('fait').equals(0).toArray(),[],[])
  const cabMap = Object.fromEntries((cabinets||[]).map(c=>[c.id,c]))
  const actMap = {}
  ;(activites||[]).forEach(a=>{ if(!actMap[a.dossierId]) actMap[a.dossierId]=[]; actMap[a.dossierId].push(a) })
  const byEtape = {}
  ETAPES.forEach(e=>{byEtape[e.id]=[]})
  ;(dossiers||[]).forEach(d=>{ if(byEtape[d.etape]) byEtape[d.etape].push(d) })
  const totalPipeline = (dossiers||[]).filter(d=>!['perdu','sav'].includes(d.etape)).reduce((s,d)=>s+(d.montantEstime||0),0)
  const projection = calculerProjectionCA(dossiers||[])
  const rappelsUrgents = (rappels||[]).filter(r=>new Date(r.echeance)<=new Date())
  useEffect(()=>{ seedDemo() },[])
  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}))
  function handleDragStart({active}) { setActiveDrag((dossiers||[]).find(x=>x.id===active.id)||null) }
  async function handleDragEnd({active,over}) {
    setActiveDrag(null)
    if(!over) return
    const d = (dossiers||[]).find(x=>x.id===active.id)
    if(!d||d.etape===over.id) return
    if(['perdu','valide','commande'].includes(over.id)) {
      if(!window.confirm("Passer " + (cabMap[d.cabinetId]?.praticien||"") + " en " + (ETAPE_MAP[over.id]?.label||"") + " ?")) return
    }
    await avancerEtape(d.id, over.id)
  }
  function openDrawer(d) { setDrawerDossier(d); setDrawerCabinet(cabMap[d.cabinetId]||null) }
  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans">
      <TopBar totalPipeline={totalPipeline} projection={projection} rappelsUrgents={rappelsUrgents} onNewDossier={()=>{}} onBrief={()=>setShowBrief(true)}/>
      <div className="flex gap-1.5 px-4 py-2 bg-white border-b border-gray-100 overflow-x-auto flex-shrink-0" style={{scrollbarWidth:'none'}}>
        {ETAPES.map(e=>{
          const n=byEtape[e.id]?.length||0
          return(
            <button key={e.id} onClick={()=>colRefs.current[e.id]?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'})}
              className="flex-shrink-0 px-3 py-1 rounded-full text-xs border transition-all"
              style={{borderColor:e.color+'44',color:e.color,background:n?e.bg:'transparent'}}>
              {e.label}{n>0&&<span className="ml-1 opacity-60">{n}</span>}
            </button>
          )
        })}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 px-4 py-3 overflow-x-auto flex-1 items-start">
          {ETAPES.map(etape=>(
            <KanbanCol key={etape.id} etape={etape} dossiers={byEtape[etape.id]||[]} cabMap={cabMap} actMap={actMap}
              colRef={el=>{colRefs.current[etape.id]=el}} onOpen={openDrawer}/>
          ))}
        </div>
        <DragOverlay>
          {activeDrag&&<CardKanban dossier={activeDrag} cabinet={cabMap[activeDrag.cabinetId]} activites={[]} isDragging/>}
        </DragOverlay>
      </DndContext>
      {drawerDossier&&(
        <Drawer dossier={drawerDossier} cabinet={drawerCabinet}
          allDossiers={(dossiers||[]).filter(d=>d.cabinetId===drawerDossier.cabinetId)}
          activites={actMap[drawerDossier.id]||[]}
          onClose={()=>setDrawerDossier(null)}
          onSwitchDossier={d=>{setDrawerDossier(d);setDrawerCabinet(cabMap[d.cabinetId])}}
          onEtapeChange={async e=>{await avancerEtape(drawerDossier.id,e);setDrawerDossier(p=>({...p,etape:e}))}}/>
      )}
      {showBrief&&(
        <BriefPanel onClose={()=>setShowBrief(false)}
          onOpenDossier={id=>{const d=(dossiers||[]).find(x=>x.id===id);if(d){openDrawer(d);setShowBrief(false)}}}/>
      )}
    </div>
  )
}

function KanbanCol({ etape, dossiers, cabMap, actMap, colRef, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: etape.id })
  return (
    <div ref={el=>{setNodeRef(el);if(colRef)colRef(el)}} className="flex-shrink-0 w-48 flex flex-col">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-xs font-medium uppercase tracking-wider" style={{color:etape.color}}>{etape.label}</span>
        {dossiers.length>0&&<span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{dossiers.length}</span>}
      </div>
      <div className="flex flex-col gap-2 min-h-16 rounded-xl transition-colors p-1"
        style={{background:isOver?etape.bg:'transparent'}}>
        {dossiers.map(d=>(
          <CardKanban key={d.id} dossier={d} cabinet={cabMap[d.cabinetId]} activites={actMap[d.id]||[]} onClick={()=>onOpen(d)}/>
        ))}
      </div>
    </div>
  )
}
