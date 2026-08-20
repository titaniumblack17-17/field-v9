import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const TYPE_LABELS = { projet: 'Projet de vente', sav: 'SAV', plan: 'Plan / cahier des charges' }

const ETAPES_PROJET = [
  ['prospect', 'Prospect'],
  ['prise_contact', 'Prise de contact'],
  ['devis_a_faire', 'Devis à faire'],
  ['devis_envoye', 'Devis envoyé'],
  ['relance', 'Relance'],
  ['visite_local', 'Visite local'],
  ['confirmation', 'Confirmation'],
  ['commande', 'Commande'],
  ['reunion_chantier', 'Réunion de chantier'],
  ['installation', 'Installation'],
  ['finition', 'Finition'],
  ['financement', 'Financement'],
  ['perdu', 'Dossier perdu'],
  ['sav', 'SAV'],
]

const STATUTS_SAV = [
  ['ouvert', 'Ouvert'],
  ['clos', 'Clos'],
]

const REMUNERATION = {
  facture: 'Facturé 500 € TTC',
  integre: 'Intégré au suivi normal',
  partage: 'Partagé avec un collègue',
}

export default function DossierDetail({ dossier, onBack }) {
  const [editing, setEditing] = useState(false)
  const [titre, setTitre] = useState(dossier.titre ?? '')
  const [statut, setStatut] = useState(dossier.statut)
  const [montantEstime, setMontantEstime] = useState(dossier.montant_estime ?? '')
  const [rappelDate, setRappelDate] = useState(dossier.rappel_date ?? '')
  const [rappelNote, setRappelNote] = useState(dossier.rappel_note ?? '')
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setTitre(dossier.titre ?? '')
    setStatut(dossier.statut)
    setMontantEstime(dossier.montant_estime ?? '')
    setRappelDate(dossier.rappel_date ?? '')
    setRappelNote(dossier.rappel_note ?? '')
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    const update = {
      titre: titre.trim() || null,
      statut,
      montant_estime: montantEstime !== '' ? Number(montantEstime) : null,
      rappel_date: rappelDate || null,
      rappel_note: rappelNote.trim() || null,
    }
    const { data } = await supabase.from('dossiers').update(update).eq('id', dossier.id).select().single()
    setSaving(false)
    if (data) Object.assign(dossier, data)
    setEditing(false)
  }

  return (
    <div className="min-h-screen bg-[#F5F4F0]">
      <header className="sticky top-0 bg-[#F5F4F0]/90 backdrop-blur px-4 pt-6 pb-4 flex items-center justify-between gap-3">
        <button onClick={onBack} className="text-[#378ADD] text-sm font-medium">
          ← Retour
        </button>
        {!editing && (
          <button onClick={startEdit} className="text-[#378ADD] text-sm font-medium">
            Modifier
          </button>
        )}
      </header>

      <main className="px-4 pb-8">
        <p className="text-xs text-gray-400 mb-1">{TYPE_LABELS[dossier.type]}</p>
        {!editing && (
          <h1 className="text-2xl font-semibold text-gray-900 mb-4">
            {dossier.titre || TYPE_LABELS[dossier.type]}
          </h1>
        )}

        {editing ? (
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            <div className="px-4 py-3">
              <label className="text-xs text-gray-400" htmlFor="titre">
                Titre
              </label>
              <input
                id="titre"
                value={titre}
                onChange={(e) => setTitre(e.target.value)}
                className="w-full text-gray-900 outline-none bg-transparent"
              />
            </div>

            {dossier.type === 'projet' && (
              <div className="px-4 py-3">
                <label className="text-xs text-gray-400" htmlFor="statut">
                  Étape
                </label>
                <select
                  id="statut"
                  value={statut}
                  onChange={(e) => setStatut(e.target.value)}
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
                  value={statut}
                  onChange={(e) => setStatut(e.target.value)}
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

            <div className="px-4 py-3">
              <label className="text-xs text-gray-400" htmlFor="montant">
                Montant estimé (€)
              </label>
              <input
                id="montant"
                type="number"
                value={montantEstime}
                onChange={(e) => setMontantEstime(e.target.value)}
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
                value={rappelDate}
                onChange={(e) => setRappelDate(e.target.value)}
                className="w-full text-gray-900 outline-none bg-transparent"
              />
            </div>

            <div className="px-4 py-3">
              <label className="text-xs text-gray-400" htmlFor="rappel_note">
                Note de rappel
              </label>
              <input
                id="rappel_note"
                value={rappelNote}
                onChange={(e) => setRappelNote(e.target.value)}
                className="w-full text-gray-900 outline-none bg-transparent"
              />
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            <div className="px-4 py-3">
              <p className="text-xs text-gray-400">
                {dossier.type === 'sav' ? 'Statut' : 'Étape'}
              </p>
              <p className="text-gray-900">
                {dossier.type === 'projet'
                  ? ETAPES_PROJET.find(([v]) => v === dossier.statut)?.[1] ?? dossier.statut
                  : dossier.type === 'sav'
                    ? STATUTS_SAV.find(([v]) => v === dossier.statut)?.[1] ?? dossier.statut
                    : dossier.statut}
              </p>
            </div>
            {dossier.type === 'plan' && dossier.remuneration_type && (
              <div className="px-4 py-3">
                <p className="text-xs text-gray-400">Rémunération</p>
                <p className="text-gray-900">{REMUNERATION[dossier.remuneration_type]}</p>
              </div>
            )}
            {dossier.montant_estime != null && (
              <div className="px-4 py-3">
                <p className="text-xs text-gray-400">Montant estimé</p>
                <p className="text-gray-900">{dossier.montant_estime} €</p>
              </div>
            )}
            {dossier.rappel_date && (
              <div className="px-4 py-3">
                <p className="text-xs text-gray-400">Rappel</p>
                <p className="text-gray-900">
                  {dossier.rappel_date}
                  {dossier.rappel_note ? ` · ${dossier.rappel_note}` : ''}
                </p>
              </div>
            )}
          </div>
        )}

        {editing && (
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setEditing(false)}
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
      </main>
    </div>
  )
}
