import React from 'react'

export default function PersonListField({ label, people, onChange }) {
  const setAt = (i, key) => (e) => {
    const next = [...people]
    next[i] = { ...next[i], [key]: e.target.value }
    onChange(next)
  }
  const removeAt = (i) => {
    const p = people[i]
    const rempli = (p?.prenom ?? '').trim() || (p?.telephone ?? '').trim()
    // On ne demande confirmation que si la ligne contient quelque chose :
    // sur une ligne vide, ce serait de la friction pour rien.
    if (rempli) {
      const nom = (p.prenom ?? '').trim() || (p.telephone ?? '').trim()
      if (!window.confirm(`Retirer ${nom} de la liste « ${label} » ?`)) return
    }
    onChange(people.filter((_, idx) => idx !== i))
  }
  const add = () => onChange([...people, { prenom: '', telephone: '' }])

  return (
    <div className="px-4 py-3">
      <label className="text-xs text-texte-faible">{label}</label>
      {people.map((person, i) => (
        <div key={i} className="flex items-center gap-2 mt-1">
          <input
            value={person.prenom}
            onChange={setAt(i, 'prenom')}
            placeholder="Prénom"
            className="flex-1 text-texte outline-none bg-transparent"
          />
          <input
            value={person.telephone}
            onChange={setAt(i, 'telephone')}
            placeholder="Téléphone (portable ou cabinet)"
            className="flex-1 text-texte outline-none bg-transparent"
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-texte-fantome text-lg leading-none px-1"
            aria-label={`Retirer ${label}`}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="text-accent text-sm mt-2">
        + Ajouter
      </button>
    </div>
  )
}
