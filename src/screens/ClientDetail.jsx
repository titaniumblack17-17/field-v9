import React, { useEffect, useMemo, useState } from 'react'
import { nomClient } from '../lib/client'
import { lienifier } from '../lib/texte'
import { resumeClient } from '../lib/resume'
import { supabase } from '../lib/supabaseClient'
import PersonListField from '../components/PersonListField'
import ChampChoix from '../components/ChampChoix'
import { SOURCE_OPTIONS, SOURCE_DETAIL_PLACEHOLDER } from '../constants/clients'
import MaterielInstalle from '../components/MaterielInstalle'
import PiecesJointes from '../components/PiecesJointes'
import NoteTexte from '../components/NoteTexte'
import TexteModifiable from '../components/TexteModifiable'
import ChoixClient from '../components/ChoixClient'
import Rubrique from '../components/Rubrique'
import useConfirm from '../hooks/useConfirm'
import { SuggestionSav, SuggestionProjet, SuggestionPlan } from '../components/SuggestionCapture'
import { creerDossierDepuisSuggestion, ignorerSuggestion } from '../lib/suggestions'
import { retirerRappelsTodoist, etatRappel } from '../lib/rappel'
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
  const [captureEnEdition, setCaptureEnEdition] = useState(null)
  const [infosAnnexes, setInfosAnnexes] = useState([])
  const [ajoutInfoOuvert, setAjoutInfoOuvert] = useState(false)
  const [nouvelleInfo, setNouvelleInfo] = useState('')
  const [envoiInfo, setEnvoiInfo] = useState(false)
  const [infoEnEdition, setInfoEnEdition] = useState(null)
  const [confirmer, boîteConfirmation] = useConfirm()

  const ajouterInfo = async () => {
    if (!nouvelleInfo.trim()) return
    setEnvoiInfo(true)
    await supabase.from('client_notes').insert({ client_id: client.id, texte: nouvelleInfo.trim() })
    setNouvelleInfo('')
    setAjoutInfoOuvert(false)
    setEnvoiInfo(false)
  }

  const supprimerInfo = async (info) => {
    const extrait = info.texte.length > 60 ? info.texte.slice(0, 60) + '…' : info.texte
    if (!(await confirmer(`« ${extrait} »`, { titre: 'Supprimer cette entrée ?', confirmLabel: 'Supprimer' })))
      return
    await supabase.from('client_notes').delete().eq('id', info.id)
    setInfosAnnexes((cur) => cur.filter((i) => i.id !== info.id))
  }
  const [dicteeVisible, setDicteeVisible] = useState(null)
  const [aFusionner, setAFusionner] = useState(false)
  const [fusion, setFusion] = useState(false)
  const [creationSav, setCreationSav] = useState(null)
  const [creationProjet, setCreationProjet] = useState(null)
  const [creationPlan, setCreationPlan] = useState(null)
  // Choix du dossier cible quand il y en a plusieurs sur la fiche ; copie
  // directe s'il n'y en a qu'un — pas de sélection pour rien.
  const [captureACopier, setCaptureACopier] = useState(null)
  const [copieFaite, setCopieFaite] = useState(null)
  const [resumeCopie, setResumeCopie] = useState(false)

  // Partager une fiche avec un collègue aujourd'hui, faute de compte partagé
  // dans Field V9, ça passe par un texte propre à coller dans un SMS/mail.
  const copierResume = async () => {
    await navigator.clipboard.writeText(resumeClient(client, dossiers))
    setResumeCopie(true)
    setTimeout(() => setResumeCopie(false), 3000)
  }

  // Une transcription complète (Plaud, réunion) ne rentre jamais dans le
  // résumé d'une phrase de la capture — le texte intégral part tel quel dans
  // les notes du dossier, sans repasser par l'IA, pour ne rien perdre.
  const copierDansDossier = async (capture, dossier) => {
    await supabase
      .from('dossier_notes')
      .insert({ dossier_id: dossier.id, texte: capture.texte })
    setCaptureACopier(null)
    setCopieFaite({ captureId: capture.id, titre: dossier.titre || TYPE_LABELS[dossier.type] })
    setTimeout(() => setCopieFaite((v) => (v?.captureId === capture.id ? null : v)), 4000)
  }

  const supprimerCapture = async (capture) => {
    const extrait = (capture.resume || capture.texte || '').slice(0, 60)
    if (
      !(await confirmer(`« ${extrait}… »`, {
        titre: 'Supprimer cette entrée du journal ?',
        confirmLabel: 'Supprimer',
      }))
    )
      return
    await supabase.from('captures').delete().eq('id', capture.id)
    setJournal((cur) => cur.filter((c) => c.id !== capture.id))
  }

  // Une suggestion (SAV ou projet) ne s'affichait qu'une fois, juste après
  // l'envoi de la dictée : en quittant l'écran, elle disparaissait sans que
  // le dossier ne soit jamais créé. Le journal de la fiche client est
  // permanent, donc les suggestions en attente y restent visibles.
  const creerSav = async (capture) => {
    setCreationSav(capture.id)
    const dossier = await creerDossierDepuisSuggestion(capture, 'sav')
    setCreationSav(null)
    return dossier
  }
  const ignorerSav = async (capture) => {
    setJournal((cur) => cur.map((c) => (c.id === capture.id ? { ...c, sav_suggere: false } : c)))
    await ignorerSuggestion(capture, 'sav')
  }
  const creerProjet = async (capture) => {
    setCreationProjet(capture.id)
    const dossier = await creerDossierDepuisSuggestion(capture, 'projet')
    setCreationProjet(null)
    return dossier
  }
  const ignorerProjet = async (capture) => {
    setJournal((cur) => cur.map((c) => (c.id === capture.id ? { ...c, projet_suggere: false } : c)))
    await ignorerSuggestion(capture, 'projet')
  }
  const creerPlan = async (capture) => {
    setCreationPlan(capture.id)
    const dossier = await creerDossierDepuisSuggestion(capture, 'plan')
    setCreationPlan(null)
    return dossier
  }
  const ignorerPlan = async (capture) => {
    setJournal((cur) => cur.map((c) => (c.id === capture.id ? { ...c, plan_suggere: false } : c)))
    await ignorerSuggestion(capture, 'plan')
  }

  const setField = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }))

  // Une suggestion en attente ne doit jamais rester cachée derrière le
  // « Afficher toutes les entrées » : sinon on retombe dans le trou qu'on
  // vient de combler.
  const enAttenteSuggestion = (c) =>
    (c.sav_suggere && !c.sav_dossier_id) ||
    (c.projet_suggere && !c.projet_dossier_id) ||
    (c.plan_suggere && !c.plan_dossier_id)

  const journalVisible = useMemo(() => {
    if (toutLeJournal) return journal
    const ids = new Set()
    const visibles = []
    for (const c of journal) {
      if (visibles.length < 2 || enAttenteSuggestion(c)) {
        if (!ids.has(c.id)) {
          ids.add(c.id)
          visibles.push(c)
        }
      }
    }
    return visibles
  }, [journal, toutLeJournal])

  const dirty = useMemo(() => {
    // « notes » n'est plus édité ici : c'est désormais une liste d'entrées
    // horodatées (client_notes), pas un champ du formulaire.
    const champs = [...FIELDS.map(([k]) => k), 'source_type', 'source_detail'].some(
      (k) => (values[k] ?? '') !== (client[k] ?? '')
    )
    const gens =
      signaturePeople(associes) !== signaturePeople(client.associes) ||
      signaturePeople(assistantes) !== signaturePeople(client.assistantes)
    return champs || gens
  }, [values, associes, assistantes, client])

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  const save = async () => {
    // Un centre (CHSF, SCM, mutuelle...) n'a pas de praticien nommé : le nom
    // du cabinet suffit à identifier la fiche. Il faut au moins l'un des deux.
    if (!values.nom_praticien?.trim() && !values.nom_cabinet?.trim()) {
      setError('Le nom du praticien ou le nom du cabinet est obligatoire.')
      return
    }
    setSaving(true)
    setError(null)

    const update = Object.fromEntries(
      FIELDS.map(([k]) => [k, (values[k] ?? '').trim() || null])
    )
    update.associes = cleanPeople(associes)
    update.assistantes = cleanPeople(assistantes)
    update.source_type = values.source_type || null
    update.source_detail = (values.source_detail ?? '').trim() || null

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
    let actif = true

    supabase
      .from('client_notes')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (actif) setInfosAnnexes(data ?? [])
      })

    const canal = supabase
      .channel(`client-notes-${client.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_notes', filter: `client_id=eq.${client.id}` },
        (payload) => {
          setInfosAnnexes((cur) => {
            if (payload.eventType === 'INSERT') {
              return cur.some((i) => i.id === payload.new.id) ? cur : [payload.new, ...cur]
            }
            if (payload.eventType === 'UPDATE') {
              return cur.map((i) => (i.id === payload.new.id ? payload.new : i))
            }
            if (payload.eventType === 'DELETE') {
              return cur.filter((i) => i.id !== payload.old.id)
            }
            return cur
          })
        }
      )
      .subscribe()

    return () => {
      actif = false
      supabase.removeChannel(canal)
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

  const nomComplet = nomClient(values) ?? 'Client'

  const supprimer = async () => {
    setSuppression(true)
    setError(null)

    // On relit les dossiers plutôt que de croire l'état local : la liste peut
    // ne pas être encore chargée, ou un dossier avoir été créé sur l'iPhone
    // sans que le temps réel soit arrivé. Se tromper ici, c'est annoncer une
    // suppression incomplète et laisser des rappels sonner pour un client
    // disparu.
    const { data: dossiersBase } = await supabase
      .from('dossiers')
      .select('id')
      .eq('client_id', client.id)
    const dossiersReels = dossiersBase ?? []
    const ids = dossiersReels.map((d) => d.id)

    const compter = async (table, colonne, valeur) =>
      (await supabase.from(table).select('id', { count: 'exact', head: true }).eq(colonne, valeur))
        .count ?? 0

    // Les captures ne sont pas comptées : la contrainte les délie au lieu de
    // les supprimer, la dictée brute survit à la fiche.
    const [nbMateriel, nbFichiersClient] = await Promise.all([
      compter('materiel', 'client_id', client.id),
      compter('fichiers', 'client_id', client.id),
    ])
    const { count: nbNotes } = ids.length
      ? await supabase
          .from('dossier_notes')
          .select('id', { count: 'exact', head: true })
          .in('dossier_id', ids)
      : { count: 0 }
    const { data: fichiersDossiers } = ids.length
      ? await supabase.from('fichiers').select('chemin').in('dossier_id', ids)
      : { data: [] }

    // On énumère avant de demander : « supprimer ce client » ne dit pas qu'un
    // dossier, ses notes et ses pièces jointes partent avec lui.
    const pluriel = (n, mot, pluriels) => `${n} ${n > 1 ? pluriels : mot}`
    const nbPieces = nbFichiersClient + (fichiersDossiers?.length ?? 0)
    const emporte = [
      dossiersReels.length && pluriel(dossiersReels.length, 'dossier', 'dossiers'),
      nbNotes && pluriel(nbNotes, 'note de dossier', 'notes de dossier'),
      nbMateriel && pluriel(nbMateriel, 'équipement', 'équipements'),
      nbPieces && pluriel(nbPieces, 'pièce jointe', 'pièces jointes'),
    ].filter(Boolean)

    const message = emporte.length
      ? `« ${nomComplet} » sera emportée avec ${emporte.join(', ')}. Cette action est irréversible.`
      : `« ${nomComplet} » sera supprimée. Cette action est irréversible.`

    if (
      !(await confirmer(message, {
        titre: 'Supprimer définitivement ce client ?',
        confirmLabel: 'Supprimer',
      }))
    ) {
      setSuppression(false)
      return
    }

    // Les rappels poussés dans Todoist ne disparaissent pas d'eux-mêmes : sans
    // ça, ils sonneraient pour un client qui n'existe plus.
    await retirerRappelsTodoist(ids)

    // On relève les chemins avant la suppression — après, plus rien ne permet
    // de les retrouver.
    const { data: fichiersClient } = await supabase
      .from('fichiers')
      .select('chemin')
      .eq('client_id', client.id)
    const chemins = [...(fichiersClient ?? []), ...(fichiersDossiers ?? [])]
      .map((f) => f.chemin)
      .filter(Boolean)

    const { error: err } = await supabase.from('clients').delete().eq('id', client.id)
    if (err) {
      setSuppression(false)
      setError(err.message)
      return
    }

    // Le dépôt ignore les clés étrangères : sans ce retrait, les PDF
    // resteraient stockés sans plus aucune référence. Après la base et non
    // avant : un échec de suppression ne doit pas emporter les fichiers d'un
    // client qui existe toujours.
    if (chemins.length) await supabase.storage.from('documents').remove(chemins)

    onDirtyChange?.(false)
    onBack()
  }

  // Fusionner deux fiches d'un même praticien : tout ce qui pointait vers
  // celle-ci (dossiers, matériel, pièces jointes, journal) est rebasculé sur
  // la fiche choisie, puis celle-ci disparaît. Le choix de la cible et la
  // confirmation restent manuels, cas par cas — jamais de fusion automatique.
  const fusionner = async (cible) => {
    setAFusionner(false)
    setFusion(true)
    setError(null)

    const { data: cibleComplete } = await supabase
      .from('clients')
      .select('*')
      .eq('id', cible.id)
      .single()

    const { data: dossiersReels } = await supabase
      .from('dossiers')
      .select('id')
      .eq('client_id', client.id)
    const compter = async (table) =>
      (await supabase.from(table).select('id', { count: 'exact', head: true }).eq('client_id', client.id))
        .count ?? 0
    const [nbMateriel, nbFichiers, nbCaptures, nbInfos] = await Promise.all([
      compter('materiel'),
      compter('fichiers'),
      compter('captures'),
      compter('client_notes'),
    ])

    const nomCible = nomClient(cibleComplete) ?? 'Client'
    const pluriel = (n, mot, pluriels) => `${n} ${n > 1 ? pluriels : mot}`
    const emporte = [
      dossiersReels?.length && pluriel(dossiersReels.length, 'dossier', 'dossiers'),
      nbMateriel && pluriel(nbMateriel, 'équipement', 'équipements'),
      nbFichiers && pluriel(nbFichiers, 'pièce jointe', 'pièces jointes'),
      nbCaptures && pluriel(nbCaptures, 'entrée de journal', 'entrées de journal'),
      nbInfos && pluriel(nbInfos, 'information annexe', 'informations annexes'),
    ].filter(Boolean)

    const message = `${
      emporte.length ? `${emporte.join(', ')} seront transférés vers « ${nomCible} ». ` : ''
    }« ${nomComplet} » sera ensuite supprimée. Cette action est irréversible.`

    if (
      !(await confirmer(message, {
        titre: `Fusionner « ${nomComplet} » dans « ${nomCible} » ?`,
        confirmLabel: 'Fusionner',
      }))
    ) {
      setFusion(false)
      return
    }

    await Promise.all([
      supabase.from('dossiers').update({ client_id: cible.id }).eq('client_id', client.id),
      supabase.from('materiel').update({ client_id: cible.id }).eq('client_id', client.id),
      supabase.from('fichiers').update({ client_id: cible.id }).eq('client_id', client.id),
      supabase.from('captures').update({ client_id: cible.id }).eq('client_id', client.id),
      // Les informations annexes suivent le même chemin que le reste :
      // transférées, pas concaténées dans un blob.
      supabase.from('client_notes').update({ client_id: cible.id }).eq('client_id', client.id),
    ])

    await supabase
      .from('clients')
      .update({
        associes: cleanPeople([...(cibleComplete?.associes ?? []), ...associes]),
        assistantes: cleanPeople([...(cibleComplete?.assistantes ?? []), ...assistantes]),
      })
      .eq('id', cible.id)

    const { error: err } = await supabase.from('clients').delete().eq('id', client.id)
    if (err) {
      setFusion(false)
      setError(err.message)
      return
    }

    onDirtyChange?.(false)
    onBack()
  }

  return (
    <div className="min-h-screen bg-fond">
      {/* Le nom doit rester visible en permanence : c'est en descendant vers
          Pièces jointes, sans lui sous les yeux, qu'un fichier a fini sur la
          mauvaise fiche. « ← Clients » seul seule ne le dit pas. */}
      <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-2 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-accent text-sm font-medium h-11 -ml-2 pl-2 pr-1 flex items-center flex-shrink-0"
        >
          ← Clients
        </button>
        <p className="text-texte font-semibold truncate">
          {nomClient(values) ?? 'Client'}
        </p>
      </header>

      <main className={`px-4 pt-2 ${dirty ? 'pb-28' : 'pb-8'}`}>
        <div className="flex items-center justify-between gap-2 mb-4">
          <h1 className="text-2xl font-semibold text-texte">
            {nomClient(client) ?? 'Client'}
          </h1>
          <button
            onClick={copierResume}
            className="text-accent text-sm font-medium flex-shrink-0 h-11 px-2 -mr-2"
          >
            {resumeCopie ? '✓ Copié' : 'Copier le résumé'}
          </button>
        </div>

        <div className="bg-carte rounded-xl shadow-sm divide-y divide-separateur">
          {FIELDS.map(([key, label]) => (
            <div key={key} className="px-4 py-3">
              <label className="text-xs text-texte-faible" htmlFor={key}>
                {label}
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
                placeholder="—"
                className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
              />
            </div>
          )}
        </div>

        {error && <p className="text-erreur text-sm mt-3">{error}</p>}

        <MaterielInstalle clientId={client.id} />

        <PiecesJointes clientId={client.id} />

        <Rubrique
          titre="Dossiers"
          compte={dossiers.length}
          defautOuvert
          action={
            <button onClick={() => onNewDossier(client)} className="text-accent text-sm font-medium h-11 px-2 -mr-2 inline-flex items-center">
              + Nouveau dossier
            </button>
          }
        >
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
                      {/* Les rappels vivent sur le dossier, jamais remontés
                          jusqu'ici : rien sur la fiche client ne disait qu'un
                          de ses dossiers en portait un. La donnée était déjà
                          chargée (select('*')), il manquait juste l'affichage. */}
                      {(() => {
                        const r = etatRappel(d.rappel_date, d.rappel_heure)
                        if (!r) return null
                        return (
                          <p className={`text-xs mt-1 ${r.classe}`}>
                            ⏰ {r.texte}
                            {d.rappel_note ? ` · ${d.rappel_note}` : ''}
                          </p>
                        )
                      })()}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Rubrique>

        <Rubrique
          titre="Informations annexes"
          compte={infosAnnexes.length}
          forceOuvert={ajoutInfoOuvert}
          action={
            <button
              onClick={() => setAjoutInfoOuvert((v) => !v)}
              className="text-accent text-sm font-medium h-11 px-2 -mr-2 inline-flex items-center"
            >
              {ajoutInfoOuvert ? 'Fermer' : '+ Ajouter'}
            </button>
          }
        >
          {ajoutInfoOuvert && (
            <div className="bg-carte rounded-xl shadow-sm p-3 mb-2">
              <textarea
                value={nouvelleInfo}
                onChange={(e) => setNouvelleInfo(e.target.value)}
                rows={4}
                placeholder="Mail, SMS, ou toute autre info à coller…"
                className="w-full text-texte outline-none bg-transparent resize-none placeholder:text-texte-fantome"
              />
              <button
                onClick={ajouterInfo}
                disabled={envoiInfo || !nouvelleInfo.trim()}
                className="w-full mt-2 bg-accent text-white font-medium rounded-xl py-3 shadow disabled:opacity-50"
              >
                {envoiInfo ? 'Enregistrement…' : 'Ajouter'}
              </button>
            </div>
          )}

          {infosAnnexes.length === 0 && !ajoutInfoOuvert && (
            <p className="text-texte-faible text-sm px-1">Aucune information annexe.</p>
          )}

          <ul className="space-y-2">
            {infosAnnexes.map((info) => (
              <li key={info.id} className="bg-carte rounded-xl px-4 py-3 shadow-sm">
                {infoEnEdition === info.id ? (
                  <TexteModifiable
                    valeur={info.texte}
                    multiligne
                    ouvertParDefaut
                    className="text-texte text-sm"
                    onFermer={() => setInfoEnEdition(null)}
                    onEnregistrer={async (v) => {
                      if (v) await supabase.from('client_notes').update({ texte: v }).eq('id', info.id)
                    }}
                  />
                ) : (
                  <NoteTexte texte={info.texte} />
                )}
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-xs text-texte-faible flex-1">
                    {new Date(info.created_at).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {infoEnEdition !== info.id && (
                    <button
                      onClick={() => setInfoEnEdition(info.id)}
                      className="text-accent text-xs font-medium h-9 px-1"
                    >
                      Modifier
                    </button>
                  )}
                  <button
                    onClick={() => supprimerInfo(info)}
                    className="text-texte-fantome text-xs h-9 px-1"
                  >
                    Supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Rubrique>

        {journal.length > 0 && (
          <Rubrique
            titre="Journal"
            compte={journal.length}
            forceOuvert={journal.some(enAttenteSuggestion)}
            action={
              journal.length > 2 && (
                <button
                  onClick={() => setToutLeJournal((v) => !v)}
                  className="text-accent text-xs font-medium h-9 px-2 -mr-2 flex items-center"
                >
                  {toutLeJournal ? 'Réduire' : `Afficher les ${journal.length} entrées`}
                </button>
              )
            }
          >
            <ul className="space-y-2">
              {journalVisible.map((c) => (
                <li key={c.id} className="bg-carte rounded-xl px-4 py-3 shadow-sm">
                  {captureEnEdition === c.id ? (
                    <TexteModifiable
                      valeur={c.resume || c.texte}
                      multiligne
                      ouvertParDefaut
                      className="text-texte text-sm"
                      onFermer={() => setCaptureEnEdition(null)}
                      onEnregistrer={async (v) => {
                        if (v) await supabase.from('captures').update({ resume: v }).eq('id', c.id)
                      }}
                    />
                  ) : (
                    <NoteTexte texte={c.resume || c.texte} />
                  )}

                  {/* La dictée brute est la trace de ce qui a été dit sur le
                      terrain : consultable, jamais corrigée. Quand le résumé
                      se trompe, elle dit pourquoi. */}
                  {dicteeVisible === c.id && c.texte && c.texte !== c.resume && (
                    <p className="text-xs text-texte-faible mt-2 pl-2 border-l-2 border-separateur italic">
                      {lienifier(c.texte)}
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-xs text-texte-faible flex-1">
                      {new Date(c.created_at).toLocaleDateString('fr-FR')}
                      {c.date_evenement ? ` · échéance ${c.date_evenement}` : ''}
                    </p>
                    {c.texte && c.texte !== c.resume && (
                      <button
                        onClick={() => setDicteeVisible((v) => (v === c.id ? null : c.id))}
                        className="text-texte-fantome text-xs h-9 px-1"
                      >
                        {dicteeVisible === c.id ? 'Masquer' : 'Dictée'}
                      </button>
                    )}
                    {captureEnEdition !== c.id && (
                      <button
                        onClick={() => setCaptureEnEdition(c.id)}
                        className="text-accent text-xs font-medium h-9 px-1"
                      >
                        Modifier
                      </button>
                    )}
                    {c.texte && dossiers.length > 0 && (
                      <button
                        onClick={() =>
                          dossiers.length === 1
                            ? copierDansDossier(c, dossiers[0])
                            : setCaptureACopier(c)
                        }
                        className="text-accent text-xs font-medium h-9 px-1"
                      >
                        → Dossier
                      </button>
                    )}
                    <button
                      onClick={() => supprimerCapture(c)}
                      className="text-texte-fantome text-xs h-9 px-1"
                    >
                      Supprimer
                    </button>
                  </div>

                  {copieFaite?.captureId === c.id && (
                    <p className="text-xs text-accent mt-1">
                      ✓ Copié dans « {copieFaite.titre} »
                    </p>
                  )}

                  {c.info_manquante && (
                    <p className="text-xs text-alerte mt-1">⚠ {c.info_manquante}</p>
                  )}
                  <SuggestionSav
                    capture={c}
                    enCours={creationSav === c.id}
                    onCreer={creerSav}
                    onIgnorer={ignorerSav}
                    onOuvrir={onOpenDossier}
                  />
                  <SuggestionProjet
                    capture={c}
                    enCours={creationProjet === c.id}
                    onCreer={creerProjet}
                    onIgnorer={ignorerProjet}
                    onOuvrir={onOpenDossier}
                  />
                  <SuggestionPlan
                    capture={c}
                    enCours={creationPlan === c.id}
                    onCreer={creerPlan}
                    onIgnorer={ignorerPlan}
                    onOuvrir={onOpenDossier}
                  />
                </li>
              ))}
            </ul>
          </Rubrique>
        )}
        {/* Discret et en fin de fiche : une suppression ne doit pas se cliquer
            par réflexe en descendant la page. */}
        <div className="mt-8 pt-4 border-t border-separateur space-y-1">
          {/* Répété ici, pas seulement en haut de fiche : un échec de fusion ou
              de suppression doit se voir depuis le bouton qu'on vient de
              presser, pas seulement en remontant toute la page. */}
          {error && <p className="text-erreur text-sm pb-2">{error}</p>}
          <button
            onClick={() => setAFusionner(true)}
            disabled={fusion}
            className="w-full text-accent text-sm font-medium py-3 disabled:opacity-50"
          >
            {fusion ? 'Fusion…' : 'Fusionner avec une autre fiche'}
          </button>
          <button
            onClick={supprimer}
            disabled={suppression}
            className="w-full text-erreur text-sm font-medium py-3 disabled:opacity-50"
          >
            {suppression ? 'Suppression…' : 'Supprimer ce client'}
          </button>
        </div>
      </main>

      {aFusionner && (
        <ChoixClient
          titre="Fusionner avec…"
          excludeId={client.id}
          onChoisir={fusionner}
          onFermer={() => setAFusionner(false)}
        />
      )}

      {captureACopier && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end"
          onClick={() => setCaptureACopier(null)}
        >
          <div
            className="bg-carte w-full rounded-t-2xl p-4 max-h-[75vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-texte mb-3">Copier dans quel dossier ?</p>
            <div className="flex flex-col gap-2">
              {dossiers.map((d) => (
                <button
                  key={d.id}
                  onClick={() => copierDansDossier(captureACopier, d)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-bordure text-left text-sm text-texte-doux"
                >
                  {d.titre || TYPE_LABELS[d.type]}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCaptureACopier(null)}
              className="w-full mt-3 py-3 rounded-xl bg-carte-douce text-texte-doux text-sm font-medium"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

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

      {boîteConfirmation}
    </div>
  )
}
