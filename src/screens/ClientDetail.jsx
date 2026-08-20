import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import PersonListField from '../components/PersonListField'

const FIELDS = [
  ['prenom_praticien', 'Prénom du praticien'],
  ['nom_praticien', 'Nom du praticien'],
  ['nom_cabinet', 'Cabinet'],
  ['adresse', 'Adresse'],
  ['code_postal', 'Code postal'],
  ['ville', 'Ville'],
  ['telephone_portable', 'Portable (praticien)'],
  ['telephone_cabinet', 'Téléphone cabinet'],
  ['email', 'E-mail (praticien)'],
  ['email_cabinet', 'E-mail (cabinet)'],
]

const emptyPeople = (list) => (list?.length ? list : [{ prenom: '', telephone: '' }])

const TYPE_LABELS = { projet: 'Projet de vente', sav: 'SAV', plan: 'Plan / cahier des charges' }

export default function ClientDetail({ client, onBack, onNewDossier, onOpenDossier }) {
  const [editing, setEditing] = useState(false)
  const [dossiers, setDossiers] = useState([])
  const [values, setValues] = useState(client)
  const [associes, setAssocies] = useState(emptyPeople(client.associes))
  const [assistantes, setAssistantes] = useState(emptyPeople(client.assistantes))
  const [savingFiche, setSavingFiche] = useState(false)
  const [ficheError, setFicheError] = useState(null)

  const [notes, setNotes] = useState(client.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [journal, setJournal] = useState([])
  const dirty = notes !== (client.notes ?? '')

  const setField = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }))

  const cleanPeople = (people) =>
    people
      .map((p) => ({ prenom: p.prenom.trim(), telephone: p.telephone.trim() }))
      .filter((p) => p.prenom || p.telephone)

  const startEdit = () => {
    setValues(client)
    setAssocies(emptyPeople(client.associes))
    setAssistantes(emptyPeople(client.assistantes))
    setFicheError(null)
    setEditing(true)
  }

  const saveFiche = async () => {
    if (!values.nom_praticien?.trim()) {
      setFicheError('Le nom du praticien est obligatoire.')
      return
    }
    setSavingFiche(true)
    setFicheError(null)

    const update = {
      prenom_praticien: values.prenom_praticien || null,
      nom_praticien: values.nom_praticien,
      nom_cabinet: values.nom_cabinet || null,
      adresse: values.adresse || null,
      code_postal: values.code_postal || null,
      ville: values.ville || null,
      telephone_portable: values.telephone_portable || null,
      telephone_cabinet: values.telephone_cabinet || null,
      email: values.email || null,
      email_cabinet: values.email_cabinet || null,
      associes: cleanPeople(associes),
      assistantes: cleanPeople(assistantes),
    }

    const { data, error } = await supabase
      .from('clients')
      .update(update)
      .eq('id', client.id)
      .select()
      .single()

    setSavingFiche(false)

    if (error) {
      setFicheError(error.message)
      return
    }

    Object.assign(client, data)
    setEditing(false)
  }

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

  useEffect(() => {
    let active = true

    supabase
      .from('dossiers')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (active) setDossiers(data ?? [])
      })

    const channel = supabase
      .channel(`dossiers-client-${client.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dossiers', filter: `client_id=eq.${client.id}` },
        (payload) => {
          setDossiers((current) => {
            if (payload.eventType === 'INSERT') {
              if (current.some((d) => d.id === payload.new.id)) return current
              return [payload.new, ...current]
            }
            if (payload.eventType === 'UPDATE') {
              return current.map((d) => (d.id === payload.new.id ? payload.new : d))
            }
            if (payload.eventType === 'DELETE') {
              return current.filter((d) => d.id !== payload.old.id)
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
      <header className="sticky top-0 bg-[#F5F4F0]/90 backdrop-blur px-4 pt-6 pb-4 flex items-center justify-between gap-3">
        <button onClick={onBack} className="text-[#378ADD] text-sm font-medium">
          ← Clients
        </button>
        {!editing && (
          <button onClick={startEdit} className="text-[#378ADD] text-sm font-medium">
            Modifier
          </button>
        )}
      </header>

      <main className="px-4 pb-8">
        {!editing && (
          <h1 className="text-2xl font-semibold text-gray-900 mb-4">
            {[client.prenom_praticien, client.nom_praticien].filter(Boolean).join(' ')}
          </h1>
        )}

        {editing ? (
          <>
            <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
              {FIELDS.map(([key, label]) => (
                <div key={key} className="px-4 py-3">
                  <label className="text-xs text-gray-400" htmlFor={key}>
                    {label}
                    {key === 'nom_praticien' ? ' *' : ''}
                  </label>
                  <input
                    id={key}
                    value={values[key] ?? ''}
                    onChange={setField(key)}
                    className="w-full text-gray-900 outline-none bg-transparent"
                  />
                </div>
              ))}
              <PersonListField label="Associé(s)" people={associes} onChange={setAssocies} />
              <PersonListField label="Assistante(s)" people={assistantes} onChange={setAssistantes} />
            </div>

            {ficheError && <p className="text-red-500 text-sm mt-3">{ficheError}</p>}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 bg-white text-gray-500 font-medium rounded-xl py-3 shadow"
              >
                Annuler
              </button>
              <button
                onClick={saveFiche}
                disabled={savingFiche}
                className="flex-1 bg-[#378ADD] text-white font-medium rounded-xl py-3 shadow disabled:opacity-50"
              >
                {savingFiche ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            {FIELDS.filter(([key]) => key !== 'prenom_praticien' && key !== 'nom_praticien').map(
              ([key, label]) =>
                client[key] ? (
                  <div key={key} className="px-4 py-3">
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className="text-gray-900">{client[key]}</p>
                  </div>
                ) : null
            )}
            {client.associes?.length ? (
              <div className="px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">Associé(s)</p>
                {client.associes.map((person, i) => (
                  <p key={i} className="text-gray-900">
                    {person.prenom}
                    {person.telephone ? ` · ${person.telephone}` : ''}
                  </p>
                ))}
              </div>
            ) : null}
            {client.assistantes?.length ? (
              <div className="px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">Assistante(s)</p>
                {client.assistantes.map((person, i) => (
                  <p key={i} className="text-gray-900">
                    {person.prenom}
                    {person.telephone ? ` · ${person.telephone}` : ''}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {!editing && (
          <div className="mt-4">
            <div className="flex items-center justify-between px-1 mb-2">
              <p className="text-xs text-gray-400">Dossiers</p>
              <button onClick={() => onNewDossier(client)} className="text-[#378ADD] text-sm font-medium">
                + Nouveau dossier
              </button>
            </div>
            {dossiers.length === 0 ? (
              <p className="text-gray-400 text-sm px-1">Aucun dossier pour l'instant.</p>
            ) : (
              <ul className="space-y-2">
                {dossiers.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => onOpenDossier(d)}
                      className="w-full text-left bg-white rounded-xl px-4 py-3 shadow-sm active:scale-[0.98] transition"
                    >
                      <p className="font-medium text-gray-900">{d.titre || TYPE_LABELS[d.type]}</p>
                      <p className="text-sm text-gray-500">
                        {TYPE_LABELS[d.type]} · {d.statut}
                        {d.montant_estime != null ? ` · ${d.montant_estime} €` : ''}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!editing && (
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
        )}

        {!editing && journal.length > 0 && (
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
