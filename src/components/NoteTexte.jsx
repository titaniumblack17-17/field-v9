import React, { useEffect, useRef, useState } from 'react'
import { lienifier } from '../lib/texte'

/**
 * Texte de note replié à quelques lignes. Les notes reprises de Todoist font
 * parfois vingt lignes : affichées en entier, elles noient la fiche et il faut
 * défiler longtemps pour atteindre ce qui suit.
 *
 * Le bouton n'apparaît que si le texte déborde réellement — sur une note d'une
 * ligne, « Lire la suite » serait un mensonge.
 */
export default function NoteTexte({ texte, lignes = 4 }) {
  const [ouvert, setOuvert] = useState(false)
  const [deborde, setDeborde] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mesurer = () => setDeborde(el.scrollHeight > el.clientHeight + 1)
    mesurer()
    // La hauteur disponible change avec la largeur de l'écran.
    const ro = new ResizeObserver(mesurer)
    ro.observe(el)
    return () => ro.disconnect()
  }, [texte])

  return (
    <>
      <p
        ref={ref}
        className="text-texte text-sm whitespace-pre-line"
        style={
          ouvert
            ? undefined
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: lignes,
                overflow: 'hidden',
              }
        }
      >
        {lienifier(texte)}
      </p>
      {(deborde || ouvert) && (
        <button
          onClick={() => setOuvert((o) => !o)}
          className="text-accent text-xs font-semibold mt-1"
        >
          {ouvert ? 'Réduire' : 'Lire la suite'}
        </button>
      )}
    </>
  )
}
