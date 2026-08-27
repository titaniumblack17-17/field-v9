import React, { useState } from 'react'

/**
 * Remplace un <select> natif. Sur iPhone, le contrôle natif affiche sa valeur
 * dans la police système, ce qui détonne au milieu d'une fiche en Inter — et
 * sa liste déroulante est peu maniable au doigt. Ici, tout est du DOM ordinaire
 * et la feuille reprend celle du bouton « Déplacer » du Pipeline.
 *
 * options : tableau de paires [valeur, libellé].
 */
export default function ChampChoix({
  label,
  value,
  options,
  onChange,
  videLibelle,
  id,
  disabled = false,
  raisonDesactive,
}) {
  const [ouvert, setOuvert] = useState(false)
  const courant = options.find(([v]) => v === value)
  const choix = videLibelle ? [['', videLibelle], ...options] : options

  return (
    <div className="px-4 py-3">
      <label className="text-xs text-texte-faible" htmlFor={id}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOuvert(true)}
        className={`w-full flex items-center justify-between gap-2 text-left ${disabled ? 'opacity-50' : ''}`}
      >
        <span className={courant ? 'text-texte' : 'text-texte-fantome'}>
          {courant ? courant[1] : videLibelle || '—'}
        </span>
        {!disabled && <span className="text-texte-faible text-xs flex-shrink-0">▾</span>}
      </button>
      {disabled && raisonDesactive && (
        <p className="text-xs text-texte-faible mt-1">{raisonDesactive}</p>
      )}

      {ouvert && !disabled && (
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
              {choix.map(([valeur, libelle]) => {
                const actif = valeur === (value ?? '')
                return (
                  <button
                    key={valeur || '__vide__'}
                    type="button"
                    onClick={() => {
                      onChange(valeur)
                      setOuvert(false)
                    }}
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
              className="w-full mt-3 py-3 rounded-xl bg-carte-douce text-texte-doux text-sm font-medium"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
