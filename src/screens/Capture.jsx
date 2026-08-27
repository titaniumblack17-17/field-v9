import React, { useEffect, useState } from 'react'
import { nomClient } from '../lib/client'
import { supabase } from '../lib/supabaseClient'
import ChoixClient from '../components/ChoixClient'
import { SuggestionSav, SuggestionProjet, SuggestionPlan } from '../components/SuggestionCapture'
import { creerDossierDepuisSuggestion, ignorerSuggestion } from '../lib/suggestions'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/capture-intake`

export default function Capture({ onBack, onOpenClient, onOpenDossier }) {
  const [texte, setTexte] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [unclassified, setUnclassified] = useState([])
  // Capture en attente d'un client : la feuille de sélection s'ouvre dessus.
  const [aRelier, setARelier] = useState(null)
  const [clientTouche, setClientTouche] = useState(null)
  const [creationSav, setCreationSav] = useState(null)
  const [creationProjet, setCreationProjet] = useState(null)
  const [creationPlan, setCreationPlan] = useState(null)

  // Le dossier n'est jamais créé tout seul : la dictée ne fait que le
  // proposer. C'est Bruce qui confirme, comme pour un rappel ou une fusion.
  const creerSav = async (capture) => {
    setCreationSav(capture.id)
    const dossier = await creerDossierDepuisSuggestion(capture, 'sav')
    setCreationSav(null)
    return dossier
  }

  const ignorerSav = async (capture) => {
    setLastResult((r) => (r?.id === capture.id ? { ...r, sav_suggere: false } : r))
    setUnclassified((cur) =>
      cur.map((c) => (c.id === capture.id ? { ...c, sav_suggere: false } : c))
    )
    await ignorerSuggestion(capture, 'sav')
  }

  const creerProjet = async (capture) => {
    setCreationProjet(capture.id)
    const dossier = await creerDossierDepuisSuggestion(capture, 'projet')
    setCreationProjet(null)
    return dossier
  }

  const ignorerProjet = async (capture) => {
    setLastResult((r) => (r?.id === capture.id ? { ...r, projet_suggere: false } : r))
    setUnclassified((cur) =>
      cur.map((c) => (c.id === capture.id ? { ...c, projet_suggere: false } : c))
    )
    await ignorerSuggestion(capture, 'projet')
  }

  const creerPlan = async (capture) => {
    setCreationPlan(capture.id)
    const dossier = await creerDossierDepuisSuggestion(capture, 'plan')
    setCreationPlan(null)
    return dossier
  }

  const ignorerPlan = async (capture) => {
    setLastResult((r) => (r?.id === capture.id ? { ...r, plan_suggere: false } : r))
    setUnclassified((cur) =>
      cur.map((c) => (c.id === capture.id ? { ...c, plan_suggere: false } : c))
    )
    await ignorerSuggestion(capture, 'plan')
  }

  const relier = async (capture, client) => {
    setARelier(null)
    await supabase.from('captures').update({ client_id: client.id }).eq('id', capture.id)
    setUnclassified((cur) => cur.filter((c) => c.id !== capture.id))
  }

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
      // La fonction renvoie l'identifiant du client concerné ; sans son nom,
      // « fiche complétée » ne dit pas laquelle.
      if (data.client_id) {
        const { data: c } = await supabase
          .from('clients')
          .select('id, prenom_praticien, nom_praticien, nom_cabinet, ville')
          .eq('id', data.client_id)
          .maybeSingle()
        setClientTouche(c ?? null)
      } else {
        setClientTouche(null)
      }
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
            {clientTouche && (
              <button
                onClick={() => onOpenClient?.(clientTouche)}
                className="text-sm text-accent mt-2 font-medium text-left"
              >
                {lastResult.client_created
                  ? '✓ Fiche créée'
                  : lastResult.client_enrichi
                    ? '✓ Fiche complétée'
                    : '✓ Rattaché'}
                {' · '}
                {nomClient(clientTouche) ?? 'Client'}
                {' →'}
              </button>
            )}
            {!lastResult.client_id && (
              <p className="text-sm text-alerte mt-1">
                ⚠ Client non identifié — à relier ci-dessous
              </p>
            )}
            <SuggestionSav
              capture={lastResult}
              enCours={creationSav === lastResult.id}
              onCreer={creerSav}
              onIgnorer={ignorerSav}
              onOuvrir={onOpenDossier}
            />
            <SuggestionProjet
              capture={lastResult}
              enCours={creationProjet === lastResult.id}
              onCreer={creerProjet}
              onIgnorer={ignorerProjet}
              onOuvrir={onOpenDossier}
            />
            <SuggestionPlan
              capture={lastResult}
              enCours={creationPlan === lastResult.id}
              onCreer={creerPlan}
              onIgnorer={ignorerPlan}
              onOuvrir={onOpenDossier}
            />
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
                  <SuggestionSav
                    capture={c}
                    enCours={creationSav === c.id}
                    onCreer={creerSav}
                    onIgnorer={ignorerSav}
                  />
                  <SuggestionProjet
                    capture={c}
                    enCours={creationProjet === c.id}
                    onCreer={creerProjet}
                    onIgnorer={ignorerProjet}
                  />
                  <SuggestionPlan
                    capture={c}
                    enCours={creationPlan === c.id}
                    onCreer={creerPlan}
                    onIgnorer={ignorerPlan}
                  />
                  <div className="flex items-center gap-3 mt-2">
                    <p className="text-xs text-texte-faible flex-1">
                      {new Date(c.created_at).toLocaleDateString('fr-FR')}
                    </p>
                    <button
                      onClick={() => setARelier(c)}
                      className="text-accent text-xs font-medium h-9 px-1"
                    >
                      Relier à un client
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      {aRelier && (
        <ChoixClient
          onChoisir={(client) => relier(aRelier, client)}
          onFermer={() => setARelier(null)}
        />
      )}
    </div>
  )
}
