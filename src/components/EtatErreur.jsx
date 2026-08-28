import React from 'react'

/**
 * Écran de repli quand un chargement échoue (signal coupé en visite,
 * timeout, panne côté serveur…). Avant ce composant, un chargement qui
 * échouait laissait l'écran bloqué sur « Chargement… » pour toujours — rien
 * ne distinguait « ça arrive » de « c'est cassé », et il n'y avait aucun
 * moyen de relancer sans quitter puis revenir sur l'écran.
 */
export default function EtatErreur({ message = 'Impossible de charger.', onReessayer }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-texte-doux text-sm mb-4">{message}</p>
      <button
        onClick={onReessayer}
        className="h-11 px-5 rounded-xl bg-accent text-white font-medium active:scale-[0.98] transition"
      >
        Réessayer
      </button>
    </div>
  )
}
