import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import PersonListField from '../components/PersonListField'
import ChampChoix from '../components/ChampChoix'
import { SOURCE_OPTIONS, SOURCE_DETAIL_PLACEHOLDER } from '../constants/clients'

const FIELDS = [
  ['prenom_praticien', 'Prénom du praticien', false],
  ['nom_praticien', 'Nom du praticien', false],
  ['nom_cabinet', 'Cabinet', false],
  ['adresse', 'Adresse', false],
  ['code_postal', 'Code postal', false],
  ['ville', 'Ville', false],
  ['telephone_portable', 'Portable (praticien)', false],
  ['telephone_cabinet', 'Téléphone cabinet', false],
  ['email', 'E-mail (praticien)', false],
  ['email_cabinet', 'E-mail (cabinet)', false],
]

export default function ClientForm({ onCreated, onCancel }) {
  const [values, setValues] = useState({})
  const [associes, setAssocies] = useState([{ prenom: '', nom: '', telephone: '' }])
  const [assistantes, setAssistantes] = useState([{ prenom: '', nom: '', telephone: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const setField = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }))

  const cleanPeople = (people) =>
    people
      .map((p) => ({
        prenom: (p.prenom ?? '').trim(),
        nom: (p.nom ?? '').trim(),
        telephone: (p.telephone ?? '').trim(),
      }))
      .filter((p) => p.prenom || p.nom || p.telephone)

  const submit = async (e) => {
    e.preventDefault()
    // Un centre (CHSF, SCM, mutuelle...) n'a pas de praticien nommé : le nom
    // du cabinet suffit à identifier la fiche. Il faut au moins l'un des deux.
    if (!values.nom_praticien?.trim() && !values.nom_cabinet?.trim()) {
      setError('Le nom du praticien ou le nom du cabinet est obligatoire.')
      return
    }
    setSaving(true)
    setError(null)

    const { data, error: dbError } = await supabase
      .from('clients')
      .insert({
        ...values,
        associes: cleanPeople(associes),
        assistantes: cleanPeople(assistantes),
      })
      .select()
      .single()

    setSaving(false)

    if (dbError) {
      setError(dbError.message)
      return
    }

    onCreated(data)
  }

  return (
    <div className="min-h-screen bg-fond">
      <header className="sticky top-0 bg-fond/90 backdrop-blur px-4 pt-6 pb-4 flex items-center justify-between">
        <button onClick={onCancel} className="text-accent text-sm font-medium">
          Annuler
        </button>
        <h1 className="text-lg font-semibold text-texte">Nouveau client</h1>
        <span className="w-16" />
      </header>

      <main className="px-4 pb-8">
        <form onSubmit={submit} className="bg-carte rounded-xl shadow-sm divide-y divide-separateur">
          {FIELDS.map(([key, label, required]) => (
            <div key={key} className="px-4 py-3">
              <label className="text-xs text-texte-faible" htmlFor={key}>
                {label}
                {required ? ' *' : ''}
              </label>
              <input
                id={key}
                value={values[key] ?? ''}
                onChange={setField(key)}
                className="w-full text-texte outline-none bg-transparent"
              />
            </div>
          ))}
          <PersonListField label="Associé(s)" people={associes} onChange={setAssocies} />
          <PersonListField label="Assistante(s)" people={assistantes} onChange={setAssistantes} />
          <ChampChoix
            id="source_type"
            label="D'où vient ce contact ?"
            value={values.source_type ?? ''}
            options={SOURCE_OPTIONS}
            videLibelle="À préciser"
            onChange={(v) => setValues((x) => ({ ...x, source_type: v || null }))}
          />
          {values.source_type && (
            <div className="px-4 py-3">
              <label className="text-xs text-texte-faible" htmlFor="source_detail">
                {SOURCE_DETAIL_PLACEHOLDER[values.source_type]}
              </label>
              <input
                id="source_detail"
                value={values.source_detail ?? ''}
                onChange={setField('source_detail')}
                className="w-full text-texte outline-none bg-transparent"
              />
            </div>
          )}
          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="notes">
              Informations annexes (mail, SMS, ou toute autre info à coller)
            </label>
            <textarea
              id="notes"
              value={values.notes ?? ''}
              onChange={setField('notes')}
              rows={4}
              className="w-full text-texte outline-none bg-transparent resize-none"
            />
          </div>
        </form>

        {error && <p className="text-erreur text-sm mt-3">{error}</p>}

        <button
          onClick={submit}
          disabled={saving}
          className="w-full mt-5 bg-accent text-white font-medium rounded-xl py-3 shadow disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Créer le client'}
        </button>
      </main>
    </div>
  )
}
