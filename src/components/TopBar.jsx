const fmt = n => !n?'0 €':n>=1000000?(n/1000000).toFixed(1)+' M€':n>=1000?(n/1000).toFixed(0)+' k€':n+' €'

export default function TopBar({ totalPipeline, projection, rappelsUrgents, onNewDossier, onBrief }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-100 flex-shrink-0 overflow-x-auto">
      <div className="text-[16px] font-semibold tracking-tight text-gray-900 flex-shrink-0">Field<span style={{color:'#378ADD'}}>.</span></div>
      <div className="text-[11px] text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full flex-shrink-0">Bruce · Île-de-France</div>
      <div className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-green-50 text-green-700 flex-shrink-0">Pipeline : {fmt(totalPipeline)}</div>
      {projection && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-[11px] text-gray-500">Objectif : <span className="font-medium text-gray-700">{projection.txObjectif}%</span></div>
          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{width:`${projection.txObjectif}%`,background:'linear-gradient(to right,#378ADD,#639922)'}}/>
          </div>
          <div className="text-[10px] text-gray-400">5 M€</div>
        </div>
      )}
      {rappelsUrgents?.length>0 && (
        <div className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 flex items-center gap-1 flex-shrink-0">
          ⏰ {rappelsUrgents.length} rappel{rappelsUrgents.length>1?'s':''}
        </div>
      )}
      <div className="ml-auto flex gap-2 items-center flex-shrink-0">
        <button onClick={onBrief} className="text-[12px] px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">🌙 Brief soir</button>
        <button className="text-[12px] px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">Import Todoist</button>
        <button onClick={onNewDossier} className="text-[12px] px-3 py-1.5 rounded-lg text-white font-medium transition-colors" style={{background:'#378ADD'}}>+ Dossier</button>
      </div>
    </div>
  )
}
