import { supabase } from './supabaseClient'

export const aujourdhui = () => new Date().toISOString().slice(0, 10)

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
export const dateParDefaut = (statut) => {
  if (statut === 'devis_envoye') return dansNJoursOuvres(3)
  if (statut === 'relance') return dansNJoursOuvres(7)
  return aujourdhui()
}

/**
 * Un rappel du 2 mars et un rappel du 2 décembre ne demandent pas la même
 * chose. Affichés tous deux dans la même couleur et en date ISO, ils se
 * confondent : « 2026-03-02 » ne dit pas qu'on a cent soixante-treize jours
 * de retard.
 */
export function etatRappel(date, heure) {
  if (!date) return null

  const jour = new Date(date + 'T00:00:00')
  if (Number.isNaN(jour.getTime())) return null

  const aujourdhui = new Date()
  aujourdhui.setHours(0, 0, 0, 0)

  const jours = Math.round((jour - aujourdhui) / 86400000)
  const affiche = jour.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  // « 10:30:00 » en base, « 10 h 30 » à l'écran.
  const hhmm = heure ? heure.slice(0, 5) : null
  const a = hhmm ? ` à ${hhmm.replace(':', ' h ')}` : ''

  if (jours < 0) {
    const retard = -jours
    return {
      texte: retard === 1 ? 'En retard depuis hier' : `En retard de ${retard} jours`,
      classe: 'text-erreur font-medium',
      echu: true,
    }
  }
  if (jours === 0) {
    // Une heure passée dans la journée rend le rappel échu : c'est tout
    // l'intérêt d'en poser une.
    if (hhmm) {
      const passe = new Date(`${date}T${heure}`) < new Date()
      return passe
        ? { texte: `En retard depuis ${hhmm.replace(':', ' h ')}`, classe: 'text-erreur font-medium', echu: true }
        : { texte: `Aujourd'hui${a}`, classe: 'text-alerte font-medium', echu: true }
    }
    return { texte: "À rappeler aujourd'hui", classe: 'text-alerte font-medium', echu: true }
  }
  if (jours <= 7) {
    return { texte: `À rappeler le ${affiche}${a}`, classe: 'text-alerte', echu: false }
  }
  // Bleu et non vert : le vert annonce une chose réglée. Un rappel encore à
  // honorer qui s'affiche en vert se lit « c'est fait » d'un coup d'œil.
  return { texte: `Rappel le ${affiche}${a}`, classe: 'text-accent', echu: false }
}

/**
 * Échéance d'une sous-tâche de note (NoteTaches) : même code couleur que les
 * rappels — rouge en retard, orange sous 8 jours, bleu au-delà, jamais vert —
 * sans heure, une sous-tâche n'a qu'une date. `echu` (jours <= 0) sert aussi
 * de critère pour la remontée dans BriefSoir : une échéance du jour même
 * demande une décision ce soir au même titre qu'un rappel « à rappeler
 * aujourd'hui », donc compte comme en retard là-bas.
 */
export function etatEcheanceTache(date) {
  if (!date) return null

  const jour = new Date(date + 'T00:00:00')
  if (Number.isNaN(jour.getTime())) return null

  const aujourdhui = new Date()
  aujourdhui.setHours(0, 0, 0, 0)

  const jours = Math.round((jour - aujourdhui) / 86400000)
  const affiche = jour.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })

  if (jours < 0) {
    const retard = -jours
    return {
      texte: retard === 1 ? 'En retard depuis hier' : `En retard de ${retard} jours`,
      classe: 'text-erreur font-medium',
      echu: true,
    }
  }
  if (jours === 0) return { texte: "Aujourd'hui", classe: 'text-alerte font-medium', echu: true }
  if (jours <= 7) return { texte: `Le ${affiche}`, classe: 'text-alerte', echu: false }
  return { texte: `Le ${affiche}`, classe: 'text-accent', echu: false }
}

/** Aligne la tâche Todoist d'un rappel. Ne lève jamais : un rappel qui ne part
 *  pas ne doit pas faire échouer la saisie, seulement se signaler. */
export async function synchroniserRappel(rappelId) {
  const { data, error } = await supabase.functions.invoke('todoist-rappel', {
    body: { rappelId },
  })
  if (!error) return data
  try {
    const corps = await error.context?.json()
    if (corps?.erreur) return { erreur: corps.erreur }
  } catch {
    /* corps illisible */
  }
  return { erreur: error.message }
}

/** Rapatrie ce qui a été coché côté Todoist. */
export async function reconcilierRappels() {
  const { data, error } = await supabase.functions.invoke('todoist-rappel', {
    body: { action: 'reconcilier' },
  })
  return error ? { erreur: error.message } : data
}

export async function ajouterRappel(dossierId, date, note, heure) {
  const { data, error } = await supabase
    .from('rappels')
    .insert({ dossier_id: dossierId, date, heure: heure || null, note: note?.trim() || null })
    .select()
    .single()
  if (error) return { erreur: error.message }
  // Todoist en tâche de fond : le rappel existe déjà en base (ce qui compte
  // pour Field V9), pas besoin d'attendre l'aller-retour externe pour
  // libérer l'écran — sur une connexion faible en visite, cette attente se
  // sentait comme un gel sur une action qui devrait être instantanée.
  // synchroniserRappel ne lève jamais, sûr à ne pas attendre.
  synchroniserRappel(data.id)
  return data
}

/**
 * Clôt un rappel. Le commentaire reste attaché au rappel (la suite des
 * rappels d'un dossier continue de se relire d'un coup d'œil dans
 * Rappels.jsx) ET devient une vraie note de dossier — visible dans le
 * journal, soumise à la même détection de sous-tâches (suggestion jamais
 * imposée) que n'importe quelle autre note. Double écriture assumée : les
 * deux lectures (historique des rappels, journal du dossier) servent des
 * usages différents.
 */
export async function cloreRappel(rappelId, commentaire) {
  const texte = commentaire?.trim() || null
  const { data, error } = await supabase
    .from('rappels')
    .update({ fait_at: new Date().toISOString(), commentaire: texte })
    .eq('id', rappelId)
    .select('dossier_id')
    .single()
  if (error) return { erreur: error.message }
  if (texte) {
    await supabase.from('dossier_notes').insert({ dossier_id: data.dossier_id, texte })
  }
  // fait_at est posé : la fonction supprime la tâche au lieu d'en créer une.
  // Là aussi en tâche de fond, même raison que ajouterRappel ci-dessus.
  synchroniserRappel(rappelId)
  return {}
}

/** Clôt le prochain rappel ouvert d'un dossier — utilisé depuis le Brief, qui
 *  ne connaît que le dossier. */
export async function cloreProchainRappel(dossierId, commentaire) {
  const { data } = await supabase
    .from('rappels')
    .select('id')
    .eq('dossier_id', dossierId)
    .is('fait_at', null)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return { erreur: 'Aucun rappel ouvert.' }
  return cloreRappel(data.id, commentaire)
}

/**
 * Retire de Todoist les tâches des rappels encore ouverts sur ces dossiers.
 *
 * À appeler avant de supprimer un dossier ou un client : la cascade efface les
 * rappels en base, mais Todoist continuerait de sonner pour une affaire qui
 * n'existe plus.
 */
export async function retirerRappelsTodoist(dossierIds) {
  if (!dossierIds?.length) return
  const { data } = await supabase
    .from('rappels')
    .select('id')
    .in('dossier_id', dossierIds)
    .is('fait_at', null)
    .not('todoist_task_id', 'is', null)

  for (const r of data ?? []) {
    await supabase.from('rappels').update({ fait_at: new Date().toISOString() }).eq('id', r.id)
    await synchroniserRappel(r.id)
  }
}

/**
 * Pose automatiquement un rappel de relance quand un dossier entre en
 * « Devis envoyé » ou « Relance » — J+3 puis J+7, jours ouvrés. À appeler à
 * chaque transition d'étape (glisser-déposer, sélecteur d'étape), jamais sur
 * une simple sauvegarde : ne se déclenche que sur un vrai changement de
 * statut, sinon corriger un autre champ pendant qu'un dossier reste en
 * « Devis envoyé » ressusciterait un rappel que Bruce vient de supprimer.
 *
 * Ne double jamais non plus : si un rappel est déjà ouvert sur ce dossier
 * (posé à la main, ou par un précédent passage par cette étape), on ne
 * touche à rien.
 */
export async function assurerRappelDeRelance(dossierId, statut) {
  if (statut !== 'devis_envoye' && statut !== 'relance') return
  const { data: existant } = await supabase
    .from('rappels')
    .select('id')
    .eq('dossier_id', dossierId)
    .is('fait_at', null)
    .limit(1)
    .maybeSingle()
  if (existant) return
  const note = statut === 'devis_envoye' ? 'Relancer sur le devis' : 'Relancer à nouveau'
  await ajouterRappel(dossierId, dateParDefaut(statut), note, null)
}
