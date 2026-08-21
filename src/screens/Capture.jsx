import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/capture-intake`

export default function Capture({ onBack, onOpenClient }) {
  const [texte, setTexte] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [unclassified, setUnclassified] = useState([])

  useEffect(() => {
    let active = true

    supabase
      .from('captures')
      .select('*')
      .is('client_id', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (active) setUnclassified(data ?? [])
      })

    const channel = supabase
      .channel('captures-unclassified')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'captures' },
        (payload) => {
          setUnclassified((current) => {
            if (payload.eventType === 'INSERT' && !payload.new.client_id) {
              return [payload.new, ...current]
            }
            if (payload.eventType === 'UPDATE') {
              if (payload.new.client_id) return current.filter((c) => c.id !== payload.new.id)
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

  const submit = async (e) => {
    e.preventDefault()
    if (!texte.trim()) return
    setSending(true)
    setError(null)
    setLastResult(null)

    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texte: texte.trim(), source: 'clavier' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur inconnue')
      setLastResult(data)
      setTexte('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-fond">
      <header className="sticky top-0 bg-fond/90 backdrop-blur px-4 pt-6 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-accent text-sm font-medium h-11 -ml-2 pl-2 pr-1 flex items-center">
          ← Clients
        </button>
        <h1 className="text-lg font-semibold text-texte">Capture rapide</h1>
      </header>

      <main className="px-4 pb-8">
        <form onSubmit={submit} className="bg-carte rounded-xl shadow-sm p-4">
          <textarea
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            rows={5}
            placeholder="Client, qu'est-ce qui se passe ?"
            className="w-full text-texte outline-none bg-transparent resize-none"
          />
          <button
            type="submit"
            disabled={sending || !texte.trim()}
            className="w-full mt-3 bg-accent text-white font-medium rounded-xl py-3 shadow disabled:opacity-50"
          >
            {sending ? 'Analyse en cours…' : 'Envoyer'}
          </button>
        </form>

        {error && <p className="text-erreur text-sm mt-3">{error}</p>}

        {lastResult && (
          <div className="bg-carte rounded-xl shadow-sm mt-4 px-4 py-3">
            <p className="text-xs text-texte-faible mb-1">Retenu</p>
            <p className="text-texte">{lastResult.resume}</p>
            {lastResult.date_evenement && (
              <p className="text-sm text-texte-doux mt-1">Échéance : {lastResult.date_evenement}</p>
            )}
            {lastResult.info_manquante && (
              <p className="text-sm text-alerte mt-1">⚠ {lastResult.info_manquante}</p>
            )}
            {lastResult.client_created && (
              <p className="text-sm text-accent mt-1">✓ Nouvelle fiche créée</p>
            )}
            {!lastResult.client_id && !lastResult.client_created && (
              <p className="text-sm text-alerte mt-1">⚠ Client non identifié</p>
            )}
          </div>
        )}

        {unclassified.length > 0 && (
          <div className="mt-6">
            <p className="text-xs text-texte-faible mb-2 px-1">À relier à un client ({unclassified.length})</p>
            <ul className="space-y-2">
              {unclassified.map((c) => (
                <li key={c.id} className="bg-carte rounded-xl px-4 py-3 shadow-sm">
                  <p className="text-texte text-sm">{c.resume || c.texte}</p>
                  {c.info_manquante && (
                    <p className="text-xs text-alerte mt-1">⚠ {c.info_manquante}</p>
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
