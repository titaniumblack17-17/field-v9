// Typage des documents déposés sur un dossier (table `fichiers`, colonnes
// type_doc / version_doc / variantes / variante_retenue / a_trancher_raison).
//
// Un devis se lit et se chiffre. Un cahier des charges (CDC, versions V1, V2…)
// et un plan suivent le projet : on les range, on les versionne, on ne les
// analyse jamais comme un devis.

export const TYPES_DOC = [
  ['devis', 'Devis'],
  ['cdc', 'Cahier des charges'],
  ['plan', 'Plan'],
  ['autre', 'Autre'],
]

export const TYPES_DOC_LABELS = Object.fromEntries(TYPES_DOC)

/**
 * Type et version déduits du nom, pour un fichier qui vient d'être déposé.
 * Même règle que le remplissage SQL de la migration : mot « CDC » ou « cabinet
 * général » → cahier des charges (version lue dans `_V3`), référence à neuf
 * chiffres de la nomenclature de Bruce → devis, mot « plan » → plan, sinon
 * « autre ». Une photo ou un scan ne se devine pas : « autre ».
 */
export function typeParNom(nom) {
  const n = nom ?? ''
  if (/(^|[^a-z])cdc([^a-z]|$)/i.test(n) || /cabinet general/i.test(n)) {
    const v = n.match(/_V(\d+)\.[a-z0-9]+$/i)
    return { type_doc: 'cdc', version_doc: v ? Number(v[1]) : null }
  }
  if (/_\d{9}[a-z]?\.pdf$/i.test(n)) return { type_doc: 'devis', version_doc: null }
  if (/(^|[^a-z])plan([^a-z]|$)/i.test(n)) return { type_doc: 'plan', version_doc: null }
  return { type_doc: 'autre', version_doc: null }
}

export const estDevis = (f) => f?.type_doc === 'devis'

/** « Devis », « CDC V3 », « Plan », « Autre » — le texte de la pastille de type. */
export function libellePastille(f) {
  if (f?.type_doc === 'cdc') return f.version_doc != null ? `CDC V${f.version_doc}` : 'CDC'
  return TYPES_DOC_LABELS[f?.type_doc] ?? 'Autre'
}

/** Offres exclusives enregistrées sur un devis (liste vide si aucune). */
export const variantesDe = (f) => (Array.isArray(f?.variantes) ? f.variantes : [])

// ── Décision par devis : retenu / alternative / remplacé / mis de côté ──────────
// Défaut « à trancher ». Seuls les devis « retenus » comptent dans le montant du
// dossier (leur somme : cumul entre devis, et entre offres d'un même devis).
export const DECISIONS = [
  ['retenu', 'Retenu'],
  ['alternative', 'Alternative'],
  ['remplace', 'Remplacé'],
  ['mis_de_cote', 'Mis de côté'],
]
export const DECISIONS_LIBELLES = { a_trancher: 'À trancher', ...Object.fromEntries(DECISIONS) }
export const decisionDe = (f) => f?.decision ?? 'a_trancher'
const maintenant = () => new Date().toISOString()

/** Champs à écrire pour une décision ; `extras` : remplace_par, date_reprise… */
export function champsDecision(decision, extras = {}) {
  const champs = { decision, decision_le: maintenant() }
  if (decision !== 'remplace') champs.remplace_par = null
  if (decision !== 'mis_de_cote') {
    champs.mis_de_cote_le = null
    champs.date_reprise = null
  } else {
    champs.mis_de_cote_le = maintenant()
    champs.date_reprise = extras.date_reprise ?? null
  }
  if (decision === 'remplace') champs.remplace_par = extras.remplace_par ?? null
  return champs
}

/** Valeurs actuelles des champs de décision d'un devis (pour pouvoir annuler). */
export const champsDecisionActuels = (f) => ({
  decision: decisionDe(f),
  decision_le: f.decision_le ?? null,
  remplace_par: f.remplace_par ?? null,
  mis_de_cote_le: f.mis_de_cote_le ?? null,
  date_reprise: f.date_reprise ?? null,
})

// ── Numéro de devis : « NOM_PRODUIT_AAAAMMNNN[révision] » ──────────────────────
// La racine (NOM_PRODUIT) identifie l'affaire ; le numéro (neuf chiffres) puis la
// lettre de révision donnent l'ordre.
export function parserReference(nom) {
  const m = String(nom ?? '').match(/^(.*)_(\d{9})([A-Za-z]?)\.[A-Za-z0-9]+$/)
  if (!m) return null
  return { racine: m[1].trim().toLowerCase(), numero: Number(m[2]), revision: m[3].toUpperCase() }
}

/** Compare deux références parsées : <0 si a précède b. */
export const comparerReferences = (a, b) =>
  a.numero - b.numero || (a.revision || '').localeCompare(b.revision || '')

/**
 * Proposition « ce devis remplace-t-il le précédent ? » : même racine, numéro
 * plus élevé. Renvoie le devis précédent le plus proche, ou null. Jamais
 * d'automatisme : la proposition ne fait que s'afficher.
 */
export function proposerRemplacement(liste, f) {
  if (!estDevis(f) || decisionDe(f) !== 'a_trancher') return null
  const ref = parserReference(f.nom)
  if (!ref) return null
  const precedents = (liste ?? [])
    .filter((g) => g.id !== f.id && estDevis(g) && g.dossier_id === f.dossier_id && decisionDe(g) !== 'remplace')
    .map((g) => ({ g, r: parserReference(g.nom) }))
    .filter(({ r }) => r && r.racine === ref.racine && comparerReferences(r, ref) < 0)
    .sort((x, y) => comparerReferences(y.r, x.r))
  return precedents[0]?.g ?? null
}

/** Rang d'affichage : devis actifs, puis mis de côté (« Reportés »), puis remplacés. */
export const groupeDevis = (f) =>
  decisionDe(f) === 'mis_de_cote' ? 'reportes' : decisionDe(f) === 'remplace' ? 'remplaces' : 'actifs'

/**
 * Un devis est « à trancher » tant que Bruce n'a pas retenu d'offre alors que
 * plusieurs coexistent, ou qu'un motif de doute (HT/TTC…) est posé sans montant.
 * Un devis dont le TTC est déjà écrit n'est jamais « à trancher ».
 */
export function aTrancher(f) {
  if (!estDevis(f) || decisionDe(f) !== 'a_trancher') return false
  return f.montant_ttc != null || variantesDe(f).length >= 2 || Boolean(f.a_trancher_raison)
}

/** Plus petit et plus grand montant TTC des offres, ou null s'il n'y en a pas. */
export function fourchette(f) {
  const montants = variantesDe(f)
    .map((v) => v.montant_ttc)
    .filter((m) => typeof m === 'number')
  if (montants.length === 0) return null
  return { min: Math.min(...montants), max: Math.max(...montants) }
}

/** Cahier des charges en vigueur : la version la plus haute (à défaut, le plus récent). */
export function cdcEnVigueur(liste) {
  const cdc = (liste ?? []).filter((f) => f.type_doc === 'cdc')
  if (cdc.length === 0) return null
  return [...cdc].sort(
    (a, b) =>
      (b.version_doc ?? -1) - (a.version_doc ?? -1) ||
      String(b.created_at).localeCompare(String(a.created_at))
  )[0]
}

/**
 * Champs à écrire quand Bruce retient l'offre d'indice `i` : le montant du devis
 * prend sa valeur (le déclencheur en base recalcule alors le dossier).
 */
export function champsRetenue(f, i) {
  const v = variantesDe(f)[i]
  if (!v || typeof v.montant_ttc !== 'number') return null
  // Le motif de doute reste posé : si Bruce remet le devis à trancher, la
  // question HT/TTC doit se reposer.
  return { variante_retenue: i, variantes_retenues: [i], montant_ttc: v.montant_ttc, analyse_erreur: null, ...champsDecision('retenu') }
}

/** Remet le devis « à trancher » : l'offre retenue et le montant qui en venait sont retirés. */
export const champsRemiseATrancher = () => ({ variante_retenue: null, variantes_retenues: null, montant_ttc: null, ...champsDecision('a_trancher') })

export const TAUX_TVA = 0.2

/** TTC d'un montant HT (TVA 20 %), arrondi au centime. */
export const ttcDepuisHt = (ht) => Math.round(ht * (1 + TAUX_TVA) * 100) / 100

/**
 * Quand le devis porte un doute HT/TTC (`a_trancher_raison`), le montant de
 * l'offre est lu comme HT : il est rangé dans montant_ht et le TTC est calculé.
 */
export function champsRetenueHt(f, i) {
  const v = variantesDe(f)[i]
  if (!v || typeof v.montant_ttc !== 'number') return null
  return {
    variante_retenue: i,
    variantes_retenues: [i],
    montant_ht: v.montant_ttc,
    montant_ttc: ttcDepuisHt(v.montant_ttc),
    analyse_erreur: null,
    ...champsDecision('retenu'),
  }
}

/** Indices des offres retenues : le cumul si présent, sinon l'offre unique d'avant. */
export function retenuesDe(f) {
  if (Array.isArray(f?.variantes_retenues) && f.variantes_retenues.length > 0) return f.variantes_retenues
  return f?.variante_retenue != null ? [f.variante_retenue] : []
}

/** TTC d'une offre selon la base choisie : 'ht' applique la TVA, sinon le montant tel quel. */
export const ttcOffre = (v, base) => (base === 'ht' ? ttcDepuisHt(v.montant_ttc) : v.montant_ttc)

/**
 * Cumul de plusieurs offres : `choix` = [{ i, base: 'ttc' | 'ht' }]. Le montant
 * du devis est la somme des TTC. `montant_ht` n'est renseigné que si toutes les
 * offres retenues sont lues en HT (somme des HT) ; sinon on n'y touche pas.
 */
export function champsCumul(f, choix) {
  const offres = variantesDe(f)
  const valides = choix.filter((c) => offres[c.i] && typeof offres[c.i].montant_ttc === 'number')
  if (valides.length === 0) return null
  const tri = [...valides].sort((a, b) => a.i - b.i)
  const total = Math.round(tri.reduce((t, c) => t + ttcOffre(offres[c.i], c.base), 0) * 100) / 100
  const champs = {
    variante_retenue: tri[0].i,
    variantes_retenues: tri.map((c) => c.i),
    montant_ttc: total,
    analyse_erreur: null,
    ...champsDecision('retenu'),
  }
  if (tri.every((c) => c.base === 'ht')) {
    champs.montant_ht = tri.reduce((t, c) => t + offres[c.i].montant_ttc, 0)
  }
  return champs
}
