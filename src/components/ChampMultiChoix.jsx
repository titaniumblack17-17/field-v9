import React, { useState } from 'react'

/**
 * Variante multi-sélection de ChampChoix : plusieurs valeurs peuvent être
 * cochées à la fois (ex. spécialités d'un praticien). Sélectionner un choix
 * ne referme pas la feuille — sinon cocher un deuxième élément demanderait
 * de rouvrir le menu à chaque fois.
 *
 * options : tableau de paires [valeur, libellé]. value : tableau de valeurs.
 */
export default function ChampMultiChoix({ label, value, options, onChange, id }) {
  const [ouvert, setOuvert] = useState(false)
  const valeurs = value ?? []
  const libelles = options.filter(([v]) => valeurs.includes(v)).map(([, l]) => l)

  const basculer = (v) => {
    onChange(valeurs.includes(v) ? valeurs.filter((x) => x !== v) : [...valeurs, v])
  }

  return (
    <div className="px-4 py-3">
      <label className="text-xs text-texte-faible" htmlFor={id}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        onClick={() => setOuvert(true)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className={libelles.length ? 'text-texte' : 'text-texte-fantome'}>
          {libelles.length ? libelles.join(', ') : '—'}
        </span>
        <span className="text-texte-faible text-xs flex-shrink-0">▾</span>
      </button>

      {ouvert && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end"
          onClick={() => setOuvert(false)}
        >
          <div
            className="bg-carte w-full rounded-t-2xl p-4 max-h-[75vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-texte-faible mb-3">{label}</p>
            <div className="flex flex-col gap-2">
              {options.map(([valeur, libelle]) => {
                const actif = valeurs.includes(valeur)
                return (
                  <button
                    key={valeur}
                    type="button"
                    onClick={() => basculer(valeur)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-sm ${
                      actif
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-bordure text-texte-doux'
                    }`}
                  >
                    {libelle}
                    {actif && <span className="ml-auto text-xs">✓</span>}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              className="w-full mt-3 py-3 rounded-xl bg-accent text-white text-sm font-medium"
            >
              Terminé
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
