import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const FIELDS = [
  ['nom_praticien', 'Nom du praticien', true],
  ['nom_cabinet', 'Cabinet', false],
  ['adresse', 'Adresse', false],
  ['code_postal', 'Code postal', false],
  ['ville', 'Ville', false],
  ['telephone_portable', 'Portable', false],
  ['email', 'E-mail', false],
  ['assistante', 'Assistante', false],
]

export default function ClientForm({ onCreated, onCancel }) {
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const setField = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!values.nom_praticien?.trim()) {
      setError('Le nom du praticien est obligatoire.')
      return
    }
    setSaving(true)
    setError(null)

    const { data, error: dbError } = await supabase
      .from('clients')
      .insert({ ...values })
      .select()
      .single()

    setSaving(false)

    if (dbError) {
      setError(dbError.message)
      return
    }

    onCreated(data)
  }

  return (
    <div className="min-h-screen bg-[#F5F4F0]">
      <header className="sticky top-0 bg-[#F5F4F0]/90 backdrop-blur px-4 pt-6 pb-4 flex items-center justify-between">
        <button onClick={onCancel} className="text-[#378ADD] text-sm font-medium">
          Annuler
        </button>
        <h1 className="text-lg font-semibold text-gray-900">Nouveau client</h1>
        <span className="w-16" />
      </header>

      <main className="px-4 pb-8">
        <form onSubmit={submit} className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {FIELDS.map(([key, label, required]) => (
            <div key={key} className="px-4 py-3">
              <label className="text-xs text-gray-400" htmlFor={key}>
                {label}
                {required ? ' *' : ''}
              </label>
              <input
                id={key}
                value={values[key] ?? ''}
                onChange={setField(key)}
                className="w-full text-gray-900 outline-none bg-transparent"
              />
            </div>
          ))}
          <div className="px-4 py-3">
            <label className="text-xs text-gray-400" htmlFor="notes">
              Notes (collez ici un mail, SMS, ou toute info brute)
            </label>
            <textarea
              id="notes"
              value={values.notes ?? ''}
              onChange={setField('notes')}
              rows={4}
              className="w-full text-gray-900 outline-none bg-transparent resize-none"
            />
          </div>
        </form>

        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}

        <button
          onClick={submit}
          disabled={saving}
          className="w-full mt-5 bg-[#378ADD] text-white font-medium rounded-xl py-3 shadow disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Créer le client'}
        </button>
      </main>
    </div>
  )
}
