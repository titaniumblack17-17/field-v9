import React, { useEffect, useRef } from 'react'

const FOCALISABLES =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Feuille du bas (bottom sheet) : fond translucide, panneau en carte aux coins
 * hauts arrondis, 80 % de la hauteur au plus avec défilement. Se ferme au tap
 * sur le fond, sur « Fermer » ou à la touche Échap. Dialogue modal : le focus
 * y est piégé et rendu à l'élément d'origine à la fermeture.
 */
export default function FeuilleBasse({ titre, onFermer, children }) {
  const panneau = useRef(null)
  // Référence stable : le parent passe une fonction neuve à chaque rendu, ce qui
  // ne doit ni relancer l'effet ni voler le focus.
  const fermer = useRef(onFermer)
  fermer.current = onFermer
  const idTitre = useRef(`feuille-${Math.random().toString(36).slice(2, 8)}`).current

  useEffect(() => {
    const origine = document.activeElement
    const defilementAvant = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panneau.current?.querySelector('[data-fermer]')?.focus()

    const surTouche = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        fermer.current()
        return
      }
      if (e.key !== 'Tab' || !panneau.current) return
      const cibles = [...panneau.current.querySelectorAll(FOCALISABLES)].filter((el) => el.offsetParent !== null)
      if (cibles.length === 0) return
      const premier = cibles[0]
      const dernier = cibles[cibles.length - 1]
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault()
        dernier.focus()
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault()
        premier.focus()
      } else if (!panneau.current.contains(document.activeElement)) {
        e.preventDefault()
        premier.focus()
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => {
      document.removeEventListener('keydown', surTouche)
      document.body.style.overflow = defilementAvant
      if (origine instanceof HTMLElement) origine.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0, 0, 0, 0.55)' }} onClick={onFermer} data-feuille-fond>
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-h-[80vh] overflow-y-auto bg-carte rounded-t-[20px] px-4 pb-6"
      >
        <div className="mx-auto mt-2 mb-1 w-10 h-1 rounded-full bg-texte-fantome/60" aria-hidden="true" />
        <div className="flex items-center justify-between sticky top-0 bg-carte py-1">
          <h2 id={idTitre} className="text-[17px] font-semibold text-texte">
            {titre}
          </h2>
          <button
            data-fermer
            onClick={onFermer}
            className="h-11 px-2 -mr-2 text-sm font-medium text-accent-vif"
          >
            Fermer
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
