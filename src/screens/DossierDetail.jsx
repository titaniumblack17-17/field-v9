import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ChampChoix from '../components/ChampChoix'
import PiecesJointes from '../components/PiecesJointes'
import NoteTexte from '../components/NoteTexte'
import { synchroniserRappel } from '../lib/todoist'
import {
  TYPE_LABELS,
  TYPE_OPTIONS,
  STATUT_PAR_DEFAUT,
  ETAPES_PROJET,
  STATUTS_SAV,
  STATUTS_PLAN,
  COMMERCIAL_OPTIONS,
  COMMERCIAUX_LABELS,
  PLAN_SANS_COMMERCIAL,
  REMUNERATION_OPTIONS,
  PLAN_STATUT_OPTIONS,
  styleDossier,
} from '../constants/dossiers'

// Deux notes suffisent à montrer que le journal vit ; le reste se déplie.
const APERCU_NOTES = 2

const CHAMPS = [
  'type',
  'plan_statut',
  'titre',
  'statut',
  'montant_estime',
  'date_installation',
  'rappel_date',
  'rappel_note',
  'remuneration_type',
  'commercial',
  'bloque_par',
]

export default function DossierDetail({ dossier, onBack, onDirtyChange }) {
  const [values, setValues] = useState(() => ({ ...dossier }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [suppression, setSuppression] = useState(false)
  // Compte rendu du dernier envoi vers Todoist : { etat } ou { erreur }.
  const [todoist, setTodoist] = useState(null)
  // Le journal complet est replié : on veut voir qu'il existe, pas le lire
  // en entier chaque fois qu'on ouvre le dossier.
  const [toutesNotes, setToutesNotes] = useState(false)

  const s = styleDossier(values)

  const supprimer = async () => {
    const quoi = [
      `« ${values.titre || TYPE_LABELS[values.type]} »`,
      notes.length ? `et ses ${notes.length} note${notes.length > 1 ? 's' : ''}` : null,
    ]
      .filter(Boolean)
      .join(' ')
    if (!window.confirm(`Supprimer définitivement ${quoi} ? Cette action est irréversible.`)) return

    setSuppression(true)

    // Une fois le dossier parti, plus rien ne relie la tâche Todoist à quoi que
    // ce soit : elle sonnerait pour un dossier introuvable. On efface donc le
    // rappel d'abord, ce qui fait supprimer la tâche par la fonction, avant de
    // supprimer le dossier lui-même.
    if (dossier.rappel_date || dossier.todoist_task_id) {
      await supabase.from('dossiers').update({ rappel_date: null }).eq('id', dossier.id)
      await synchroniserRappel(dossier.id)
    }

    // La cascade efface les lignes « fichiers », pas les objets du dépôt : sans
    // ce relevé, chaque dossier supprimé abandonne ses PDF, invisibles et
    // impossibles à retrouver.
    const { data: joints } = await supabase
      .from('fichiers')
      .select('chemin')
      .eq('dossier_id', dossier.id)

    const { error: err } = await supabase.from('dossiers').delete().eq('id', dossier.id)
    if (err) {
      setSuppression(false)
      setError(err.message)
      return
    }

    const chemins = (joints ?? []).map((f) => f.chemin).filter(Boolean)
    if (chemins.length) await supabase.storage.from('documents').remove(chemins)
    // Le garde-fou des modifications non enregistrées n'a plus lieu d'être :
    // le dossier n'existe plus.
    onDirtyChange?.(false)
    onBack()
  }

  // Le montant est recalculé en base à chaque devis lu ou requalifié. On le
  // relit dans la fiche ET dans la référence d'origine : sinon l'écart entre
  // les deux ferait croire à une modification non enregistrée.
  const relireMontant = async () => {
    const { data } = await supabase
      .from('dossiers')
      .select('montant_estime')
      .eq('id', dossier.id)
      .single()
    if (!data) return
    dossier.montant_estime = data.montant_estime
    setValues((v) => ({ ...v, montant_estime: data.montant_estime }))
  }

  const setField = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }))

  // Changer de type invalide le statut courant, exprimé dans le vocabulaire de
  // l'ancien type. On le réinitialise, et on abandonne les champs propres au
  // type quitté — en prévenant quand ils portaient une information.
  const changerType = (nouveau) => {
    if (nouveau === values.type) return
    if (
      values.type === 'plan' &&
      values.remuneration_type &&
      !window.confirm(
        `Ce dossier devient « ${TYPE_LABELS[nouveau]} ». Sa rémunération (${
          REMUNERATION_OPTIONS.find(([v]) => v === values.remuneration_type)?.[1]
        }) sera effacée. Continuer ?`
      )
    ) {
      return
    }
    setValues((v) => ({
      ...v,
      type: nouveau,
      statut: STATUT_PAR_DEFAUT[nouveau],
      remuneration_type: nouveau === 'plan' ? v.remuneration_type : null,
      commercial: nouveau === 'plan' ? v.commercial : null,
      plan_statut: nouveau === 'projet' ? v.plan_statut : null,
    }))
  }

  // Un input number renvoie une chaîne : on compare en chaîne pour ne pas
  // signaler une modification quand la valeur retapée est identique.
  const dirty = useMemo(
    () => CHAMPS.some((k) => String(values[k] ?? '') !== String(dossier[k] ?? '')),
    [values, dossier]
  )

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

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
      type: values.type,
      // Le plan intégré n'a de sens que sur une vente.
      plan_statut: values.type === 'projet' ? values.plan_statut || null : null,
      remuneration_type: values.type === 'plan' ? values.remuneration_type || null : null,
      // Un projet ou un SAV n'est fait pour personne d'autre que Bruce.
      commercial: values.type === 'plan' ? values.commercial || null : null,
      // Ce qui bloque n'a de sens que sur un SAV en attente.
      bloque_par:
        values.type === 'sav' && values.statut === 'en_attente'
          ? (values.bloque_par ?? '').trim() || null
          : null,
      // Un dossier qui n'est plus un SAV n'a plus de projet d'origine.
      projet_source_id: values.type === 'sav' ? dossier.projet_source_id ?? null : null,
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

    // Le rappel a pu naître, changer de date ou disparaître : on réaligne la
    // tâche Todoist. Après l'enregistrement, jamais avant — Todoist ne doit
    // pas annoncer un rappel que la base n'a pas accepté.
    const rappel = await synchroniserRappel(dossier.id)
    setTodoist(rappel)
    if (!rappel?.erreur) dossier.todoist_task_id = rappel?.taskId ?? null
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
    <div className="min-h-screen bg-fond">
      <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="text-accent text-sm font-medium h-11 -ml-2 pl-2 pr-1 flex items-center">
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
          {values.commercial && (
            <span
              title={COMMERCIAUX_LABELS[values.commercial] ?? values.commercial}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-carte-douce text-texte-doux"
            >
              {values.commercial}
            </span>
          )}
          {PLAN_SANS_COMMERCIAL(values) && (
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-alerte/15 text-alerte">
              Commercial ?
            </span>
          )}
          {TYPE_LABELS[values.type] !== s.badge && (
            <span className="text-xs text-texte-faible">{TYPE_LABELS[values.type]}</span>
          )}
        </div>

        <h1 className="text-2xl font-semibold text-texte mb-4">
          {values.titre || TYPE_LABELS[values.type]}
        </h1>

        <div
          style={{ borderColor: s.bordure }}
          className="bg-carte rounded-xl shadow-sm border-2 overflow-hidden"
        >
          <div style={{ background: s.bordure }} className="h-2.5" />
          <div className="divide-y divide-separateur">
          <ChampChoix
            id="type"
            label="Type de dossier"
            value={values.type}
            options={TYPE_OPTIONS}
            onChange={changerType}
          />
          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="titre">
              Titre
            </label>
            <input
              id="titre"
              value={values.titre ?? ''}
              onChange={setField('titre')}
              placeholder="—"
              className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
            />
          </div>

          {values.type === 'projet' && (
            <ChampChoix
              id="statut"
              label="Étape"
              value={values.statut ?? ''}
              options={ETAPES_PROJET}
              onChange={(v) => setValues((x) => ({ ...x, statut: v }))}
            />
          )}

          {/* Plan intégré à la vente (spec §4.2, cas 2) : une tâche du projet,
              pas un dossier séparé — donc pas de rémunération associée. */}
          {values.type === 'projet' && (
            <ChampChoix
              id="plan_statut"
              label="Plan d'implantation"
              value={values.plan_statut ?? ''}
              options={PLAN_STATUT_OPTIONS}
              videLibelle="Aucun plan à faire"
              onChange={(v) => setValues((x) => ({ ...x, plan_statut: v || null }))}
            />
          )}

          {values.type === 'sav' && (
            <>
              <ChampChoix
                id="statut"
                label="Statut"
                value={values.statut ?? ''}
                options={STATUTS_SAV}
                onChange={(v) => setValues((x) => ({ ...x, statut: v }))}
              />
              {values.statut === 'en_attente' && (
                <div className="px-4 py-3">
                  <label className="text-xs text-texte-faible" htmlFor="bloque_par">
                    En attente de quoi
                  </label>
                  <input
                    id="bloque_par"
                    value={values.bloque_par ?? ''}
                    onChange={setField('bloque_par')}
                    placeholder="Pièce, devis fournisseur, décision du praticien…"
                    className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
                  />
                </div>
              )}
            </>
          )}

          {values.type === 'plan' && (
            <div>
              <ChampChoix
                id="statut"
                label="Étape"
                value={values.statut ?? ''}
                options={STATUTS_PLAN}
                onChange={(v) => setValues((x) => ({ ...x, statut: v }))}
              />
              <ChampChoix
                id="commercial"
                label="Commercial"
                value={values.commercial ?? ''}
                options={COMMERCIAL_OPTIONS}
                videLibelle="À préciser"
                onChange={(v) => setValues((x) => ({ ...x, commercial: v || null }))}
              />
              <ChampChoix
                id="remuneration"
                label="Rémunération"
                value={values.remuneration_type ?? ''}
                options={REMUNERATION_OPTIONS}
                videLibelle="À préciser"
                onChange={(v) => setValues((x) => ({ ...x, remuneration_type: v }))}
              />
              {values.remuneration_type === 'partage' && (
                <p className="text-xs text-alerte px-4 pb-3 -mt-2">
                  ⚠ Information visible par vous seul, jamais par le collègue concerné
                </p>
              )}
            </div>
          )}

          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="montant">
              Montant estimé (€)
            </label>
            <input
              id="montant"
              type="number"
              value={values.montant_estime ?? ''}
              onChange={setField('montant_estime')}
              placeholder="—"
              className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
            />
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="date_installation">
              Date d'installation (approximative)
            </label>
            <input
              id="date_installation"
              type="date"
              value={values.date_installation ?? ''}
              onChange={setField('date_installation')}
              className="w-full text-texte outline-none bg-transparent"
            />
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="rappel_date">
              Date de rappel
            </label>
            <input
              id="rappel_date"
              type="date"
              value={values.rappel_date ?? ''}
              onChange={setField('rappel_date')}
              className="w-full text-texte outline-none bg-transparent"
            />
          </div>

          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="rappel_note">
              Note de rappel
            </label>
            <input
              id="rappel_note"
              value={values.rappel_note ?? ''}
              onChange={setField('rappel_note')}
              placeholder="—"
              className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
            />
            {todoist && (
              <p className={`text-xs mt-1 ${todoist.erreur ? 'text-erreur' : 'text-texte-faible'}`}>
                {todoist.erreur
                  ? `Todoist : ${todoist.erreur}`
                  : todoist.etat === 'supprime'
                    ? 'Rappel retiré de Todoist.'
                    : 'Rappel dans Todoist · 👥 Suivi clients'}
              </p>
            )}
            </div>
          </div>
        </div>

        {error && <p className="text-erreur text-sm mt-3">{error}</p>}

        <PiecesJointes dossierId={dossier.id} onMontantChange={relireMontant} />

        <div className="mt-4">
          <div className="flex items-baseline justify-between px-1 mb-2">
            <p className="text-xs text-texte-faible">
              Notes{notes.length > 0 ? ` · ${notes.length}` : ''}
            </p>
            {notes.length > APERCU_NOTES && (
              <button
                onClick={() => setToutesNotes((v) => !v)}
                className="text-accent text-xs font-medium"
              >
                {toutesNotes ? 'Réduire' : `Afficher les ${notes.length} notes`}
              </button>
            )}
          </div>
          <div className="bg-carte rounded-xl shadow-sm p-3 flex gap-2 mb-2">
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Ajouter une note…"
              className="flex-1 text-texte outline-none bg-transparent"
              onKeyDown={(e) => e.key === 'Enter' && addNote()}
            />
            <button
              onClick={addNote}
              disabled={addingNote || !newNote.trim()}
              className="text-accent text-sm font-medium disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>
          {notes.length > 0 && (
            <ul className="space-y-2">
              {(toutesNotes ? notes : notes.slice(0, APERCU_NOTES)).map((n) => (
                <li key={n.id} className="bg-carte rounded-xl px-4 py-3 shadow-sm">
                  <NoteTexte texte={n.texte} />
                  <p className="text-xs text-texte-faible mt-1">
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
        {/* Discret et en fin de fiche : une suppression ne doit pas se cliquer
            par réflexe en descendant la page. */}
        <div className="mt-8 pt-4 border-t border-separateur">
          <button
            onClick={supprimer}
            disabled={suppression}
            className="w-full text-erreur text-sm py-2 disabled:opacity-50"
          >
            {suppression ? 'Suppression…' : 'Supprimer ce dossier'}
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
