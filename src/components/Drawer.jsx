import { useState, useRef } from 'react'
import { ETAPES, ETAPE_MAP, ajouterActivite } from '../data/db'
import { analyserNote } from '../utils/aiEngine'

const TS = { projet:{bg:'#E6F1FB',color:'#0C447C',label:'Projet'}, sav:{bg:'#FAEEDA',color:'#633806',label:'SAV'}, plan:{bg:'#EAF3DE',color:'#27500A',label:'Plan'} }
const DOT = { RDV:'#378ADD', Appel:'#EF9F27', Mail:'#1D9E75', Note:'#888780', Etape:'#7F77DD', Dictee:'#E24B4A' }

function fmt(n) { if(!n) return '—'; return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n) }
function relTime(iso) { if(!iso) return ''; const m=Math.floor((Date.now()-new Date(iso))/60000); if(m<1) return "A l'instant"; if(m<60) return 'Il y a '+m+'min'; const h=Math.floor(m/60); if(h<24) return 'Il y a '+h+'h'; const j=Math.floor(h/24); return j<7?'Il y a '+j+'j':new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) }

export default function Drawer({ dossier, cabinet, allDossiers, activites, onClose, onSwitchDossier, onEtapeChange }) {
  const [tab, setTab] = useState('dossier')
  const [noteType, setNoteType] = useState('RDV')
  const [noteText, setNoteText] = useState('')
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [suggestion, setSuggestion] = useState(null)
  const ref = useRef(null)
  const ts = TS[dossier.type] || TS.projet
  const etape = ETAPE_MAP[dossier.etape]
  const etapeIdx = ETAPES.findIndex(e => e.id === dossier.etape)
  const etapeSuiv = ETAPES[etapeIdx + 1]
  const progress = Math.round(((etapeIdx + 1) / ETAPES.length) * 100)

  async function handleSend() {
    if (!noteText.trim()) return
    setSaving(true)
    const analyse = analyserNote(noteText, dossier.etape)
    if (analyse.etapeSuggere || analyse.actionsSuggeres.length > 0) setSuggestion(analyse)
    await ajouterActivite({ dossierId: dossier.id, cabinetId: dossier.cabinetId, type: noteType, contenu: noteText.trim() })
    setNoteText('')
    setSaving(false)
    if (ref.current) ref.current.focus()
  }

  function toggleDictee() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SR) {
      const rec = new SR()
      rec.lang = 'fr-FR'; rec.continuous = false; rec.interimResults = false
      setRecording(true); setNoteType('Dictee')
      rec.onresult = function(e) { setNoteText(function(p){ return p ? p+' '+e.results[0][0].transcript : e.results[0][0].transcript }); setRecording(false) }
      rec.onerror = function() { setRecording(false) }
      rec.onend = function() { setRecording(false) }
      rec.start()
    } else {
      setRecording(true)
      setTimeout(function() { setNoteText('RDV confirme — budget OK, financement Cetelem 36 mois.'); setNoteType('Dictee'); setRecording(false) }, 2000)
    }
  }

  const addrParts = []
  if (cabinet) {
    addrParts.push(cabinet.adresse + ', ' + cabinet.cp + ' ' + cabinet.ville)
    if (cabinet.codeAcces) addrParts.push('Code : ' + cabinet.codeAcces)
  }

  return (
    <div>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-96 bg-white border-l border-gray-200 z-50 flex flex-col shadow-2xl">

        <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{cabinet ? cabinet.praticien : '—'}</div>
              <div className="text-xs text-gray-400 mt-0.5 truncate">{addrParts.join(' · ')}</div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">x</button>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            {allDossiers.map(function(d) {
              const active = d.id === dossier.id
              return (
                <button key={d.id} onClick={function(){ onSwitchDossier(d) }}
                  className="text-xs px-2.5 py-1 rounded-full border transition-all"
                  style={active ? {background:ts.bg,color:ts.color,borderColor:ts.color,fontWeight:500} : {color:'#888',borderColor:'#ddd'}}>
                  {d.label || d.type}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex border-b border-gray-100 flex-shrink-0">
          {[['dossier','Dossier'],['fiche','Fiche cabinet'],['historique','Historique']].map(function(item) {
            return (
              <button key={item[0]} onClick={function(){ setTab(item[0]) }}
                className={'flex-1 py-2.5 text-xs border-b-2 transition-colors ' + (tab===item[0] ? 'border-blue-500 text-blue-600 font-medium' : 'border-transparent text-gray-400')}>
                {item[1]}
              </button>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {tab === 'dossier' && (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Etape actuelle</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs px-3 py-1.5 rounded-full font-medium" style={{background: etape ? etape.bg : '', color: etape ? etape.color : ''}}>{etape ? etape.label : ''}</span>
                  {etapeSuiv && (
                    <button onClick={function(){ onEtapeChange(etapeSuiv.id) }} className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50">
                      {etapeSuiv.label} →
                    </button>
                  )}
                </div>
                <div className="mt-3 h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{width: progress+'%', background: etape ? etape.color : ''}} />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Changer etape</div>
                <div className="flex flex-wrap gap-1.5">
                  {ETAPES.map(function(e) {
                    return (
                      <button key={e.id} onClick={function(){ onEtapeChange(e.id) }}
                        className="text-xs px-2 py-1 rounded-lg border transition-all"
                        style={e.id===dossier.etape ? {background:e.bg,color:e.color,borderColor:e.color} : {color:'#999',borderColor:'#e5e7eb'}}>
                        {e.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[['Estime',dossier.montantEstime],['Devis',dossier.montantDevis],['Signe',dossier.montantSigne]].map(function(item) {
                  return (
                    <div key={item[0]} className="bg-gray-50 rounded-lg p-2.5 text-center">
                      <div className="text-xs text-gray-400 mb-1">{item[0]}</div>
                      <div className={'text-sm font-medium ' + (item[1] ? 'text-gray-900' : 'text-gray-300')}>{item[1] ? fmt(item[1]) : '—'}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {tab === 'fiche' && cabinet && (
            <div>
              {[['Adresse', cabinet.adresse+', '+cabinet.cp+' '+cabinet.ville],['Code acces',cabinet.codeAcces||'—'],['Tel fixe',cabinet.tel||'—'],['Portable',cabinet.portable||'—'],['Mail',cabinet.mail||'—'],['Notes',cabinet.notes||'—']].map(function(item) {
                return (
                  <div key={item[0]} className="flex gap-3 py-2.5 border-b border-gray-50 text-xs">
                    <span className="text-gray-400 w-24 flex-shrink-0">{item[0]}</span>
                    <span className="text-gray-800">{item[1]}</span>
                  </div>
                )
              })}
              <div className="pt-3">
                <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Dossiers actifs</div>
                {allDossiers.map(function(d) {
                  const ts2 = TS[d.type] || TS.projet
                  const e = ETAPE_MAP[d.etape]
                  return (
                    <div key={d.id} onClick={function(){ onSwitchDossier(d) }} className="flex items-center gap-2 py-2 border-b border-gray-50 cursor-pointer hover:bg-gray-50 rounded px-1">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{background:ts2.bg,color:ts2.color}}>{ts2.label}</span>
                      <span className="text-xs text-gray-700 flex-1">{d.label}</span>
                      <span className="text-xs text-gray-400">{e ? e.label : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {tab === 'historique' && (
            <div>
              {activites.length === 0 && <div className="text-xs text-gray-400 text-center py-8">Aucune activite</div>}
              {activites.slice().reverse().map(function(a) {
                return (
                  <div key={a.id} className="flex gap-2.5 py-3 border-b border-gray-50">
                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{background: DOT[a.type] || '#ccc'}} />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-gray-500">{a.type}</div>
                      <div className="text-xs text-gray-800 mt-0.5 leading-relaxed">{a.contenu}</div>
                      <div className="text-xs text-gray-400 mt-1">{relTime(a.createdAt)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {suggestion && (
          <div className="mx-4 mb-2 rounded-xl border border-blue-200 bg-blue-50 flex-shrink-0">
            {suggestion.messageSuggestion && (
              <div className="px-3 py-2.5 flex items-center gap-2">
                <span className="text-xs text-blue-800 flex-1">{suggestion.messageSuggestion}</span>
                <button onClick={function(){ onEtapeChange(suggestion.etapeSuggere); setSuggestion(null) }} className="text-xs font-medium text-white px-3 py-1 rounded-lg bg-blue-500">Oui</button>
                <button onClick={function(){ setSuggestion(null) }} className="text-xs text-gray-500 px-2 py-1">Non</button>
              </div>
            )}
          </div>
        )}

        <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3">
          <div className="flex gap-1.5 flex-wrap mb-2">
            {['RDV','Appel','Mail','Note'].map(function(t) {
              return (
                <button key={t} onClick={function(){ setNoteType(t); if(ref.current) ref.current.focus() }}
                  className="text-xs px-2.5 py-1 rounded-full border transition-all"
                  style={noteType===t ? {background:'#E6F1FB',color:'#0C447C',borderColor:'#85B7EB'} : {color:'#888',borderColor:'#e5e7eb'}}>
                  + {t}
                </button>
              )
            })}
          </div>
          {recording && (
            <div className="flex items-center gap-2 mb-2 text-xs text-red-500">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Enregistrement...
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea ref={ref} value={noteText} onChange={function(e){ setNoteText(e.target.value) }}
              onKeyDown={function(e){ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)) handleSend() }}
              placeholder={'Resume ' + noteType.toLowerCase() + '...'} rows={2}
              className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-blue-400 bg-white text-gray-800" />
            <button onClick={toggleDictee}
              className={'w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 ' + (recording ? 'bg-red-50 border-red-300 text-red-500' : 'border-gray-200 text-gray-400')}>
              M
            </button>
            <button onClick={handleSend} disabled={!noteText.trim() || saving}
              className="w-8 h-8 rounded-full text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40 bg-blue-500">
              ↑
            </button>
          </div>
          <div className="text-xs text-gray-400 text-center mt-1.5">Toutes etapes · Cmd+Entree</div>
        </div>
      </div>
    </div>
  )
}
