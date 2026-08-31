import React, { useState } from 'react'

/**
 * Sous-tâches d'une note, compactes à dessein : les tâches cochées se
 * replient en une ligne « N terminées » plutôt que de s'accumuler barrées
 * les unes sous les autres — la carte de note rétrécit au fil de l'appel
 * plutôt que de s'alourdir (option C, validée par Bruce parmi 3 maquettes).
 */
export default function NoteTaches({ taches, onToggle, onDelete }) {
  const [ouvert, setOuvert] = useState(false)
  const aFaire = taches.filter((t) => !t.fait)
  const faites = taches.filter((t) => t.fait)

  return (
    <div className="mt-2 pt-2 border-t border-separateur">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-texte-faible uppercase tracking-wider">Tâches</p>
        <span className="text-xs font-medium text-accent">
          {faites.length}/{taches.length} faite{taches.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-0.5">
        {aFaire.map((t) => (
          <LigneTache key={t.id} tache={t} onToggle={onToggle} onDelete={onDelete} />
        ))}
      </div>
      {faites.length > 0 &&
        (ouvert ? (
          <>
            <div className="space-y-0.5 mt-0.5">
              {faites.map((t) => (
                <LigneTache key={t.id} tache={t} onToggle={onToggle} onDelete={onDelete} />
              ))}
            </div>
            <button onClick={() => setOuvert(false)} className="text-texte-faible text-xs mt-1 h-7">
              Réduire
            </button>
          </>
        ) : (
          <button onClick={() => setOuvert(true)} className="text-texte-faible text-xs mt-1 h-7">
            {faites.length} tâche{faites.length > 1 ? 's' : ''} terminée{faites.length > 1 ? 's' : ''}
          </button>
        ))}
    </div>
  )
}

function LigneTache({ tache, onToggle, onDelete }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onToggle(tache)} className="flex items-center gap-2 flex-1 min-w-0 text-left py-1">
        <span
          className={`w-[18px] h-[18px] rounded-[5px] border flex-shrink-0 flex items-center justify-center text-[11px] leading-none ${
            tache.fait ? 'bg-accent border-accent text-fond' : 'border-bordure text-transparent'
          }`}
          aria-hidden="true"
        >
          ✓
        </span>
        <span className={`text-sm truncate ${tache.fait ? 'text-texte-doux line-through' : 'text-texte'}`}>
          {tache.texte}
        </span>
      </button>
      <button
        onClick={() => onDelete(tache)}
        aria-label="Supprimer la tâche"
        className="text-texte-fantome text-xs w-7 h-7 flex-shrink-0"
      >
        ✕
      </button>
    </div>
  )
}
