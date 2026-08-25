import { useCallback, useState } from 'react'

/**
 * Confirmation maison, pas `window.confirm`. La boîte native peut se faire
 * avaler sans un mot : appelée après un `await`, hors du geste direct de
 * l'utilisateur, certains navigateurs la bloquent ou la rendent muette — la
 * suppression semble alors « ne rien faire ». Ici la confirmation est un
 * écran de l'application, donc toujours visible.
 */
export default function useConfirm() {
  const [état, setÉtat] = useState(null)

  const confirmer = useCallback(
    (message, { titre, confirmLabel = 'Confirmer', danger = true } = {}) =>
      new Promise((resolve) => setÉtat({ message, titre, confirmLabel, danger, resolve })),
    []
  )

  const répondre = (réponse) => {
    état?.resolve(réponse)
    setÉtat(null)
  }

  const boîte = état && (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0"
      onClick={() => répondre(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-fond rounded-2xl w-full sm:max-w-sm p-5 shadow-lg"
      >
        {état.titre && <h2 className="text-texte font-medium mb-2">{état.titre}</h2>}
        <p className="text-texte-doux text-sm whitespace-pre-line">{état.message}</p>
        <div className="mt-5 flex gap-3">
          <button
            onClick={() => répondre(false)}
            className="flex-1 h-11 rounded-xl bg-carte text-texte font-medium active:scale-[0.98] transition"
          >
            Annuler
          </button>
          <button
            onClick={() => répondre(true)}
            className={`flex-1 h-11 rounded-xl font-medium text-white active:scale-[0.98] transition ${
              état.danger ? 'bg-erreur' : 'bg-accent'
            }`}
          >
            {état.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )

  return [confirmer, boîte]
}
