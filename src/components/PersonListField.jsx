import React from 'react'

export default function PersonListField({ label, people, onChange }) {
  const setAt = (i, key) => (e) => {
    const next = [...people]
    next[i] = { ...next[i], [key]: e.target.value }
    onChange(next)
  }
  const removeAt = (i) => onChange(people.filter((_, idx) => idx !== i))
  const add = () => onChange([...people, { prenom: '', telephone: '' }])

  return (
    <div className="px-4 py-3">
      <label className="text-xs text-gray-400">{label}</label>
      {people.map((person, i) => (
        <div key={i} className="flex items-center gap-2 mt-1">
          <input
            value={person.prenom}
            onChange={setAt(i, 'prenom')}
            placeholder="Prénom"
            className="flex-1 text-gray-900 outline-none bg-transparent"
          />
          <input
            value={person.telephone}
            onChange={setAt(i, 'telephone')}
            placeholder="Téléphone (portable ou cabinet)"
            className="flex-1 text-gray-900 outline-none bg-transparent"
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-gray-300 text-lg leading-none px-1"
            aria-label={`Retirer ${label}`}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="text-[#378ADD] text-sm mt-2">
        + Ajouter
      </button>
    </div>
  )
}
