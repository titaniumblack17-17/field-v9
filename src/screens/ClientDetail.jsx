import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import NoteTexte from '../components/NoteTexte'
import { synchroniserRappel } from '../lib/todoist'
import PersonListField from '../components/PersonListField'
import MaterielInstalle from '../components/MaterielInstalle'
import PiecesJointes from '../components/PiecesJointes'
import {
  TYPE_LABELS,
  ETAPES_PROJET,
  STATUTS_PLAN_LABELS,
  STATUTS_SAV,
  PLAN_SANS_COMMERCIAL,
  styleDossier,
} from '../constants/dossiers'

// Le statut est stocké en clé technique (« a_planifier ») : sans traduction,
// la liste des dossiers affiche du jargon de base de données.
const libelleStatut = (d) => {
  if (d.type === 'plan') return STATUTS_PLAN_LABELS[d.statut] ?? d.statut
  if (d.type === 'sav') return STATUTS_SAV.find(([k]) => k === d.statut)?.[1] ?? d.statut
  return ETAPES_PROJET.find(([k]) => k === d.statut)?.[1] ?? d.statut
}

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

const emptyPeople = (list) => (list?.length ? list : [{ prenom: '', nom: '', telephone: '' }])

const cleanPeople = (people) =>
  people
    .map((p) => ({
      prenom: (p.prenom ?? '').trim(),
      nom: (p.nom ?? '').trim(),
      telephone: (p.telephone ?? '').trim(),
    }))
    .filter((p) => p.prenom || p.nom || p.telephone)

// Postgres réordonne les clés d'un jsonb (nom, prenom, telephone) alors que le
// code les produit dans un autre ordre. JSON.stringify y étant sensible, la
// comparaison échouerait après enregistrement et la barre resterait affichée
// indéfiniment. On compare donc une signature à ordre fixe.
const signaturePeople = (people) =>
  cleanPeople(people ?? [])
    .map((p) => [p.prenom, p.nom, p.telephone].join('\u0001'))
    .join('\u0002')

export default function ClientDetail({ client, onBack, onNewDossier, onOpenDossier, onDirtyChange }) {
  const [values, setValues] = useState(() => ({ ...client }))
  const [associes, setAssocies] = useState(emptyPeople(client.associes))
  const [assistantes, setAssistantes] = useState(emptyPeople(client.assistantes))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [journal, setJournal] = useState([])
  const [dossiers, setDossiers] = useState([])
  const [suppression, setSuppression] = useState(false)
  const [toutLeJournal, setToutLeJournal] = useState(false)

  const setField = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }))

  const dirty = useMemo(() => {
    const champs = [...FIELDS.map(([k]) => k), 'notes'].some(
      (k) => (values[k] ?? '') !== (client[k] ?? '')
    )
    const gens =
      signaturePeople(associes) !== signaturePeople(client.associes) ||
      signaturePeople(assistantes) !== signaturePeople(client.assistantes)
    return champs || gens
  }, [values, associes, assistantes, client])

  useEffect(() => {
    onDirtyChange?.(dirty)
    const nomComplet = [values.prenom_praticien, values.nom_praticien].filter(Boolean).join(' ')

  const supprimer = async () => {
    setSuppression(true)
    setError(null)

    // On énumère avant de demander : « supprimer ce client » ne dit pas qu'un
    // dossier, ses notes et ses pièces jointes partent avec lui.
    const compter = async (table, colonne, valeur) =>
      (await supabase.from(table).select('id', { count: 'exact', head: true }).eq(colonne, valeur))
        .count ?? 0

    const idsDossiers = dossiers.map((d) => d.id)
    const [nbMateriel, nbFichiersClient, nbCaptures] = await Promise.all([
      compter('materiel', 'client_id', client.id),
      compter('fichiers', 'client_id', client.id),
      compter('captures', 'client_id', client.id),
    ])
    const { count: nbNotes } = idsDossiers.length
      ? await supabase
          .from('dossier_notes')
          .select('id', { count: 'exact', head: true })
          .in('dossier_id', idsDossiers)
      : { count: 0 }
    const { data: fichiersDossiers } = idsDossiers.length
      ? await supabase.from('fichiers').select('id, chemin').in('dossier_id', idsDossiers)
      : { data: [] }

    const pluriel = (n, mot, motPluriel) => `${n} ${n > 1 ? motPluriel : mot}`
    const emporte = [
      dossiers.length && pluriel(dossiers.length, 'dossier', 'dossiers'),
      nbNotes && pluriel(nbNotes, 'note de dossier', 'notes de dossier'),
      nbMateriel && pluriel(nbMateriel, 'équipement', 'équipements'),
      (nbFichiersClient + (fichiersDossiers?.length ?? 0)) &&
        pluriel(nbFichiersClient + (fichiersDossiers?.length ?? 0), 'pièce jointe', 'pièces jointes'),
    ].filter(Boolean)

    const message = emporte.length
      ? `Supprimer définitivement « ${nomComplet} » ? Cette fiche emporte ${emporte.join(', ')}. Cette action est irréversible.`
      : `Supprimer définitivement « ${nomComplet} » ? Cette action est irréversible.`

    if (!window.confirm(message)) {
      setSuppression(false)
      return
    }

    // Les rappels poussés dans Todoist ne disparaissent pas d'eux-mêmes : sans
    // ça, ils sonneraient pour un client qui n'existe plus.
    for (const d of dossiers) {
      if (d.rappel_date || d.todoist_task_id) {
        await supabase.from('dossiers').update({ rappel_date: null }).eq('id', d.id)
        await synchroniserRappel(d.id)
      }
    }

    // Le dépôt de fichiers ignore les clés étrangères : sans ce retrait, les
    // PDF resteraient stockés sans plus aucune référence pour les retrouver.
    const { data: fichiersClient } = await supabase
      .from('fichiers')
      .select('chemin')
      .eq('client_id', client.id)
    const chemins = [...(fichiersClient ?? []), ...(fichiersDossiers ?? [])]
      .map((f) => f.chemin)
      .filter(Boolean)
    if (chemins.length) await supabase.storage.from('documents').remove(chemins)

    const { error: err } = await supabase.from('clients').delete().eq('id', client.id)
    if (err) {
      setSuppression(false)
      setError(err.message)
      return
    }

    onDirtyChange?.(false)
    onBack()
  }

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

    const nomComplet = [values.prenom_praticien, values.nom_praticien].filter(Boolean).join(' ')

  const supprimer = async () => {
    setSuppression(true)
    setError(null)

    // On énumère avant de demander : « supprimer ce client » ne dit pas qu'un
    // dossier, ses notes et ses pièces jointes partent avec lui.
    const compter = async (table, colonne, valeur) =>
      (await supabase.from(table).select('id', { count: 'exact', head: true }).eq(colonne, valeur))
        .count ?? 0

    const idsDossiers = dossiers.map((d) => d.id)
    const [nbMateriel, nbFichiersClient, nbCaptures] = await Promise.all([
      compter('materiel', 'client_id', client.id),
      compter('fichiers', 'client_id', client.id),
      compter('captures', 'client_id', client.id),
    ])
    const { count: nbNotes } = idsDossiers.length
      ? await supabase
          .from('dossier_notes')
          .select('id', { count: 'exact', head: true })
          .in('dossier_id', idsDossiers)
      : { count: 0 }
    const { data: fichiersDossiers } = idsDossiers.length
      ? await supabase.from('fichiers').select('id, chemin').in('dossier_id', idsDossiers)
      : { data: [] }

    const pluriel = (n, mot, motPluriel) => `${n} ${n > 1 ? motPluriel : mot}`
    const emporte = [
      dossiers.length && pluriel(dossiers.length, 'dossier', 'dossiers'),
      nbNotes && pluriel(nbNotes, 'note de dossier', 'notes de dossier'),
      nbMateriel && pluriel(nbMateriel, 'équipement', 'équipements'),
      (nbFichiersClient + (fichiersDossiers?.length ?? 0)) &&
        pluriel(nbFichiersClient + (fichiersDossiers?.length ?? 0), 'pièce jointe', 'pièces jointes'),
    ].filter(Boolean)

    const message = emporte.length
      ? `Supprimer définitivement « ${nomComplet} » ? Cette fiche emporte ${emporte.join(', ')}. Cette action est irréversible.`
      : `Supprimer définitivement « ${nomComplet} » ? Cette action est irréversible.`

    if (!window.confirm(message)) {
      setSuppression(false)
      return
    }

    // Les rappels poussés dans Todoist ne disparaissent pas d'eux-mêmes : sans
    // ça, ils sonneraient pour un client qui n'existe plus.
    for (const d of dossiers) {
      if (d.rappel_date || d.todoist_task_id) {
        await supabase.from('dossiers').update({ rappel_date: null }).eq('id', d.id)
        await synchroniserRappel(d.id)
      }
    }

    // Le dépôt de fichiers ignore les clés étrangères : sans ce retrait, les
    // PDF resteraient stockés sans plus aucune référence pour les retrouver.
    const { data: fichiersClient } = await supabase
      .from('fichiers')
      .select('chemin')
      .eq('client_id', client.id)
    const chemins = [...(fichiersClient ?? []), ...(fichiersDossiers ?? [])]
      .map((f) => f.chemin)
      .filter(Boolean)
    if (chemins.length) await supabase.storage.from('documents').remove(chemins)

    const { error: err } = await supabase.from('clients').delete().eq('id', client.id)
    if (err) {
      setSuppression(false)
      setError(err.message)
      return
    }

    onDirtyChange?.(false)
    onBack()
  }

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

    const nomComplet = [values.prenom_praticien, values.nom_praticien].filter(Boolean).join(' ')

  const supprimer = async () => {
    setSuppression(true)
    setError(null)

    // On énumère avant de demander : « supprimer ce client » ne dit pas qu'un
    // dossier, ses notes et ses pièces jointes partent avec lui.
    const compter = async (table, colonne, valeur) =>
      (await supabase.from(table).select('id', { count: 'exact', head: true }).eq(colonne, valeur))
        .count ?? 0

    const idsDossiers = dossiers.map((d) => d.id)
    const [nbMateriel, nbFichiersClient, nbCaptures] = await Promise.all([
      compter('materiel', 'client_id', client.id),
      compter('fichiers', 'client_id', client.id),
      compter('captures', 'client_id', client.id),
    ])
    const { count: nbNotes } = idsDossiers.length
      ? await supabase
          .from('dossier_notes')
          .select('id', { count: 'exact', head: true })
          .in('dossier_id', idsDossiers)
      : { count: 0 }
    const { data: fichiersDossiers } = idsDossiers.length
      ? await supabase.from('fichiers').select('id, chemin').in('dossier_id', idsDossiers)
      : { data: [] }

    const pluriel = (n, mot, motPluriel) => `${n} ${n > 1 ? motPluriel : mot}`
    const emporte = [
      dossiers.length && pluriel(dossiers.length, 'dossier', 'dossiers'),
      nbNotes && pluriel(nbNotes, 'note de dossier', 'notes de dossier'),
      nbMateriel && pluriel(nbMateriel, 'équipement', 'équipements'),
      (nbFichiersClient + (fichiersDossiers?.length ?? 0)) &&
        pluriel(nbFichiersClient + (fichiersDossiers?.length ?? 0), 'pièce jointe', 'pièces jointes'),
    ].filter(Boolean)

    const message = emporte.length
      ? `Supprimer définitivement « ${nomComplet} » ? Cette fiche emporte ${emporte.join(', ')}. Cette action est irréversible.`
      : `Supprimer définitivement « ${nomComplet} » ? Cette action est irréversible.`

    if (!window.confirm(message)) {
      setSuppression(false)
      return
    }

    // Les rappels poussés dans Todoist ne disparaissent pas d'eux-mêmes : sans
    // ça, ils sonneraient pour un client qui n'existe plus.
    for (const d of dossiers) {
      if (d.rappel_date || d.todoist_task_id) {
        await supabase.from('dossiers').update({ rappel_date: null }).eq('id', d.id)
        await synchroniserRappel(d.id)
      }
    }

    // Le dépôt de fichiers ignore les clés étrangères : sans ce retrait, les
    // PDF resteraient stockés sans plus aucune référence pour les retrouver.
    const { data: fichiersClient } = await supabase
      .from('fichiers')
      .select('chemin')
      .eq('client_id', client.id)
    const chemins = [...(fichiersClient ?? []), ...(fichiersDossiers ?? [])]
      .map((f) => f.chemin)
      .filter(Boolean)
    if (chemins.length) await supabase.storage.from('documents').remove(chemins)

    const { error: err } = await supabase.from('clients').delete().eq('id', client.id)
    if (err) {
      setSuppression(false)
      setError(err.message)
      return
    }

    onDirtyChange?.(false)
    onBack()
  }

  return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [client.id])

  const nomComplet = [values.prenom_praticien, values.nom_praticien].filter(Boolean).join(' ')

  const supprimer = async () => {
    setSuppression(true)
    setError(null)

    // On énumère avant de demander : « supprimer ce client » ne dit pas qu'un
    // dossier, ses notes et ses pièces jointes partent avec lui.
    const compter = async (table, colonne, valeur) =>
      (await supabase.from(table).select('id', { count: 'exact', head: true }).eq(colonne, valeur))
        .count ?? 0

    const idsDossiers = dossiers.map((d) => d.id)
    const [nbMateriel, nbFichiersClient, nbCaptures] = await Promise.all([
      compter('materiel', 'client_id', client.id),
      compter('fichiers', 'client_id', client.id),
      compter('captures', 'client_id', client.id),
    ])
    const { count: nbNotes } = idsDossiers.length
      ? await supabase
          .from('dossier_notes')
          .select('id', { count: 'exact', head: true })
          .in('dossier_id', idsDossiers)
      : { count: 0 }
    const { data: fichiersDossiers } = idsDossiers.length
      ? await supabase.from('fichiers').select('id, chemin').in('dossier_id', idsDossiers)
      : { data: [] }

    const pluriel = (n, mot, motPluriel) => `${n} ${n > 1 ? motPluriel : mot}`
    const emporte = [
      dossiers.length && pluriel(dossiers.length, 'dossier', 'dossiers'),
      nbNotes && pluriel(nbNotes, 'note de dossier', 'notes de dossier'),
      nbMateriel && pluriel(nbMateriel, 'équipement', 'équipements'),
      (nbFichiersClient + (fichiersDossiers?.length ?? 0)) &&
        pluriel(nbFichiersClient + (fichiersDossiers?.length ?? 0), 'pièce jointe', 'pièces jointes'),
    ].filter(Boolean)

    const message = emporte.length
      ? `Supprimer définitivement « ${nomComplet} » ? Cette fiche emporte ${emporte.join(', ')}. Cette action est irréversible.`
      : `Supprimer définitivement « ${nomComplet} » ? Cette action est irréversible.`

    if (!window.confirm(message)) {
      setSuppression(false)
      return
    }

    // Les rappels poussés dans Todoist ne disparaissent pas d'eux-mêmes : sans
    // ça, ils sonneraient pour un client qui n'existe plus.
    for (const d of dossiers) {
      if (d.rappel_date || d.todoist_task_id) {
        await supabase.from('dossiers').update({ rappel_date: null }).eq('id', d.id)
        await synchroniserRappel(d.id)
      }
    }

    // Le dépôt de fichiers ignore les clés étrangères : sans ce retrait, les
    // PDF resteraient stockés sans plus aucune référence pour les retrouver.
    const { data: fichiersClient } = await supabase
      .from('fichiers')
      .select('chemin')
      .eq('client_id', client.id)
    const chemins = [...(fichiersClient ?? []), ...(fichiersDossiers ?? [])]
      .map((f) => f.chemin)
      .filter(Boolean)
    if (chemins.length) await supabase.storage.from('documents').remove(chemins)

    const { error: err } = await supabase.from('clients').delete().eq('id', client.id)
    if (err) {
      setSuppression(false)
      setError(err.message)
      return
    }

    onDirtyChange?.(false)
    onBack()
  }

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

        <MaterielInstalle clientId={client.id} />

        <PiecesJointes clientId={client.id} />

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
                const nomComplet = [values.prenom_praticien, values.nom_praticien].filter(Boolean).join(' ')

  const supprimer = async () => {
    setSuppression(true)
    setError(null)

    // On énumère avant de demander : « supprimer ce client » ne dit pas qu'un
    // dossier, ses notes et ses pièces jointes partent avec lui.
    const compter = async (table, colonne, valeur) =>
      (await supabase.from(table).select('id', { count: 'exact', head: true }).eq(colonne, valeur))
        .count ?? 0

    const idsDossiers = dossiers.map((d) => d.id)
    const [nbMateriel, nbFichiersClient, nbCaptures] = await Promise.all([
      compter('materiel', 'client_id', client.id),
      compter('fichiers', 'client_id', client.id),
      compter('captures', 'client_id', client.id),
    ])
    const { count: nbNotes } = idsDossiers.length
      ? await supabase
          .from('dossier_notes')
          .select('id', { count: 'exact', head: true })
          .in('dossier_id', idsDossiers)
      : { count: 0 }
    const { data: fichiersDossiers } = idsDossiers.length
      ? await supabase.from('fichiers').select('id, chemin').in('dossier_id', idsDossiers)
      : { data: [] }

    const pluriel = (n, mot, motPluriel) => `${n} ${n > 1 ? motPluriel : mot}`
    const emporte = [
      dossiers.length && pluriel(dossiers.length, 'dossier', 'dossiers'),
      nbNotes && pluriel(nbNotes, 'note de dossier', 'notes de dossier'),
      nbMateriel && pluriel(nbMateriel, 'équipement', 'équipements'),
      (nbFichiersClient + (fichiersDossiers?.length ?? 0)) &&
        pluriel(nbFichiersClient + (fichiersDossiers?.length ?? 0), 'pièce jointe', 'pièces jointes'),
    ].filter(Boolean)

    const message = emporte.length
      ? `Supprimer définitivement « ${nomComplet} » ? Cette fiche emporte ${emporte.join(', ')}. Cette action est irréversible.`
      : `Supprimer définitivement « ${nomComplet} » ? Cette action est irréversible.`

    if (!window.confirm(message)) {
      setSuppression(false)
      return
    }

    // Les rappels poussés dans Todoist ne disparaissent pas d'eux-mêmes : sans
    // ça, ils sonneraient pour un client qui n'existe plus.
    for (const d of dossiers) {
      if (d.rappel_date || d.todoist_task_id) {
        await supabase.from('dossiers').update({ rappel_date: null }).eq('id', d.id)
        await synchroniserRappel(d.id)
      }
    }

    // Le dépôt de fichiers ignore les clés étrangères : sans ce retrait, les
    // PDF resteraient stockés sans plus aucune référence pour les retrouver.
    const { data: fichiersClient } = await supabase
      .from('fichiers')
      .select('chemin')
      .eq('client_id', client.id)
    const chemins = [...(fichiersClient ?? []), ...(fichiersDossiers ?? [])]
      .map((f) => f.chemin)
      .filter(Boolean)
    if (chemins.length) await supabase.storage.from('documents').remove(chemins)

    const { error: err } = await supabase.from('clients').delete().eq('id', client.id)
    if (err) {
      setSuppression(false)
      setError(err.message)
      return
    }

    onDirtyChange?.(false)
    onBack()
  }

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
                        {d.commercial && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-carte-douce text-texte-doux">
                            {d.commercial}
                          </span>
                        )}
                        {PLAN_SANS_COMMERCIAL(d) && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-alerte/15 text-alerte">
                            Commercial ?
                          </span>
                        )}
                      </div>
                      <p className="font-medium text-texte">{d.titre || TYPE_LABELS[d.type]}</p>
                      <p className="text-sm text-texte-doux">
                        {libelleStatut(d)}
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
            <div className="flex items-baseline justify-between px-1 mb-2">
              <p className="text-xs text-texte-faible">Journal · {journal.length}</p>
              {journal.length > 2 && (
                <button
                  onClick={() => setToutLeJournal((v) => !v)}
                  className="text-accent text-xs font-medium"
                >
                  {toutLeJournal ? 'Réduire' : `Afficher les ${journal.length} entrées`}
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {(toutLeJournal ? journal : journal.slice(0, 2)).map((c) => (
                <li key={c.id} className="bg-carte rounded-xl px-4 py-3 shadow-sm">
                  <NoteTexte texte={c.resume || c.texte} />
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
        <div className="mt-8 mb-4">
          <button
            onClick={supprimer}
            disabled={suppression}
            className="w-full text-erreur text-sm font-medium py-3 disabled:opacity-50"
          >
            {suppression ? 'Suppression…' : 'Supprimer ce client'}
          </button>
        </div>
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
