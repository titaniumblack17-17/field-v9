import React from "react"
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import { genererBrief, calculerProjectionCA } from '../utils/aiEngine'

const URGENCE = { haute:{bg:'#FCEBEB',border:'#F5BFBF',dot:'#E24B4A'}, basse:{bg:'#F5F4F0',border:'#E0DED8',dot:'#888780'}, info:{bg:'#E6F1FB',border:'#B8D8F5',dot:'#378ADD'} }
const fmt = n => !n?'0 €':n>=1000000?(n/1000000).toFixed(1)+' M€':n>=1000?(n/1000).toFixed(0)+' k€':n+' €'

export default function BriefPanel({ onClose, onOpenDossier }) {
  const dossiers  = useLiveQuery(()=>db.dossiers.toArray(),[],[])
  const cabinets  = useLiveQuery(()=>db.cabinets.toArray(),[],[])
  const activites = useLiveQuery(()=>db.activites.toArray(),[],[])
  const rappels   = useLiveQuery(()=>db.rappels.toArray(),[],[])
  if(!dossiers||!cabinets) return null
  const brief = genererBrief(dossiers,cabinets,activites||[],rappels||[])
  const projection = calculerProjectionCA(dossiers)
  const total = brief.sections.reduce((s,sec)=>s+sec.items.length,0)
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose}/>
      <div className="fixed right-0 top-0 bottom-0 w-96 bg-carte border-l border-bordure z-50 flex flex-col shadow-2xl">
        <div className="px-5 py-4 flex-shrink-0" style={{background:'linear-gradient(135deg,#1a1a2e,#16213e)'}}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-blue-300 font-medium uppercase tracking-wider mb-1">Brief du soir</div>
              <div className="text-base font-semibold text-white capitalize">{brief.date}</div>
              <div className="text-xs text-texte-faible mt-1">{total} point{total>1?'s':''} à anticiper</div>
            </div>
            <button onClick={onClose} className="text-texte-doux hover:text-texte-fantome p-1">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 border-b border-separateur">
            <div className="text-xs font-medium uppercase tracking-wider text-texte-faible mb-3">Objectif 5 M€</div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[['Ferme','#EAF3DE','#27500A',projection.caFerme],['Pondéré','#E6F1FB','#0C447C',projection.caWeighted],['Pipeline','#F5F4F0','#444',projection.caPotentiel]].map(([lbl,bg,color,val])=>(
                <div key={lbl} className="rounded-xl p-3 text-center" style={{background:bg}}>
                  <div className="text-xs mb-1" style={{color}}>{lbl}</div>
                  <div className="text-sm font-semibold" style={{color}}>{fmt(val)}</div>
                </div>
              ))}
            </div>
            <div className="h-2 bg-carte-douce rounded-full overflow-hidden mb-1.5">
              <div className="h-full rounded-full" style={{width: projection.txObjectif + "%", background:"linear-gradient(to right,#378ADD,#639922)"}}/>
            </div>
            <div className="flex justify-between text-xs text-texte-faible">
              <span>{projection.txObjectif}% atteint</span><span>5 M€</span>
            </div>
          </div>
          {brief.sections.length===0?(
            <div className="px-5 py-8 text-center"><div className="text-2xl mb-2">✅</div><div className="text-sm font-medium text-texte-doux">Pipeline en ordre</div></div>
          ):(
            <div className="px-5 py-4 space-y-4">
              {brief.sections.map((sec,i)=>{
                const s=URGENCE[sec.urgence]||URGENCE.info
                return(
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full" style={{background:s.dot}}/>
                      <span className="text-xs font-medium text-texte">{sec.titre}</span>
                    </div>
                    <div className="space-y-1.5">
                      {sec.items.map((item,j)=>(
                        <div key={j} onClick={()=>item.dossierId&&onOpenDossier&&onOpenDossier(item.dossierId)}
                          className="flex items-start gap-3 p-3 rounded-xl cursor-pointer hover:opacity-80 border"
                          style={{background:s.bg,borderColor:s.border}}>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-texte truncate">{item.label}</div>
                            <div className="text-xs text-texte-doux mt-0.5">{item.detail}</div>
                          </div>
                          <span className="text-texte-faible text-xs">›</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {brief.creneauxSuggeres.length>0&&(
            <div className="px-5 pb-4">
              <div className="text-xs font-medium uppercase tracking-wider text-texte-faible mb-3">📅 Créneaux demain</div>
              {brief.creneauxSuggeres.map((c,i)=>(
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-purple-50 border border-purple-100 mb-2">
                  <div className="flex-1"><div className="text-xs font-medium text-purple-800">{c.label}</div><div className="text-xs text-purple-500 mt-0.5">{c.moment} · {c.duree}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 px-5 py-3 border-t border-separateur bg-carte-douce">
          <div className="text-xs text-texte-faible text-center">{brief.pipeline.dossierActifs} dossiers · Pipeline {fmt(brief.pipeline.total)}</div>
        </div>
      </div>
    </>
  )
}
