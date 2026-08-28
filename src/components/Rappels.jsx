import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  etatRappel,
  ajouterRappel,
  cloreRappel,
  synchroniserRappel,
} from '../lib/rappel'
import TexteModifiable from './TexteModifiable'
import useConfirm from '../hooks/useConfirm'
import usePrompt from '../hooks/usePrompt'

const aujourdhui = () => new Date().toISOString().slice(0, 10)

const JOURS_FERIES_FIXES = [
  [1, 1], // Jour de l'an
  [5, 1], // Fête du travail
  [5, 8], // Victoire 1945
  [7, 14], // Fête nationale
  [8, 15], // Assomption
  [11, 1], // Toussaint
  [11, 11], // Armistice
  [12, 25], // Noël
]

// Dimanche de Pâques (algorithme de Gauss/Meeus) : sert à dériver les trois
// fériés mobiles français, tous fixés par rapport à cette date.
const paques = (annee) => {
  const a = annee % 19
  const b = Math.floor(annee / 100)
  const c = annee % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mois = Math.floor((h + l - 7 * m + 114) / 31)
  const jour = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(annee, mois - 1, jour)
}

const plusJoursCalendaires = (date, n) => {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

// Formatage en date locale, pas `toISOString()` : ces fériés sont construits
// à minuit local, et minuit à Paris tombe la veille en UTC (23h ou 22h selon
// la saison) — passer par l'ISO ferait glisser chaque férié d'un jour et ne
// matcherait plus jamais la date du jour.
const versISO = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const joursFeries = (annee) => {
  const p = paques(annee)
  return [
    ...JOURS_FERIES_FIXES.map(([m, j]) => new Date(annee, m - 1, j)),
    plusJoursCalendaires(p, 1), // Lundi de Pâques
    plusJoursCalendaires(p, 39), // Ascension
    plusJoursCalendaires(p, 50), // Lundi de Pentecôte
  ].map(versISO)
}

const estJourOuvre = (date) => {
  const jourSemaine = date.getDay()
  if (jourSemaine === 0 || jourSemaine === 6) return false
  return !joursFeries(date.getFullYear()).includes(versISO(date))
}

// Se relancer un samedi ou un jour férié n'a pas de sens : personne ne
// décroche. On avance donc jour par jour et on ne compte que les jours
// ouvrés, jusqu'à en avoir cumulé n — la date obtenue tombe alors forcément
// sur un jour ouvré.
const dansNJoursOuvres = (n) => {
  const d = new Date()
  let restants = n
  while (restants > 0) {
    d.setDate(d.getDate() + 1)
    if (estJourOuvre(d)) restants -= 1
  }
  return d.toISOString().slice(0, 10)
}

// Cadence de relance des pros du secteur : première relance à J+3, seconde
// à J+7 après. Poser un rappel juste après l'envoi ou pendant une relance
// n'a donc pas la même échéance naturelle — plutôt que de retomber
// systématiquement sur aujourd'hui, la date proposée suit ce rythme.
const dateParDefaut = (statut) => {
  if (statut === 'devis_envoye') return dansNJoursOuvres(3)
  if (statut === 'relance') return dansNJoursOuvres(7)
  return aujourdhui()
}

const leJour = (v) =>
  v ? new Date(v).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''

/**
 * Rappels d'un dossier : ceux qui restent, puis ceux qui sont faits.
 *
 * Une affaire qui court sur six mois compte dix rappels, et leur suite raconte
 * son histoire — ce qui a été dit, quand, ce qu'on en a retenu. Les afficher
 * de haut en bas vaut mieux qu'une date unique qui écrase la précédente.
 */
export default function Rappels({ dossierId, statut }) {
  const [liste, setListe] = useState([])
  const [ouvertureForm, setOuvertureForm] = useState(false)
  const [date, setDate] = useState(aujourdhui())
  const [note, setNote] = useState('')
  const [heure, setHeure] = useState('')
  const [enCours, setEnCours] = useState(null)
  const [historique, setHistorique] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [confirmer, boîteConfirmation] = useConfirm()
  const [demanderTexte, boîtePrompt] = usePrompt()

  useEffect(() => {
    let actif = true

    supabase
      .from('rappels')
      .select('*')
      .eq('dossier_id', dossierId)
      .order('date', { ascending: true })
      .then(({ data }) => {
        if (actif) setListe(data ?? [])
      })

    const canal = supabase
      .channel(`rappels-${dossierId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rappels', filter: `dossier_id=eq.${dossierId}` },
        (p) => {
          setListe((cur) => {
            if (p.eventType === 'INSERT') {
              return cur.some((r) => r.id === p.new.id) ? cur : [...cur, p.new]
            }
            if (p.eventType === 'UPDATE') return cur.map((r) => (r.id === p.new.id ? p.new : r))
            if (p.eventType === 'DELETE') return cur.filter((r) => r.id !== p.old.id)
            return cur
          })
        }
      )
      .subscribe()

    return () => {
      actif = false
      supabase.removeChannel(canal)
    }
  }, [dossierId])

  const ouverts = liste.filter((r) => !r.fait_at)
  const faits = liste
    .filter((r) => r.fait_at)
    .sort((a, b) => b.fait_at.localeCompare(a.fait_at))

  const ajouter = async () => {
    if (!date) return
    setEnCours('ajout')
    setErreur(null)
    const r = await ajouterRappel(dossierId, date, note, heure)
    if (r?.erreur) setErreur(r.erreur)
    else {
      setNote('')
      setHeure('')
      setDate(aujourdhui())
      setOuvertureForm(false)
    }
    setEnCours(null)
  }

  const clore = async (rappel) => {
    // Le commentaire est demandé au moment du geste : c'est là qu'on sait ce
    // qui s'est dit, pas au prochain passage sur la fiche.
    const commentaire = await demanderTexte('Que retenez-vous de cet appel ?', {
      titre: `Rappel du ${leJour(rappel.date)}${rappel.note ? ` — ${rappel.note}` : ''}`,
      confirmLabel: 'Valider',
    })
    if (commentaire === null) return
    setEnCours(rappel.id)
    const r = await cloreRappel(rappel.id, commentaire)
    if (r?.erreur) setErreur(r.erreur)
    setEnCours(null)
  }

  // Corriger une faute de frappe, préciser l'objet, décaler la date : tout ce
  // qui a été saisi doit pouvoir se reprendre. Un changement de date ou d'objet
  // se répercute sur la tâche Todoist.
  const modifier = async (rappel, champs) => {
    const { error } = await supabase.from('rappels').update(champs).eq('id', rappel.id)
    if (error) {
      setErreur(error.message)
      return
    }
    if (!rappel.fait_at && ('date' in champs || 'note' in champs)) {
      await synchroniserRappel(rappel.id)
    }
  }

  // Même fenêtre que pour clore un rappel ou ajouter une note de dossier —
  // pas l'édition en ligne avec ses ✓/× minuscules, source de deux bugs
  // récents (mauvais bouton touché, événement de clic sauvé par erreur).
  const modifierObjet = async (rappel) => {
    const texte = await demanderTexte('', {
      titre: 'Objet du rappel',
      confirmLabel: 'Enregistrer',
      placeholder: 'Relancer sur le devis, confirmer la date…',
      valeurInitiale: rappel.note ?? '',
    })
    if (texte === null) return
    await modifier(rappel, { note: texte.trim() || null })
  }

  const modifierCommentaire = async (rappel) => {
    const texte = await demanderTexte('', {
      titre: 'Commentaire',
      confirmLabel: 'Enregistrer',
      placeholder: 'Ce que vous en retenez',
      valeurInitiale: rappel.commentaire ?? '',
    })
    if (texte === null) return
    await modifier(rappel, { commentaire: texte.trim() || null })
  }

  const supprimer = async (rappel) => {
    if (
      !(await confirmer(`Supprimer le rappel du ${leJour(rappel.date)} sans le marquer fait ?`, {
        confirmLabel: 'Supprimer',
      }))
    )
      return
    await supabase.from('rappels').delete().eq('id', rappel.id)
    setListe((cur) => cur.filter((r) => r.id !== rappel.id))
  }

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between px-1 mb-2">
        <p className="text-xs text-texte-faible">
          Rappels{ouverts.length > 0 ? ` · ${ouverts.length} en cours` : ''}
        </p>
        <button
          onClick={() => {
            if (!ouvertureForm) setDate(dateParDefaut(statut))
            setOuvertureForm((v) => !v)
          }}
          className="text-accent text-sm font-medium h-11 px-2 -mr-2 inline-flex items-center"
        >
          {ouvertureForm ? 'Fermer' : '+ Ajouter'}
        </button>
      </div>

      {erreur && <p className="text-erreur text-sm mb-2 px-1">{erreur}</p>}

      {ouvertureForm && (
        <div className="bg-carte rounded-xl shadow-sm divide-y divide-separateur mb-2">
          <div className="flex divide-x divide-separateur">
            <div className="px-4 py-3 flex-1">
              <label className="text-xs text-texte-faible" htmlFor="rappel-date">Date</label>
              <input
                id="rappel-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full text-texte outline-none bg-transparent"
              />
            </div>
            {/* Facultative : beaucoup de relances n'ont pas d'heure convenue,
                et en imposer une ferait sonner le téléphone pour rien. */}
            <div className="px-4 py-3 flex-1">
              <label className="text-xs text-texte-faible" htmlFor="rappel-heure">
                Heure (facultative)
              </label>
              <input
                id="rappel-heure"
                type="time"
                value={heure}
                onChange={(e) => setHeure(e.target.value)}
                className="w-full text-texte outline-none bg-transparent"
              />
            </div>
          </div>
          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="rappel-note">Objet</label>
            <input
              id="rappel-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Relancer sur le devis, confirmer la date…"
              onKeyDown={(e) => e.key === 'Enter' && ajouter()}
              className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
            />
          </div>
          <div className="p-3">
            <button
              onClick={ajouter}
              disabled={enCours === 'ajout' || !date}
              className="w-full bg-accent text-white font-medium rounded-xl py-3 shadow disabled:opacity-50"
            >
              {enCours === 'ajout' ? 'Enregistrement…' : 'Poser ce rappel'}
            </button>
          </div>
        </div>
      )}

      {ouverts.length === 0 && !ouvertureForm && (
        <p className="text-texte-faible text-sm px-1">Aucun rappel en cours.</p>
      )}

      <ul className="space-y-2">
        {ouverts.map((r) => {
          const e = etatRappel(r.date, r.heure)
          return (
            <li key={r.id} className="bg-carte rounded-xl shadow-sm flex items-stretch">
              <div className="flex-1 min-w-0 px-4 py-3">
                <div className="flex items-center gap-2">
                  <TexteModifiable
                    valeur={r.date}
                    type="date"
                    vide="Sans date"
                    className={`text-sm ${e?.classe ?? 'text-texte-doux'} underline decoration-dotted underline-offset-2`}
                    rendu={() => e?.texte}
                    onEnregistrer={(v) => v && modifier(r, { date: v })}
                  />
                  <TexteModifiable
                    valeur={r.heure}
                    type="time"
                    vide="+ heure"
                    className="text-xs text-texte-faible underline decoration-dotted underline-offset-2 flex-shrink-0"
                    rendu={() => ''}
                    onEnregistrer={(v) => modifier(r, { heure: v })}
                  />
                </div>
                <button
                  onClick={() => modifierObjet(r)}
                  className={`text-left w-full ${r.note ? 'text-texte' : 'text-texte-fantome'}`}
                >
                  {r.note || 'Ajouter un objet'}
                </button>
              </div>
              <button
                onClick={() => supprimer(r)}
                aria-label="Supprimer ce rappel"
                className="w-11 flex-shrink-0 flex items-center justify-center text-texte-fantome text-lg"
              >
                ×
              </button>
              <button
                onClick={() => clore(r)}
                disabled={enCours === r.id}
                aria-label="Marquer ce rappel comme fait"
                className="w-14 flex-shrink-0 flex items-center justify-center text-texte-fantome text-xl active:text-accent disabled:opacity-40 border-l border-separateur"
              >
                {enCours === r.id ? '…' : '✓'}
              </button>
            </li>
          )
        })}
      </ul>

      {faits.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setHistorique((v) => !v)}
            className="text-accent text-xs font-medium h-9 px-2 -ml-2 inline-flex items-center"
          >
            {historique ? 'Masquer' : `${faits.length} rappel${faits.length > 1 ? 's' : ''} fait${faits.length > 1 ? 's' : ''}`}
          </button>
          {historique && (
            <ul className="space-y-2 mt-1">
              {faits.map((r) => (
                <li key={r.id} className="bg-carte-douce rounded-xl px-4 py-3">
                  <p className="text-xs text-texte-faible">
                    {leJour(r.date)} · fait le {leJour(r.fait_at)}
                  </p>
                  {r.note && <p className="text-sm text-texte-doux">{r.note}</p>}
                  <div className="mt-1">
                    <button
                      onClick={() => modifierCommentaire(r)}
                      className={`text-left w-full text-sm ${r.commentaire ? 'text-texte' : 'text-texte-fantome'}`}
                    >
                      {r.commentaire || 'Ajouter un commentaire'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {boîteConfirmation}
      {boîtePrompt}
    </div>
  )
}
