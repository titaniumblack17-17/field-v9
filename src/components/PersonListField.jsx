import React from 'react'

const LIGNE_VIDE = { prenom: '', nom: '', telephone: '' }

// Nom affichable d'une personne, pour les messages de confirmation.
const designer = (p) =>
  [p?.prenom, p?.nom].map((v) => (v ?? '').trim()).filter(Boolean).join(' ') ||
  (p?.telephone ?? '').trim() ||
  'cette ligne'

export default function PersonListField({ label, people, onChange }) {
  const setAt = (i, key) => (e) => {
    const next = [...people]
    next[i] = { ...next[i], [key]: e.target.value }
    onChange(next)
  }

  const removeAt = (i) => {
    const p = people[i]
    const rempli =
      (p?.prenom ?? '').trim() || (p?.nom ?? '').trim() || (p?.telephone ?? '').trim()
    // On ne demande confirmation que si la ligne contient quelque chose :
    // sur une ligne vide, ce serait de la friction pour rien.
    if (rempli && !window.confirm(`Retirer ${designer(p)} de la liste « ${label} » ?`)) return
    onChange(people.filter((_, idx) => idx !== i))
  }

  const add = () => onChange([...people, { ...LIGNE_VIDE }])

  const styleChamp =
    'w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome'

  return (
    <div className="px-4 py-3">
      <label className="text-xs text-texte-faible">{label}</label>

      {people.map((person, i) => (
        // Prénom et nom côte à côte, téléphone en dessous : trois champs sur
        // une seule ligne deviennent illisibles sur un écran de téléphone.
        <div
          key={i}
          className="mt-2 first:mt-1 pt-2 first:pt-0 border-t first:border-t-0 border-separateur"
        >
          <div className="flex items-center gap-2">
            <input
              value={person.prenom ?? ''}
              onChange={setAt(i, 'prenom')}
              placeholder="Prénom"
              className={styleChamp}
            />
            <input
              value={person.nom ?? ''}
              onChange={setAt(i, 'nom')}
              placeholder="Nom"
              className={styleChamp}
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="text-texte-fantome text-lg leading-none flex-shrink-0 w-11 h-11 flex items-center justify-center -mr-3 -my-2"
              aria-label={`Retirer ${label}`}
            >
              ×
            </button>
          </div>
          <input
            value={person.telephone ?? ''}
            onChange={setAt(i, 'telephone')}
            placeholder="Téléphone (portable ou cabinet)"
            className={`${styleChamp} text-sm`}
          />
        </div>
      ))}

      <button type="button" onClick={add} className="text-accent text-sm mt-2 h-11 px-2 -ml-2 inline-flex items-center">
        + Ajouter
      </button>
    </div>
  )
}
