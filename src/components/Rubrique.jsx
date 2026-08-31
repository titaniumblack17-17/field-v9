import React, { useEffect, useState } from 'react'

/**
 * Section dépliable d'une fiche. Une fiche ancienne accumule du matériel,
 * des pièces jointes, un journal long — tout affiché en permanence, on ne
 * voit plus rien sans défiler longtemps. Le compte reste visible fermé : on
 * sait qu'il y a quelque chose sans avoir à ouvrir pour vérifier.
 *
 * forceOuvert force l'ouverture (ex : un bouton « + Ajouter » dans l'en-tête
 * doit révéler son formulaire même section repliée) sans empêcher l'utilisateur
 * de replier ensuite à la main — la bascule ne se redéclenche que sur un
 * passage de false à true, jamais en continu.
 *
 * rempli teinte le titre en accent quand la section, une fois repliée,
 * contient déjà une information renseignée — un repère visuel pour ne pas
 * avoir à déplier juste pour vérifier s'il y a quelque chose dedans.
 */
export default function Rubrique({ titre, compte, defautOuvert = false, forceOuvert = false, rempli = false, action, children }) {
  const [ouvert, setOuvert] = useState(defautOuvert)

  useEffect(() => {
    if (forceOuvert) setOuvert(true)
  }, [forceOuvert])

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between px-1 mb-2">
        <button
          onClick={() => setOuvert((v) => !v)}
          className="flex items-center gap-1.5 h-11 -ml-1 pl-1 pr-2"
        >
          <span
            className={`text-texte-faible text-[10px] transition-transform ${ouvert ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className={`text-xs ${rempli ? 'text-accent' : 'text-texte-faible'}`}>
            {titre}
            {compte != null && compte > 0 ? ` · ${compte}` : ''}
          </span>
        </button>
        {action}
      </div>
      {ouvert && children}
    </div>
  )
}
