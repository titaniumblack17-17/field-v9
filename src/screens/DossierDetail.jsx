import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  TYPE_LABELS,
  ETAPES_PROJET,
  STATUTS_SAV,
  REMUNERATION_OPTIONS,
  styleDossier,
} from '../constants/dossiers'

const CHAMPS = [
  'titre',
  'statut',
  'montant_estime',
  'date_installation',
  'rappel_date',
  'rappel_note',
  'remuneration_type',
]

export default function DossierDetail({ dossier, onBack }) {
  const [values, setValues] = useState(() => ({ ...dossier }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  const s = styleDossier(values)

  const setField = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }))

  // Un input number renvoie une chaîne : on compare en chaîne pour ne pas
  // signaler une modification quand la valeur retapée est identique.
  const dirty = useMemo(
    () => CHAMPS.some((k) => String(values[k] ?? '') !== String(dossier[k] ?? '')),
    [values, dossier]
  )

  const save = async () => {
    setSaving(true)
    setError(null)

    const update = {
      titre: (values.titre ?? '').trim() || null,
      statut: values.statut,
      montant_estime: values.montant_estime !== '' && values.montant_estime != null
        ? Number(values.montant_estime)
        : null,
      date_installation: values.date_installation || null,
      rappel_date: values.rappel_date || null,
      rappel_note: (values.rappel_note ?? '').trim() || null,
      remuneration_type: dossier.type === 'plan' ? values.remuneration_type || null : null,
    }

    const { data, error: dbError } = await supabase
      .from('dossiers')
      .update(update)
      .eq('id', dossier.id)
      .select()
      .single()

    setSaving(false)

    if (dbError) {
      setError(dbError.message)
      return
    }

    Object.assign(dossier, data)
    setValues({ ...data })
  }

  const annuler = () => {
    setValues({ ...dossier })
    setError(null)
  }

  useEffect(() => {
    let active = true

    supabase
      .from('dossier_notes')
      .select('*')
      .eq('dossier_id', dossier.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (active) setNotes(data ?? [])
      })

    const channel = supabase
      .channel(`dossier-notes-${dossier.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dossier_notes', filter: `dossier_id=eq.${dossier.id}` },
        (payload) => {
          setNotes((current) => {
            if (payload.eventType === 'INSERT') {
              if (current.some((n) => n.id === payload.new.id)) return current
              return [payload.new, ...current]
            }
            if (payload.eventType === 'DELETE') {
              return current.filter((n) => n.id !== payload.old.id)
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
  }, [dossier.id])

  const addNote = async () => {
    if (!newNote.trim()) return
    setAddingNote(true)
    await supabase.from('dossier_notes').insert({ dossier_id: dossier.id, texte: newNote.trim() })
    setNewNote('')
    setAddingNote(false)
  }

  return (
    <div className="min-h-screen bg-[#F5F4F0]">
      <header className="sticky top-0 z-10 bg-[#F5F4F0]/90 backdrop-blur px-4 pt-6 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#378ADD] text-sm font-medium">
          ← Retour
        </button>
      </header>

      <main className={`px-4 ${dirty ? 'pb-28' : 'pb-8'}`}>
        <div className="flex items-center gap-2 mb-2">
          <span
            style={{ background: s.fond, color: s.texte }}
            className="text-[11px] font-medium px-2.5 py-1 rounded-full"
          >
            {s.badge}
          </span>
          {TYPE_LABELS[dossier.type] !== s.badge && (
            <span className="text-xs text-gray-400">{TYPE_LABELS[dossier.type]}</span>
          )}
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 mb-4">
          {values.titre || TYPE_LABELS[dossier.type]}
        </h1>

        <div
          style={{ borderColor: s.bordure }}
          className="bg-white rounded-xl shadow-sm border-2 overflow-hidden"
        >
          <div style={{ background: s.bordure }} className="h-2.5" />
          <div className="divide-y divide-gray-100">
          <div className="px-4 py-3">
            <label className="text-xs text-gray-400" htmlFor="titre">
              Titre
            </label>
            <input
              id="titre"
              value={values.titre ?? ''}
              onChange={setField('titre')}
              placeholder="—"
              className="w-full text-gray-900 outline-none bg-transparent placeholder:text-gray-300"
            />
          </div>

          {dossier.type === 'projet' && (
            <div className="px-4 py-3">
              <label className="text-xs text-gray-400" htmlFor="statut">
                Étape
              </label>
              <select
                id="statut"
                value={values.statut ?? ''}
                onChange={setField('statut')}
                className="w-full text-gray-900 outline-none bg-transparent"
              >
                {ETAPES_PROJET.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {dossier.type === 'sav' && (
            <div className="px-4 py-3">
              <label className="text-xs text-gray-400" htmlFor="statut">
                Statut
              </label>
              <select
                id="statut"
                value={values.statut ?? ''}
                onChange={setField('statut')}
                className="w-full text-gray-900 outline-none bg-transparent"
              >
                {STATUTS_SAV.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {dossier.type === 'plan' && (
            <div className="px-4 py-3">
              <label className="text-xs text-gray-400" htmlFor="remuneration">
                Rémunération
              </label>
              <select
                id="remuneration"
                value={values.remuneration_type ?? ''}
                onChange={setField('remuneration_type')}
                className="w-full text-gray-900 outline-none bg-transparent"
              >
                <option value="">À préciser</option>
                {REMUNERATION_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {values.remuneration_type === 'partage' && (
                <p className="text-xs text-amber-600 mt-1">
                  ⚠ Information visible par vous seul, jamais par le collègue concerné
                </p>
              )}
            </div>
          )}

          <div className="px-4 py-3">
            <label className="text-xs text-gray-400" htmlFor="montant">
              Montant estimé (€)
            </label>
            <input
              id="montant"
              type="number"
              value={values.montant_estime ?? ''}
              onChange={setField('montant_estime')}
              placeholder="—"
              className="w-full text-gray-900 outline-none bg-transparent placeholder:text-gray-300"
            />
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-gray-400" htmlFor="date_installation">
              Date d'installation (approximative)
            </label>
            <input
              id="date_installation"
              type="date"
              value={values.date_installation ?? ''}
              onChange={setField('date_installation')}
              className="w-full text-gray-900 outline-none bg-transparent"
            />
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-gray-400" htmlFor="rappel_date">
              Date de rappel
            </label>
            <input
              id="rappel_date"
              type="date"
              value={values.rappel_date ?? ''}
              onChange={setField('rappel_date')}
              className="w-full text-gray-900 outline-none bg-transparent"
            />
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-gray-400" htmlFor="rappel_note">
              Note de rappel
            </label>
            <input
              id="rappel_note"
              value={values.rappel_note ?? ''}
              onChange={setField('rappel_note')}
              placeholder="—"
              className="w-full text-gray-900 outline-none bg-transparent placeholder:text-gray-300"
            />
            </div>
          </div>
        </div>

        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}

        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-2 px-1">Notes</p>
          <div className="bg-white rounded-xl shadow-sm p-3 flex gap-2 mb-2">
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Ajouter une note…"
              className="flex-1 text-gray-900 outline-none bg-transparent"
              onKeyDown={(e) => e.key === 'Enter' && addNote()}
            />
            <button
              onClick={addNote}
              disabled={addingNote || !newNote.trim()}
              className="text-[#378ADD] text-sm font-medium disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>
          {notes.length > 0 && (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="bg-white rounded-xl px-4 py-3 shadow-sm">
                  <p className="text-gray-900 text-sm">{n.texte}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(n.created_at).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {dirty && (
        <div className="fixed bottom-0 inset-x-0 bg-[#F5F4F0]/95 backdrop-blur border-t border-gray-200 px-4 py-3 flex gap-2">
          <button
            onClick={annuler}
            className="flex-1 bg-white text-gray-500 font-medium rounded-xl py-3 shadow"
          >
            Annuler
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-[#378ADD] text-white font-medium rounded-xl py-3 shadow disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  )
}
