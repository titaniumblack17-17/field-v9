import { calculerBilan } from './bilanBoard'
import { offresPlat, dossiersReportes, dossiersSansDevisVivant } from './documents'
import { nomClient } from './client'
import { enAttenteAccord, nonConfirme, resume } from './financement'
import { FAMILLES, familleDe, estProjetActif } from '../constants/dashboard'
import { ETAPES_PROJET_LABELS, ETAPES_SIGNEES, exerciceDe, aChiffrer, estEnAttente, joursDepuisStatut, joursEnAttente, MOTIFS_ATTENTE_SAV_LABELS } from '../constants/dossiers'

// Liste des projets : une ligne par dossier de type « projet », ni perdu ni terminé.
// Tous les calculs sont purs (testables) et reprennent les définitions du Pilotage et de la RPC
// dashboard_chiffres() (clé « projets »).

const ETAPES_APRES_DEVIS = [
  'devis_envoye', 'relance', 'visite_local', 'negociation', 'confirmation',
  'financement', 'commande', 'reunion_chantier', 'installation', 'finition',
]

export { familleDe, estProjetActif }

/** Un projet est « signé » comme le Pilotage le compte : étape signée, pas reporté, exercice de l'année. */
export function estSigne(d, fichiers, annee = new Date().getFullYear()) {
  const reportes = dossiersReportes(fichiers.filter((f) => f.type_doc === 'devis'))
  return d.type === 'projet' && d.statut !== 'perdu' && ETAPES_SIGNEES.includes(d.statut) && !reportes.has(d.id) && exerciceDe(d, annee) === annee
}

const TAGS = { rappel: 'Rappel', relance_devis: 'Relance devis', tache: 'Tâche', devis: 'Devis', sav: 'SAV' }

const instant = (v) => (v ? new Date(v).getTime() : 0)

/**
 * Lignes de la liste. `fichiers` : lignes `fichiers` (devis, CDC…) ; `activite` : { notes, etapes } —
 * horodatages des notes et des changements d'étape par dossier (pour « ancienneté depuis la dernière action »).
 */
export function construireProjets({ dossiers, fichiers, taches, activite = {}, financements = [] }) {
  const finDe = new Map(financements.map((x) => [x.dossier_id, x]))
  const actifs = dossiers.filter(estProjetActif)
  // Même logique d'urgence que « Aujourd'hui » : les éléments urgents du Board, par dossier.
  const bilan = calculerBilan(actifs, taches, fichiers.filter((f) => f.type_doc === 'devis'))
  const urgents = new Map()
  for (const e of bilan.elementsUrgents) urgents.set(e.dossier.id, [...(urgents.get(e.dossier.id) ?? []), e])

  const offres = offresPlat(fichiers.filter((f) => f.type_doc === 'devis'))
  const aTrancherPar = new Map()
  for (const o of offres) if (o.etat === 'a_trancher') aTrancherPar.set(o.dossier_id, (aTrancherPar.get(o.dossier_id) ?? 0) + 1)
  // « Reporté » : au moins une offre reportée (même nombre que « Offres reportées · dossiers » du Pilotage).
  const reportes = new Set(offres.filter((o) => o.etat === 'reportee').map((o) => o.dossier_id))

  const sansDevisVivant = dossiersSansDevisVivant(fichiers)
  const avecDevis = new Set(fichiers.filter((f) => f.type_doc === 'devis').map((f) => f.dossier_id))
  const avecCdc = new Set(fichiers.filter((f) => f.type_doc === 'cdc').map((f) => f.dossier_id))
  const derniers = new Map() // dossier → dernier instant d'activité connu
  const noter = (id, t) => {
    if (t && t > (derniers.get(id) ?? 0)) derniers.set(id, t)
  }
  for (const n of activite.notes ?? []) noter(n.dossier_id, instant(n.created_at))
  for (const e of activite.etapes ?? []) noter(e.dossier_id, instant(e.changed_at))
  for (const f of fichiers) noter(f.dossier_id, instant(f.created_at))

  return actifs.map((d) => {
    const famille = familleDe(d.statut)
    const manquants = []
    if (ETAPES_APRES_DEVIS.includes(d.statut) && !avecDevis.has(d.id)) manquants.push('Devis manquant')
    if (d.plan_statut && !avecCdc.has(d.id)) manquants.push('Cahier des charges manquant')
    const items = urgents.get(d.id) ?? []
    const retard = items.length ? Math.max(...items.map((e) => e.joursRetard)) : null
    const nbATrancher = aTrancherPar.get(d.id) ?? 0
    const attente = estEnAttente(d)
    const joursAttente = joursEnAttente(d) ?? joursDepuisStatut(d)
    const motifAttente = attente ? (MOTIFS_ATTENTE_SAV_LABELS[d.bloque_par.trim()] ?? d.bloque_par.trim()) : null
    // Motifs, dans l'ordre d'importance pour AGIR : retard, devis à trancher, document manquant, en attente de qui, reporté.
    const motifs = []
    if (items.length) {
      const premier = items[0]
      motifs.push({ cle: 'retard', texte: `${TAGS[premier.type] ?? 'À traiter'} · ${premier.droite ?? premier.libelle}`, supplementaires: items.length - 1 })
    }
    if (nbATrancher) motifs.push({ cle: 'atrancher', texte: `Devis à trancher · ${nbATrancher} offre${nbATrancher > 1 ? 's' : ''}` })
    for (const m of manquants) motifs.push({ cle: 'manquant', texte: m })
    if (attente) motifs.push({ cle: 'attente', texte: `En attente de ${motifAttente}${joursAttente != null ? ` · ${joursAttente} j` : ''}` })
    else if (['devis_envoye', 'relance'].includes(d.statut) && joursAttente != null && !sansDevisVivant.has(d.id)) motifs.push({ cle: 'attente', texte: `En attente du client · ${joursAttente} j` })
    if (reportes.has(d.id)) motifs.push({ cle: 'reporte', texte: 'Reporté' })
    const urgence = retard != null ? 1000 + retard : nbATrancher ? 600 : manquants.length ? 500 : motifs.some((m) => m.cle === 'attente') ? 300 : reportes.has(d.id) ? 100 : 0
    const derniere = Math.max(derniers.get(d.id) ?? 0, instant(d.statut_changed_at), instant(d.created_at))
    const montant = d.montant_estime != null && Number(d.montant_estime) !== 0 ? Number(d.montant_estime) : null
    return {
      id: d.id,
      dossier: d,
      client: nomClient(d.clients) ?? '—',
      ville: d.clients?.ville ?? '',
      titre: d.titre || 'Projet de vente',
      famille,
      etape: ETAPES_PROJET_LABELS[d.statut] ?? d.statut,
      montant,
      aChiffrer: montant == null && aChiffrer(d),
      motifs,
      // Autres motifs ou éléments urgents derrière le premier affiché.
      autres: motifs.length - 1 + (items.length > 1 ? items.length - 1 : 0),
      urgence,
      aTrancher: nbATrancher > 0,
      reporte: reportes.has(d.id),
      enAttente: attente,
      // Financement : mêmes définitions que la clé « financement » de dashboard_chiffres().
      financement: finDe.get(d.id) ?? null,
      finAttente: enAttenteAccord(finDe.get(d.id)),
      finNonConfirme: nonConfirme(finDe.get(d.id)) && estSigne(d, fichiers),
      incomplet: manquants.length > 0,
      derniereAction: derniere,
      jours: derniere ? Math.max(0, Math.floor((Date.now() - derniere) / 86_400_000)) : null,
    }
  })
}

/** Compteurs des filtres : toujours sur l'ensemble des projets actifs (jamais conditionnés aux autres filtres). */
export function compteurs(lignes) {
  const familles = Object.fromEntries(FAMILLES.map((f) => [f.cle, 0]))
  for (const l of lignes) familles[l.famille.cle] += 1
  return {
    actifs: lignes.length,
    familles,
    aTrancher: lignes.filter((l) => l.aTrancher).length,
    reportes: lignes.filter((l) => l.reporte).length,
    enAttente: lignes.filter((l) => l.enAttente).length,
    finAttente: lignes.filter((l) => l.finAttente).length,
    finNonConfirme: lignes.filter((l) => l.finNonConfirme).length,
    incomplets: lignes.filter((l) => l.incomplet).length,
  }
}

const normaliser = (s) =>
  (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const VUE_PAR_DEFAUT = {
  famille: null,
  aTrancher: false,
  reportes: false,
  enAttente: false,
  finAttente: false,
  finNonConfirme: false,
  incomplets: false,
  recherche: '',
  tri: 'action',
}

/** Filtres combinés en ET ; la famille est un choix unique. */
export function filtrer(lignes, vue) {
  const q = normaliser(vue.recherche).trim()
  return lignes.filter((l) => {
    if (vue.famille && l.famille.cle !== vue.famille) return false
    if (vue.aTrancher && !l.aTrancher) return false
    if (vue.reportes && !l.reporte) return false
    if (vue.enAttente && !l.enAttente) return false
    if (vue.finAttente && !l.finAttente) return false
    if (vue.finNonConfirme && !l.finNonConfirme) return false
    if (vue.incomplets && !l.incomplet) return false
    if (q) {
      const meule = normaliser([l.client, l.ville, l.titre, l.etape, resume(l.financement), ...l.motifs.map((m) => m.texte)].join(' '))
      if (!meule.includes(q)) return false
    }
    return true
  })
}

const ORDRE_ETAPES = Object.keys(ETAPES_PROJET_LABELS)

export const TRIS = [
  ['action', 'Action à faire'],
  ['montant', 'Montant'],
  ['etape', 'Étape'],
  ['anciennete', 'Ancienneté'],
]

/** Tris en un tap. Défaut : action à faire (urgent en haut), puis le plus ancien. */
export function trier(lignes, tri) {
  const l = [...lignes]
  const plusAncien = (a, b) => (a.derniereAction || Infinity) - (b.derniereAction || Infinity)
  if (tri === 'montant') return l.sort((a, b) => (b.montant ?? -1) - (a.montant ?? -1) || plusAncien(a, b))
  if (tri === 'etape') return l.sort((a, b) => ORDRE_ETAPES.indexOf(a.dossier.statut) - ORDRE_ETAPES.indexOf(b.dossier.statut) || plusAncien(a, b))
  if (tri === 'anciennete') return l.sort(plusAncien)
  return l.sort((a, b) => b.urgence - a.urgence || plusAncien(a, b))
}
