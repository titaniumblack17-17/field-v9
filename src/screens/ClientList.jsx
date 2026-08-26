import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const normalize = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export default function ClientList({ onSelect, onCreate, onCapture, onPipeline, onBrief, onCatalogue }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

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

  // Un même nom de praticien porté par plusieurs fiches : on affiche l'adresse
  // en plus du cabinet/ville pour lever l'ambiguïté.
  const homonymes = useMemo(() => {
    const compte = {}
    clients.forEach((c) => {
      const clef = normalize(c.nom_praticien)
      compte[clef] = (compte[clef] ?? 0) + 1
    })
    return compte
  }, [clients])

  const resultats = useMemo(() => {
    const termes = normalize(query).split(/\s+/).filter(Boolean)
    if (termes.length === 0) return clients

    return clients.filter((c) => {
      const champs = normalize(
        [c.prenom_praticien, c.nom_praticien, c.nom_cabinet, c.ville, c.code_postal, c.adresse]
          .filter(Boolean)
          .join(' ')
      )
      return termes.every((t) => champs.includes(t))
    })
  }, [clients, query])

  return (
    <div className="min-h-screen bg-fond">
      <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-3">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h1 className="text-xl font-semibold text-texte">Clients</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={onBrief}
              aria-label="Brief soir"
              className="px-4 h-11 rounded-full bg-carte text-accent text-sm font-medium shadow"
            >
              Brief
            </button>
            <button
              onClick={onPipeline}
              className="px-4 h-11 rounded-full bg-carte text-accent text-sm font-medium shadow"
            >
              Pipeline
            </button>
            <button
              onClick={onCapture}
              className="px-4 h-11 rounded-full bg-carte text-accent text-sm font-medium shadow"
            >
              Capture
            </button>
            <button
              onClick={onCatalogue}
              className="px-4 h-11 rounded-full bg-carte text-accent text-sm font-medium shadow"
            >
              Catalogue
            </button>
            <button
              onClick={onCreate}
              aria-label="Nouveau client"
              className="w-11 h-11 flex-shrink-0 rounded-full bg-accent text-white text-xl leading-none flex items-center justify-center shadow"
            >
              +
            </button>
          </div>
        </div>

        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            placeholder="Rechercher un praticien, une ville…"
            aria-label="Rechercher un client"
            className="w-full bg-carte rounded-xl shadow-sm pl-4 pr-9 py-3 text-texte outline-none placeholder:text-texte-faible"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Effacer la recherche"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-texte-fantome text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <main className="px-4 pb-8">
        {loading && <p className="text-texte-faible text-sm">Chargement…</p>}

        {!loading && clients.length === 0 && (
          <p className="text-texte-faible text-sm mt-8 text-center">
            Aucun client. Touchez + pour en créer un.
          </p>
        )}

        {!loading && clients.length > 0 && resultats.length === 0 && (
          <p className="text-texte-faible text-sm mt-8 text-center">
            Aucun client pour « {query} ».
          </p>
        )}

        {query && resultats.length > 0 && (
          <p className="text-xs text-texte-faible mb-2 px-1">
            {resultats.length} résultat{resultats.length > 1 ? 's' : ''}
          </p>
        )}

        <ul className="space-y-2">
          {resultats.map((client) => {
            const ambigu = homonymes[normalize(client.nom_praticien)] > 1
            const sousTitre = [client.nom_cabinet, client.ville].filter(Boolean).join(' · ')
            return (
              <li key={client.id}>
                <button
                  onClick={() => onSelect(client)}
                  className="w-full text-left bg-carte rounded-xl px-4 py-3 shadow-sm active:scale-[0.98] transition"
                >
                  <p className="font-medium text-texte">
                    {[client.prenom_praticien, client.nom_praticien].filter(Boolean).join(' ')}
                  </p>
                  {sousTitre && <p className="text-sm text-texte-doux">{sousTitre}</p>}
                  {ambigu && client.adresse && (
                    <p className="text-xs text-texte-faible mt-0.5">{client.adresse}</p>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </main>
    </div>
  )
}
