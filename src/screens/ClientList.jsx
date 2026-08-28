import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { nomClient } from '../lib/client'
import EtatErreur from '../components/EtatErreur'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// Un centre dont le nom commence par un chiffre ou un symbole n'a pas de
// lettre à lui — il rejoint un repère « # » plutôt que de disparaître de
// l'index.
const lettreDe = (client) => {
  const n = nomClient(client)
  if (!n) return '#'
  const l = normalize(n)[0]
  return l && /[a-z]/.test(l) ? l.toUpperCase() : '#'
}

const normalize = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export default function ClientList({ onSelect, onCreate, onCapture, onPipeline, onBrief, onCatalogue }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState(null)
  const [tentative, setTentative] = useState(0)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setErreur(null)

    supabase
      .from('clients')
      .select('*')
      .order('nom_praticien', { ascending: true })
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          // Signal coupé en visite, timeout : sans ça l'écran restait bloqué
          // sur « Chargement… » indéfiniment, seul écran d'entrée de l'app.
          setErreur('Impossible de charger les clients.')
          setLoading(false)
          return
        }
        setClients(data ?? [])
        setLoading(false)
      })
      .catch(() => {
        // fetch() lui-même peut lever (coupure réseau franche), pas
        // seulement renvoyer un champ error — les deux sont couverts.
        if (active) {
          setErreur('Impossible de charger les clients.')
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
  }, [tentative])

  // Un même nom de praticien porté par plusieurs fiches : on affiche l'adresse
  // en plus du cabinet/ville pour lever l'ambiguïté.
  const homonymes = useMemo(() => {
    const compte = {}
    clients.forEach((c) => {
      // Un centre sans praticien nommé n'a rien à désambiguïser par nom : le
      // compter viendrait à tort marquer tous les centres comme homonymes.
      if (!c.nom_praticien) return
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

  // Sauter directement à une lettre plutôt que de faire défiler toute la
  // liste à la main — utile dès qu'on a plus d'une vingtaine de fiches.
  const lettresDisponibles = useMemo(() => new Set(clients.map(lettreDe)), [clients])
  const premierIdParLettre = useMemo(() => {
    const map = {}
    for (const c of resultats) {
      const l = lettreDe(c)
      if (!(l in map)) map[l] = c.id
    }
    return map
  }, [resultats])
  const ligneRefs = useRef({})
  const allerALaLettre = (lettre) => {
    const id = premierIdParLettre[lettre]
    ligneRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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

        {!loading && erreur && (
          <EtatErreur message={erreur} onReessayer={() => setTentative((t) => t + 1)} />
        )}

        {!loading && !erreur && clients.length === 0 && (
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
            const ambigu = client.nom_praticien && homonymes[normalize(client.nom_praticien)] > 1
            // Le cabinet ne se répète pas en dessous s'il sert déjà de nom
            // principal (centre sans praticien nommé).
            const sousTitre = [
              client.nom_praticien && client.nom_cabinet,
              client.specialites?.length && client.specialites.join(', '),
              client.ville,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={client.id} ref={(el) => { ligneRefs.current[client.id] = el }}>
                <button
                  onClick={() => onSelect(client)}
                  className="w-full text-left bg-carte rounded-xl px-4 py-3 shadow-sm active:scale-[0.98] transition"
                >
                  <p className="font-medium text-texte">{nomClient(client) ?? 'Client'}</p>
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

      {/* Pendant une recherche la liste est déjà courte : l'index n'a plus
          d'utilité et gênerait pour rien. */}
      {!query && clients.length > 12 && (
        <div className="fixed right-0.5 top-1/2 -translate-y-1/2 flex flex-col items-center z-20">
          {[...ALPHABET, '#'].map((lettre) => {
            const disponible = lettresDisponibles.has(lettre)
            return (
              <button
                key={lettre}
                onClick={() => disponible && allerALaLettre(lettre)}
                disabled={!disponible}
                className={`text-[10px] leading-[13px] w-4 font-medium ${
                  disponible ? 'text-accent' : 'text-texte-fantome/40'
                }`}
              >
                {lettre}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
