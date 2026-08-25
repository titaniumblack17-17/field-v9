import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ChoixClient from '../components/ChoixClient'
import { STATUT_PAR_DEFAUT } from '../constants/dossiers'

function SuggestionSav({ capture, enCours, onCreer, onIgnorer, onOuvrir }) {
  if (!capture.sav_suggere || capture.sav_dossier_id) return null
  if (!capture.client_id) {
    return (
      <p className="text-xs text-alerte mt-2">
        ⚠ Ressemble à un SAV, mais reliez d'abord un client pour créer le dossier.
      </p>
    )
  }
  return (
    <div className="bg-alerte/10 border border-alerte/30 rounded-xl px-3 py-2 mt-2">
      <p className="text-sm text-texte">
        🔧 Ressemble à un SAV : {capture.sav_titre || 'à préciser'}
      </p>
      <div className="flex gap-3 mt-1">
        <button
          onClick={async () => {
            const d = await onCreer(capture)
            if (d) onOuvrir?.(d)
          }}
          disabled={enCours}
          className="text-accent text-sm font-medium h-9 disabled:opacity-50"
        >
          {enCours ? 'Création…' : 'Créer le dossier SAV'}
        </button>
        <button
          onClick={() => onIgnorer(capture)}
          disabled={enCours}
          className="text-texte-faible text-sm h-9"
        >
          Ce n'est pas un SAV
        </button>
      </div>
    </div>
  )
}

function SuggestionProjet({ capture, enCours, onCreer, onIgnorer, onOuvrir }) {
  if (!capture.projet_suggere || capture.projet_dossier_id) return null
  if (!capture.client_id) {
    return (
      <p className="text-xs text-alerte mt-2">
        ⚠ Ressemble à une opportunité, mais reliez d'abord un client pour créer le dossier.
      </p>
    )
  }
  return (
    <div className="bg-accent/10 border border-accent/30 rounded-xl px-3 py-2 mt-2">
      <p className="text-sm text-texte">
        💰 Ressemble à un projet : {capture.projet_titre || 'à préciser'}
      </p>
      <div className="flex gap-3 mt-1">
        <button
          onClick={async () => {
            const d = await onCreer(capture)
            if (d) onOuvrir?.(d)
          }}
          disabled={enCours}
          className="text-accent text-sm font-medium h-9 disabled:opacity-50"
        >
          {enCours ? 'Création…' : 'Créer le dossier'}
        </button>
        <button
          onClick={() => onIgnorer(capture)}
          disabled={enCours}
          className="text-texte-faible text-sm h-9"
        >
          Ce n'est pas un projet
        </button>
      </div>
    </div>
  )
}

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

  // Le dossier SAV n'est jamais créé tout seul : la dictée ne fait que le
  // proposer. C'est Bruce qui confirme, comme pour un rappel ou une fusion.
  const creerSav = async (capture) => {
    if (!capture.client_id) return
    setCreationSav(capture.id)
    const { data: dossier, error: errDossier } = await supabase
      .from('dossiers')
      .insert({
        client_id: capture.client_id,
        type: 'sav',
        statut: 'ouvert',
        titre: capture.sav_titre || capture.resume || 'SAV',
      })
      .select()
      .single()

    if (!errDossier) {
      // La dictée brute part au journal du dossier : c'est elle qui garde le
      // détail exact, le titre n'en est qu'un résumé.
      await supabase.from('dossier_notes').insert({
        dossier_id: dossier.id,
        texte: capture.texte,
      })
      await supabase.from('captures').update({ sav_dossier_id: dossier.id }).eq('id', capture.id)
    }
    setCreationSav(null)
    return errDossier ? null : dossier
  }

  // « Ce n'est pas un SAV » : on ne repropose plus, sans rien créer. Mise à
  // jour locale d'abord (retrait immédiat du bandeau), écriture ensuite.
  const ignorerSav = async (capture) => {
    setLastResult((r) => (r?.id === capture.id ? { ...r, sav_suggere: false } : r))
    setUnclassified((cur) =>
      cur.map((c) => (c.id === capture.id ? { ...c, sav_suggere: false } : c))
    )
    await supabase.from('captures').update({ sav_suggere: false }).eq('id', capture.id)
  }

  // Même principe que le SAV : la dictée ne fait que suggérer l'opportunité,
  // c'est Bruce qui confirme la création du dossier.
  const creerProjet = async (capture) => {
    if (!capture.client_id) return
    setCreationProjet(capture.id)
    const { data: dossier, error: errDossier } = await supabase
      .from('dossiers')
      .insert({
        client_id: capture.client_id,
        type: 'projet',
        statut: STATUT_PAR_DEFAUT.projet,
        titre: capture.projet_titre || capture.resume || 'Projet',
      })
      .select()
      .single()

    if (!errDossier) {
      await supabase.from('dossier_notes').insert({
        dossier_id: dossier.id,
        texte: capture.texte,
      })
      await supabase.from('captures').update({ projet_dossier_id: dossier.id }).eq('id', capture.id)
    }
    setCreationProjet(null)
    return errDossier ? null : dossier
  }

  const ignorerProjet = async (capture) => {
    setLastResult((r) => (r?.id === capture.id ? { ...r, projet_suggere: false } : r))
    setUnclassified((cur) =>
      cur.map((c) => (c.id === capture.id ? { ...c, projet_suggere: false } : c))
    )
    await supabase.from('captures').update({ projet_suggere: false }).eq('id', capture.id)
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
          .select('id, prenom_praticien, nom_praticien, ville')
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
                {[clientTouche.prenom_praticien, clientTouche.nom_praticien]
                  .filter(Boolean)
                  .join(' ')}
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
