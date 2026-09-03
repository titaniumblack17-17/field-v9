import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ChampChoix from '../components/ChampChoix'
import { ETAPES_PROJET, STATUTS_SAV, REMUNERATION_OPTIONS } from '../constants/dossiers'

const TYPES = [
  ['projet', 'Projet de vente'],
  ['sav', 'SAV'],
  ['plan', 'Plan / cahier des charges'],
]

export default function DossierForm({ client, onCreated, onCancel }) {
  const [type, setType] = useState('projet')
  const [titre, setTitre] = useState('')
  const [statut, setStatut] = useState('prospect')
  const [montantEstime, setMontantEstime] = useState('')
  const [remunerationType, setRemunerationType] = useState('integre')
  const [projetSourceId, setProjetSourceId] = useState('')
  const [dateInstallation, setDateInstallation] = useState('')
  const [rappelDate, setRappelDate] = useState('')
  const [rappelNote, setRappelNote] = useState('')
  const [projetsClient, setProjetsClient] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase
      .from('dossiers')
      .select('id, titre, created_at')
      .eq('client_id', client.id)
      .eq('type', 'projet')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setProjetsClient(data ?? [])
      })
      .catch(() => {})
  }, [client.id])

  useEffect(() => {
    setStatut(type === 'projet' ? 'prospect' : type === 'sav' ? 'ouvert' : 'nouveau')
  }, [type])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      client_id: client.id,
      type,
      titre: titre.trim() || null,
      statut,
      montant_estime: montantEstime ? Number(montantEstime) : null,
      remuneration_type: type === 'plan' ? remunerationType : null,
      projet_source_id: type === 'sav' && projetSourceId ? projetSourceId : null,
      date_installation: dateInstallation || null,
      rappel_date: rappelDate || null,
      rappel_note: rappelNote.trim() || null,
    }

    const { data, error: dbError } = await supabase
      .from('dossiers')
      .insert(payload)
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
        <button onClick={onCancel} className="text-accent text-sm font-semibold">
          Annuler
        </button>
        <h1 className="text-lg font-bold text-texte">Nouveau dossier</h1>
        <span className="w-16" />
      </header>

      <main className="px-4 pb-8">
        <form onSubmit={submit} className="bg-carte rounded-carte shadow-sm divide-y divide-separateur">
          <div className="px-4 py-3">
            <label className="text-xs text-texte-doux">Type</label>
            <div className="flex gap-2 mt-1">
              {TYPES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  className={`flex-1 text-sm font-semibold rounded-imbrique py-2 ${
                    type === value ? 'bg-accent text-white' : 'bg-carte-douce text-texte-doux'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-texte-doux" htmlFor="titre">
              Titre
            </label>
            <input
              id="titre"
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              placeholder="Ex : Installation 3 fauteuils"
              className="w-full text-texte outline-none bg-transparent"
            />
          </div>

          {type === 'projet' && (
            <ChampChoix
              id="statut"
              label="Étape"
              value={statut}
              options={ETAPES_PROJET}
              onChange={setStatut}
            />
          )}

          {type === 'sav' && (
            <>
              <ChampChoix
                id="statut"
                label="Statut"
                value={statut}
                options={STATUTS_SAV}
                onChange={setStatut}
              />
              <ChampChoix
                id="projet_source"
                label="Projet d'origine"
                value={projetSourceId}
                videLibelle="Aucun / à préciser"
                options={projetsClient.map((p) => [
                  p.id,
                  p.titre || new Date(p.created_at).toLocaleDateString('fr-FR'),
                ])}
                onChange={setProjetSourceId}
              />
            </>
          )}

          {type === 'plan' && (
            <div>
              <ChampChoix
                id="remuneration"
                label="Rémunération"
                value={remunerationType}
                options={REMUNERATION_OPTIONS}
                onChange={setRemunerationType}
              />
              {remunerationType === 'partage' && (
                <p className="text-xs text-alerte px-4 pb-3 -mt-2">
                  ⚠ Information visible par vous seul, jamais par le collègue concerné
                </p>
              )}
            </div>
          )}

          <div className="px-4 py-3">
            <label className="text-xs text-texte-doux" htmlFor="montant">
              Montant estimé (€)
            </label>
            <input
              id="montant"
              type="number"
              value={montantEstime}
              onChange={(e) => setMontantEstime(e.target.value)}
              className="w-full text-texte outline-none bg-transparent"
            />
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-texte-doux" htmlFor="date_installation">
              Date d'installation (approximative)
            </label>
            <input
              id="date_installation"
              type="date"
              value={dateInstallation}
              onChange={(e) => setDateInstallation(e.target.value)}
              className="w-full text-texte outline-none bg-transparent"
            />
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-texte-doux" htmlFor="rappel_date">
              Date de rappel
            </label>
            <input
              id="rappel_date"
              type="date"
              value={rappelDate}
              onChange={(e) => setRappelDate(e.target.value)}
              className="w-full text-texte outline-none bg-transparent"
            />
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-texte-doux" htmlFor="rappel_note">
              Note de rappel
            </label>
            <input
              id="rappel_note"
              value={rappelNote}
              onChange={(e) => setRappelNote(e.target.value)}
              className="w-full text-texte outline-none bg-transparent"
            />
          </div>
        </form>

        {error && <p className="text-erreur text-sm mt-3">{error}</p>}

        <button
          onClick={submit}
          disabled={saving}
          className="w-full mt-5 bg-accent text-white font-semibold rounded-imbrique py-3 shadow disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Créer le dossier'}
        </button>
      </main>
    </div>
  )
}
