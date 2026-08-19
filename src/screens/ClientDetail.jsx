import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const FIELDS = [
  ['nom_cabinet', 'Cabinet'],
  ['adresse', 'Adresse'],
  ['code_postal', 'Code postal'],
  ['ville', 'Ville'],
  ['telephone_portable', 'Portable (praticien)'],
  ['telephone_cabinet', 'Téléphone cabinet'],
  ['email', 'E-mail (praticien)'],
  ['email_cabinet', 'E-mail (cabinet)'],
]

const LIST_FIELDS = [
  ['associes', 'Associé(s)'],
  ['assistantes', 'Assistante(s)'],
]

export default function ClientDetail({ client, onBack }) {
  const [notes, setNotes] = useState(client.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [journal, setJournal] = useState([])
  const dirty = notes !== (client.notes ?? '')

  const saveNotes = async () => {
    setSaving(true)
    await supabase.from('clients').update({ notes }).eq('id', client.id)
    client.notes = notes
    setSaving(false)
  }

  useEffect(() => {
    let active = true

    supabase
      .from('captures')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (active) setJournal(data ?? [])
      })

    const channel = supabase
      .channel(`captures-client-${client.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'captures', filter: `client_id=eq.${client.id}` },
        (payload) => {
          setJournal((current) => {
            if (payload.eventType === 'INSERT') {
              if (current.some((c) => c.id === payload.new.id)) return current
              return [payload.new, ...current]
            }
            if (payload.eventType === 'UPDATE') {
              return current.map((c) => (c.id === payload.new.id ? payload.new : c))
            }
            if (payload.eventType === 'DELETE') {
              return current.filter((c) => c.id !== payload.old.id)
            }
            return current
          })
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [client.id])

  return (
    <div className="min-h-screen bg-[#F5F4F0]">
      <header className="sticky top-0 bg-[#F5F4F0]/90 backdrop-blur px-4 pt-6 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#378ADD] text-sm font-medium">
          ← Clients
        </button>
      </header>

      <main className="px-4 pb-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">
          {[client.prenom_praticien, client.nom_praticien].filter(Boolean).join(' ')}
        </h1>

        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {FIELDS.map(([key, label]) =>
            client[key] ? (
              <div key={key} className="px-4 py-3">
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-gray-900">{client[key]}</p>
              </div>
            ) : null
          )}
          {LIST_FIELDS.map(([key, label]) =>
            client[key]?.length ? (
              <div key={key} className="px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                {client[key].map((person, i) => (
                  <p key={i} className="text-gray-900">
                    {person.prenom}
                    {person.telephone ? ` · ${person.telephone}` : ''}
                  </p>
                ))}
              </div>
            ) : null
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm mt-4 px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">Informations annexes (mail, SMS, ou toute autre info à coller)</p>
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

        {journal.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2 px-1">Journal</p>
            <ul className="space-y-2">
              {journal.map((c) => (
                <li key={c.id} className="bg-white rounded-xl px-4 py-3 shadow-sm">
                  <p className="text-gray-900 text-sm">{c.resume || c.texte}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(c.created_at).toLocaleDateString('fr-FR')}
                    {c.date_evenement ? ` · échéance ${c.date_evenement}` : ''}
                  </p>
                  {c.info_manquante && (
                    <p className="text-xs text-amber-600 mt-1">⚠ {c.info_manquante}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  )
}
