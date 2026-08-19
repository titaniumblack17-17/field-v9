import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const FIELDS = [
  ['nom_cabinet', 'Cabinet'],
  ['adresse', 'Adresse'],
  ['code_postal', 'Code postal'],
  ['ville', 'Ville'],
  ['telephone_portable', 'Portable'],
  ['email', 'E-mail'],
  ['assistante', 'Assistante'],
]

export default function ClientDetail({ client, onBack }) {
  const [notes, setNotes] = useState(client.notes ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = notes !== (client.notes ?? '')

  const saveNotes = async () => {
    setSaving(true)
    await supabase.from('clients').update({ notes }).eq('id', client.id)
    client.notes = notes
    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-[#F5F4F0]">
      <header className="sticky top-0 bg-[#F5F4F0]/90 backdrop-blur px-4 pt-6 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#378ADD] text-sm font-medium">
          ← Clients
        </button>
      </header>

      <main className="px-4 pb-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">{client.nom_praticien}</h1>

        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {FIELDS.map(([key, label]) =>
            client[key] ? (
              <div key={key} className="px-4 py-3">
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-gray-900">{client[key]}</p>
              </div>
            ) : null
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm mt-4 px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Notes (collez ici un mail, SMS, ou toute info brute)</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            className="w-full text-gray-900 outline-none bg-transparent resize-none"
          />
          {dirty && (
            <button
              onClick={saveNotes}
              disabled={saving}
              className="mt-2 bg-[#378ADD] text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer les notes'}
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
