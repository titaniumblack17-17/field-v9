import React, { useCallback, useState } from 'react'

/**
 * Saisie de texte maison, pas `window.prompt`. Sur iPhone, une fois l'app
 * ajoutée à l'écran d'accueil (mode plein écran), les boîtes de dialogue
 * natives du navigateur (alert/confirm/prompt) ne s'affichent plus du
 * tout — l'appui semblait « ne rien faire ». Ici la saisie est un écran de
 * l'application, donc toujours visible, dans ce mode comme dans les autres.
 *
 * Résout avec le texte saisi (chaîne, éventuellement vide) si validé, ou
 * `null` si annulé — même contrat que `window.prompt` pour ne pas changer
 * les appelants.
 */
export default function usePrompt() {
  const [état, setÉtat] = useState(null)
  const [valeur, setValeur] = useState('')

  const demander = useCallback(
    (
      message,
      { titre, confirmLabel = 'Valider', placeholder = '', valeurInitiale = '', numerique = false } = {}
    ) =>
      new Promise((resolve) => {
        setValeur(valeurInitiale)
        setÉtat({ message, titre, confirmLabel, placeholder, numerique, resolve })
      }),
    []
  )

  const répondre = (réponse) => {
    état?.resolve(réponse)
    setÉtat(null)
  }

  const boîte = état && (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0"
      onClick={() => répondre(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-fond rounded-2xl w-full sm:max-w-sm p-5 shadow-lg"
      >
        {état.titre && <h2 className="text-texte font-medium mb-2">{état.titre}</h2>}
        {état.message && (
          <p className="text-texte-doux text-sm whitespace-pre-line mb-3">{état.message}</p>
        )}
        {état.numerique ? (
          // Une heure ne se saisit pas comme une note : un clavier alphabétique
          // plein écran (celui du textarea ci-dessous) pour taper « 09:30 » est
          // pénible sur iPhone, et Entrée y ajoute une ligne au lieu de valider.
          // Même champ, même clavier numérique que le formulaire d'ajout d'un
          // rappel, pour que modifier une heure existante soit aussi simple que
          // d'en poser une nouvelle.
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && répondre(valeur)}
            placeholder={état.placeholder}
            className="w-full bg-carte rounded-xl px-3 py-2 text-texte outline-none placeholder:text-texte-fantome"
          />
        ) : (
          <textarea
            autoFocus
            value={valeur}
            onChange={(e) => {
              setValeur(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${e.target.scrollHeight}px`
            }}
            placeholder={état.placeholder}
            rows={3}
            className="w-full bg-carte rounded-xl px-3 py-2 text-texte outline-none placeholder:text-texte-fantome resize-none overflow-hidden"
          />
        )}
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => répondre(null)}
            className="flex-1 h-11 rounded-xl bg-carte text-texte font-medium active:scale-[0.98] transition"
          >
            Annuler
          </button>
          <button
            onClick={() => répondre(valeur)}
            className="flex-1 h-11 rounded-xl font-medium text-white bg-accent active:scale-[0.98] transition"
          >
            {état.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )

  return [demander, boîte]
}
