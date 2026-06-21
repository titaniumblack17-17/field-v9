import React from "react"
import { useDraggable } from '@dnd-kit/core'

const TS = { projet:{bg:'#E6F1FB',color:'#0C447C',label:'Projet'}, sav:{bg:'#FAEEDA',color:'#633806',label:'SAV'}, plan:{bg:'#EAF3DE',color:'#27500A',label:'Plan'} }
const fmt = n => !n?null:n>=1000?(n/1000).toFixed(0)+' k€':n+' €'

export default function CardKanban({ dossier, cabinet, activites, onClick, isDragging }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: dossier.id })
  const style = transform ? { transform:`translate(${transform.x}px,${transform.y}px)`,zIndex:50 } : {}
  const ts = TS[dossier.type] || TS.projet
  const montant = fmt(dossier.montantEstime)
  const hasRappel = dossier.rappelDate && new Date(dossier.rappelDate) <= new Date()
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick}
      className={`bg-white rounded-xl border select-none cursor-pointer transition-all ${isDragging?'shadow-xl rotate-1 opacity-90':'border-gray-200 shadow-sm hover:border-gray-300 hover:shadow-md'}`}>
      <div className="p-2.5">
        <div className="text-[13px] font-medium text-gray-900 leading-tight mb-0.5">{cabinet?.praticien||'—'}</div>
        <div className="text-[11px] text-gray-400 mb-2">{cabinet?.ville}</div>
        <div className="flex gap-1.5 flex-wrap mb-2">
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{background:ts.bg,color:ts.color}}>{ts.label}</span>
          {dossier.label && <span className="text-[10px] text-gray-400 truncate max-w-[90px]">{dossier.label}</span>}
        </div>
        {montant && <div className="text-[11px] text-gray-500 mb-1.5">Estimé : <span className="font-medium text-gray-800">{montant}</span></div>}
        {hasRappel && <div className="flex items-center gap-1 text-[10px] text-amber-600 mt-1">⏰ {dossier.rappelNote||'Rappel'}</div>}
        <div className="mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer"
          onClick={e=>{e.stopPropagation();onClick&&onClick()}}>+ Note rapide</div>
      </div>
    </div>
  )
}
