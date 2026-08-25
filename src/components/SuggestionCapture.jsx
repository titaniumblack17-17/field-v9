import React from 'react'

export function SuggestionSav({ capture, enCours, onCreer, onIgnorer, onOuvrir }) {
  if (!capture.sav_suggere || capture.sav_dossier_id) return null
  if (!capture.client_id) {
    return (
      <p className="text-xs text-alerte mt-2">
        ⚠ Ressemble à un SAV, mais reliez d'abord un client pour créer le dossier.
      </p>
    )
  }
  return (
    <div className="bg-alerte/10 border border-alerte/30 rounded-xl px-3 py-2 mt-2">
      <p className="text-sm text-texte">
        🔧 Ressemble à un SAV : {capture.sav_titre || 'à préciser'}
      </p>
      <div className="flex gap-3 mt-1">
        <button
          onClick={async () => {
            const d = await onCreer(capture)
            if (d) onOuvrir?.(d)
          }}
          disabled={enCours}
          className="text-accent text-sm font-medium h-9 disabled:opacity-50"
        >
          {enCours ? 'Création…' : 'Créer le dossier SAV'}
        </button>
        <button
          onClick={() => onIgnorer(capture)}
          disabled={enCours}
          className="text-texte-faible text-sm h-9"
        >
          Ce n'est pas un SAV
        </button>
      </div>
    </div>
  )
}

export function SuggestionProjet({ capture, enCours, onCreer, onIgnorer, onOuvrir }) {
  if (!capture.projet_suggere || capture.projet_dossier_id) return null
  if (!capture.client_id) {
    return (
      <p className="text-xs text-alerte mt-2">
        ⚠ Ressemble à une opportunité, mais reliez d'abord un client pour créer le dossier.
      </p>
    )
  }
  return (
    <div className="bg-accent/10 border border-accent/30 rounded-xl px-3 py-2 mt-2">
      <p className="text-sm text-texte">
        💰 Ressemble à un projet : {capture.projet_titre || 'à préciser'}
      </p>
      <div className="flex gap-3 mt-1">
        <button
          onClick={async () => {
            const d = await onCreer(capture)
            if (d) onOuvrir?.(d)
          }}
          disabled={enCours}
          className="text-accent text-sm font-medium h-9 disabled:opacity-50"
        >
          {enCours ? 'Création…' : 'Créer le dossier'}
        </button>
        <button
          onClick={() => onIgnorer(capture)}
          disabled={enCours}
          className="text-texte-faible text-sm h-9"
        >
          Ce n'est pas un projet
        </button>
      </div>
    </div>
  )
}
