import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function ClientList({ onSelect, onCreate }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase
      .from('clients')
      .select('*')
      .order('nom_praticien', { ascending: true })
      .then(({ data }) => {
        if (active) {
          setClients(data ?? [])
          setLoading(false)
        }
      })

    const channel = supabase
      .channel('clients-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clients' },
        (payload) => {
          setClients((current) => {
            if (payload.eventType === 'INSERT') {
              if (current.some((c) => c.id === payload.new.id)) return current
              return [...current, payload.new].sort((a, b) =>
                (a.nom_praticien ?? '').localeCompare(b.nom_praticien ?? '')
              )
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
  }, [])

  return (
    <div className="min-h-screen bg-[#F5F4F0]">
      <header className="sticky top-0 bg-[#F5F4F0]/90 backdrop-blur px-4 pt-6 pb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Clients</h1>
        <button
          onClick={onCreate}
          className="w-9 h-9 rounded-full bg-[#378ADD] text-white text-xl leading-none flex items-center justify-center shadow"
        >
          +
        </button>
      </header>

      <main className="px-4 pb-8">
        {loading && <p className="text-gray-400 text-sm">Chargement…</p>}

        {!loading && clients.length === 0 && (
          <p className="text-gray-400 text-sm mt-8 text-center">
            Aucun client. Touchez + pour en créer un.
          </p>
        )}

        <ul className="space-y-2">
          {clients.map((client) => (
            <li key={client.id}>
              <button
                onClick={() => onSelect(client)}
                className="w-full text-left bg-white rounded-xl px-4 py-3 shadow-sm active:scale-[0.98] transition"
              >
                <p className="font-medium text-gray-900">{client.nom_praticien}</p>
                {(client.nom_cabinet || client.ville) && (
                  <p className="text-sm text-gray-500">
                    {[client.nom_cabinet, client.ville].filter(Boolean).join(' · ')}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
