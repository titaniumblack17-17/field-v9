import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import PersonListField from '../components/PersonListField'
import { TYPE_LABELS, styleDossier } from '../constants/dossiers'

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

const cleanPeople = (people) =>
  people
    .map((p) => ({ prenom: (p.prenom ?? '').trim(), telephone: (p.telephone ?? '').trim() }))
    .filter((p) => p.prenom || p.telephone)

export default function ClientDetail({ client, onBack, onNewDossier, onOpenDossier, onDirtyChange }) {
  const [values, setValues] = useState(() => ({ ...client }))
  const [associes, setAssocies] = useState(emptyPeople(client.associes))
  const [assistantes, setAssistantes] = useState(emptyPeople(client.assistantes))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [journal, setJournal] = useState([])
  const [dossiers, setDossiers] = useState([])

  const setField = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }))

  const dirty = useMemo(() => {
    const champs = [...FIELDS.map(([k]) => k), 'notes'].some(
      (k) => (values[k] ?? '') !== (client[k] ?? '')
    )
    const gens =
      JSON.stringify(cleanPeople(associes)) !== JSON.stringify(client.associes ?? []) ||
      JSON.stringify(cleanPeople(assistantes)) !== JSON.stringify(client.assistantes ?? [])
    return champs || gens
  }, [values, associes, assistantes, client])

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  const save = async () => {
    if (!values.nom_praticien?.trim()) {
      setError('Le nom du praticien est obligatoire.')
      return
    }
    setSaving(true)
    setError(null)

    const update = Object.fromEntries(
      FIELDS.map(([k]) => [k, (values[k] ?? '').trim() || null])
    )
    update.notes = (values.notes ?? '').trim() || null
    update.associes = cleanPeople(associes)
    update.assistantes = cleanPeople(assistantes)

    const { data, error: dbError } = await supabase
      .from('clients')
      .update(update)
      .eq('id', client.id)
      .select()
      .single()

    setSaving(false)

    if (dbError) {
      setError(dbError.message)
      return
    }

    Object.assign(client, data)
    setValues({ ...data })
    setAssocies(emptyPeople(data.associes))
    setAssistantes(emptyPeople(data.assistantes))
  }

  const annuler = () => {
    setValues({ ...client })
    setAssocies(emptyPeople(client.associes))
    setAssistantes(emptyPeople(client.assistantes))
    setError(null)
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
    <div className="min-h-screen bg-fond">
      <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-accent text-sm font-medium">
          ← Clients
        </button>
      </header>

      <main className={`px-4 ${dirty ? 'pb-28' : 'pb-8'}`}>
        <h1 className="text-2xl font-semibold text-texte mb-4">
          {[client.prenom_praticien, client.nom_praticien].filter(Boolean).join(' ') || 'Client'}
        </h1>

        <div className="bg-carte rounded-xl shadow-sm divide-y divide-separateur">
          {FIELDS.map(([key, label]) => (
            <div key={key} className="px-4 py-3">
              <label className="text-xs text-texte-faible" htmlFor={key}>
                {label}
                {key === 'nom_praticien' ? ' *' : ''}
              </label>
              <input
                id={key}
                value={values[key] ?? ''}
                onChange={setField(key)}
                placeholder="—"
                className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
              />
            </div>
          ))}
          <PersonListField label="Associé(s)" people={associes} onChange={setAssocies} />
          <PersonListField label="Assistante(s)" people={assistantes} onChange={setAssistantes} />
        </div>

        {error && <p className="text-erreur text-sm mt-3">{error}</p>}

        <div className="mt-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <p className="text-xs text-texte-faible">Dossiers</p>
            <button onClick={() => onNewDossier(client)} className="text-accent text-sm font-medium">
              + Nouveau dossier
            </button>
          </div>
          {dossiers.length === 0 ? (
            <p className="text-texte-faible text-sm px-1">Aucun dossier pour l'instant.</p>
          ) : (
            <ul className="space-y-2">
              {dossiers.map((d) => {
                const s = styleDossier(d)
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => onOpenDossier(d)}
                      style={{ borderColor: s.bordure }}
                      className="w-full text-left bg-carte rounded-xl px-4 py-3 shadow-sm border-l-[7px] active:scale-[0.98] transition"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          style={{ background: s.fond, color: s.texte }}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                        >
                          {s.badge}
                        </span>
                      </div>
                      <p className="font-medium text-texte">{d.titre || TYPE_LABELS[d.type]}</p>
                      <p className="text-sm text-texte-doux">
                        {d.statut}
                        {d.montant_estime != null ? ` · ${d.montant_estime} €` : ''}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="bg-carte rounded-xl shadow-sm mt-4 px-4 py-3">
          <p className="text-xs text-texte-faible mb-1">
            Informations annexes (mail, SMS, ou toute autre info à coller)
          </p>
          <textarea
            value={values.notes ?? ''}
            onChange={setField('notes')}
            rows={6}
            className="w-full text-texte outline-none bg-transparent resize-none"
          />
        </div>

        {journal.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-texte-faible mb-2 px-1">Journal</p>
            <ul className="space-y-2">
              {journal.map((c) => (
                <li key={c.id} className="bg-carte rounded-xl px-4 py-3 shadow-sm">
                  <p className="text-texte text-sm">{c.resume || c.texte}</p>
                  <p className="text-xs text-texte-faible mt-1">
                    {new Date(c.created_at).toLocaleDateString('fr-FR')}
                    {c.date_evenement ? ` · échéance ${c.date_evenement}` : ''}
                  </p>
                  {c.info_manquante && (
                    <p className="text-xs text-alerte mt-1">⚠ {c.info_manquante}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      {dirty && (
        <div className="fixed bottom-0 inset-x-0 bg-fond/95 backdrop-blur border-t border-bordure px-4 py-3 flex gap-2">
          <button
            onClick={annuler}
            className="flex-1 bg-carte text-texte-doux font-medium rounded-xl py-3 shadow"
          >
            Annuler
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-accent text-white font-medium rounded-xl py-3 shadow disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  )
}
