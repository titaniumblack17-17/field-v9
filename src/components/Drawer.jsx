import React, { useState, useRef } from 'react'
import { ETAPES, ETAPE_MAP, ajouterActivite } from '../data/db'

const TS = {
  projet: { bg: '#E6F1FB', color: '#0C447C', label: 'Projet' },
  sav:    { bg: '#FAEEDA', color: '#633806', label: 'SAV' },
  plan:   { bg: '#EAF3DE', color: '#27500A', label: 'Plan' }
}

export default function Drawer({ dossier, cabinet, allDossiers, activites, onClose, onSwitchDossier, onEtapeChange }) {
  const [tab, setTab] = useState('dossier')
  const [noteText, setNoteText] = useState('')
  const [noteType, setNoteType] = useState('RDV')
  const ts = TS[dossier.type] || TS.projet
  const etape = ETAPE_MAP[dossier.etape]
  const etapeIdx = ETAPES.findIndex(function(e) { return e.id === dossier.etape })
  const etapeSuiv = ETAPES[etapeIdx + 1]

  async function handleSend() {
    if (!noteText.trim()) return
    await ajouterActivite({
      dossierId: dossier.id,
      cabinetId: dossier.cabinetId,
      type: noteType,
      contenu: noteText.trim()
    })
    setNoteText('')
  }

  return (
    <div>
      <div
        style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.2)', zIndex:40 }}
        onClick={onClose}
      />
      <div style={{ position:'fixed', right:0, top:0, bottom:0, width:'380px', background:'white', zIndex:50, display:'flex', flexDirection:'column', boxShadow:'-4px 0 20px rgba(0,0,0,0.1)', borderLeft:'1px solid #e5e7eb' }}>

        <div style={{ padding:'16px', borderBottom:'1px solid #f3f4f6' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:'15px', fontWeight:600, color:'#111' }}>{cabinet ? cabinet.praticien : '—'}</div>
              <div style={{ fontSize:'12px', color:'#9ca3af', marginTop:'2px' }}>
                {cabinet ? cabinet.adresse + ', ' + cabinet.cp + ' ' + cabinet.ville : ''}
                {cabinet && cabinet.codeAcces ? ' · Code : ' + cabinet.codeAcces : ''}
              </div>
            </div>
            <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'18px', color:'#9ca3af' }}>✕</button>
          </div>
          <div style={{ display:'flex', gap:'6px', marginTop:'10px', flexWrap:'wrap' }}>
            {allDossiers.map(function(d) {
              var active = d.id === dossier.id
              return (
                <button key={d.id} onClick={function() { onSwitchDossier(d) }}
                  style={{ fontSize:'11px', padding:'3px 10px', borderRadius:'20px', border: active ? '1.5px solid '+ts.color : '1px solid #ddd', background: active ? ts.bg : 'transparent', color: active ? ts.color : '#888', cursor:'pointer', fontWeight: active ? 500 : 400 }}>
                  {d.label || d.type}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display:'flex', borderBottom:'1px solid #f3f4f6' }}>
          {[['dossier','Dossier'],['fiche','Fiche'],['historique','Historique']].map(function(item) {
            var active = tab === item[0]
            return (
              <button key={item[0]} onClick={function() { setTab(item[0]) }}
                style={{ flex:1, padding:'10px 4px', fontSize:'12px', border:'none', borderBottom: active ? '2px solid #378ADD' : '2px solid transparent', background:'none', color: active ? '#378ADD' : '#9ca3af', cursor:'pointer', fontWeight: active ? 500 : 400 }}>
                {item[1]}
              </button>
            )
          })}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px' }}>

          {tab === 'dossier' && (
            <div>
              <div style={{ fontSize:'11px', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.05em', color:'#9ca3af', marginBottom:'8px' }}>Étape actuelle</div>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'16px' }}>
                <span style={{ fontSize:'12px', padding:'4px 12px', borderRadius:'20px', background: etape ? etape.bg : '', color: etape ? etape.color : '', fontWeight:500 }}>
                  {etape ? etape.label : ''}
                </span>
                {etapeSuiv && (
                  <button onClick={function() { onEtapeChange(etapeSuiv.id) }}
                    style={{ fontSize:'12px', padding:'4px 12px', borderRadius:'20px', border:'1px solid #e5e7eb', background:'none', color:'#6b7280', cursor:'pointer' }}>
                    {etapeSuiv.label} →
                  </button>
                )}
              </div>

              <div style={{ fontSize:'11px', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.05em', color:'#9ca3af', marginBottom:'8px' }}>Changer l'étape</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'16px' }}>
                {ETAPES.map(function(e) {
                  var active = e.id === dossier.etape
                  return (
                    <button key={e.id} onClick={function() { onEtapeChange(e.id) }}
                      style={{ fontSize:'11px', padding:'3px 8px', borderRadius:'8px', border:'1px solid ' + (active ? e.color : '#e5e7eb'), background: active ? e.bg : 'transparent', color: active ? e.color : '#9ca3af', cursor:'pointer' }}>
                      {e.label}
                    </button>
                  )
                })}
              </div>

              <div style={{ fontSize:'11px', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.05em', color:'#9ca3af', marginBottom:'8px' }}>Montants</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px' }}>
                {[['Estimé', dossier.montantEstime], ['Devis', dossier.montantDevis], ['Signé', dossier.montantSigne]].map(function(item) {
                  return (
                    <div key={item[0]} style={{ background:'#f9fafb', borderRadius:'8px', padding:'8px', textAlign:'center' }}>
                      <div style={{ fontSize:'10px', color:'#9ca3af', marginBottom:'4px' }}>{item[0]}</div>
                      <div style={{ fontSize:'13px', fontWeight:500, color: item[1] ? '#111' : '#d1d5db' }}>
                        {item[1] ? (item[1]/1000).toFixed(0) + ' k€' : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {tab === 'fiche' && cabinet && (
            <div>
              {[['Adresse', cabinet.adresse + ', ' + cabinet.cp + ' ' + cabinet.ville], ['Code accès', cabinet.codeAcces || '—'], ['Tél fixe', cabinet.tel || '—'], ['Portable', cabinet.portable || '—'], ['Mail', cabinet.mail || '—'], ['Notes', cabinet.notes || '—'], ['Installé', cabinet.marquesInstallees || '—']].map(function(item) {
                return (
                  <div key={item[0]} style={{ display:'flex', gap:'12px', padding:'8px 0', borderBottom:'1px solid #f9fafb', fontSize:'12px' }}>
                    <span style={{ color:'#9ca3af', minWidth:'80px', flexShrink:0 }}>{item[0]}</span>
                    <span style={{ color:'#111' }}>{item[1]}</span>
                  </div>
                )
              })}
              <div style={{ marginTop:'12px' }}>
                <div style={{ fontSize:'11px', fontWeight:500, textTransform:'uppercase', color:'#9ca3af', marginBottom:'8px' }}>Dossiers actifs</div>
                {allDossiers.map(function(d) {
                  var ts2 = TS[d.type] || TS.projet
                  var e = ETAPE_MAP[d.etape]
                  return (
                    <div key={d.id} onClick={function() { onSwitchDossier(d) }}
                      style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 4px', borderBottom:'1px solid #f9fafb', cursor:'pointer', fontSize:'12px' }}>
                      <span style={{ fontSize:'10px', padding:'2px 6px', borderRadius:'6px', background:ts2.bg, color:ts2.color }}>{ts2.label}</span>
                      <span style={{ flex:1, color:'#374151' }}>{d.label}</span>
                      <span style={{ color:'#9ca3af', fontSize:'11px' }}>{e ? e.label : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {tab === 'historique' && (
            <div>
              {activites.length === 0 && (
                <div style={{ textAlign:'center', color:'#9ca3af', fontSize:'12px', padding:'32px 0' }}>Aucune activité</div>
              )}
              {activites.slice().reverse().map(function(a) {
                return (
                  <div key={a.id} style={{ display:'flex', gap:'10px', padding:'10px 0', borderBottom:'1px solid #f9fafb' }}>
                    <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#378ADD', flexShrink:0, marginTop:'4px' }} />
                    <div>
                      <div style={{ fontSize:'11px', fontWeight:500, color:'#6b7280' }}>{a.type}</div>
                      <div style={{ fontSize:'12px', color:'#111', marginTop:'2px', lineHeight:1.5 }}>{a.contenu}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ flexShrink:0, borderTop:'1px solid #f3f4f6', padding:'12px 16px' }}>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px' }}>
            {['RDV','Appel','Mail','Note'].map(function(t) {
              return (
                <button key={t} onClick={function() { setNoteType(t) }}
                  style={{ fontSize:'11px', padding:'3px 10px', borderRadius:'20px', border:'1px solid ' + (noteType===t ? '#85B7EB' : '#e5e7eb'), background: noteType===t ? '#E6F1FB' : 'transparent', color: noteType===t ? '#0C447C' : '#888', cursor:'pointer' }}>
                  + {t}
                </button>
              )
            })}
          </div>
          <div style={{ display:'flex', gap:'8px', alignItems:'flex-end' }}>
            <textarea value={noteText} onChange={function(e) { setNoteText(e.target.value) }}
              placeholder={'Résumé ' + noteType + '...'}
              rows={2}
              style={{ flex:1, fontSize:'12px', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'8px 10px', resize:'none', outline:'none', fontFamily:'inherit', color:'#111' }}
            />
            <button onClick={handleSend} disabled={!noteText.trim()}
              style={{ width:'32px', height:'32px', borderRadius:'50%', background:'#378ADD', border:'none', color:'white', cursor:'pointer', fontSize:'14px', opacity: noteText.trim() ? 1 : 0.4 }}>
              ↑
            </button>
          </div>
          <div style={{ fontSize:'10px', color:'#9ca3af', textAlign:'center', marginTop:'6px' }}>Disponible depuis toutes les étapes</div>
        </div>
      </div>
    </div>
  )
}
