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
  if (!estDevis(f)) return false
  // Devis à offres : « à trancher » tant qu'au moins une offre l'est (état par offre).
  if (variantesDe(f).length >= 1) return offresDe(f).some((o) => o.etat === 'a_trancher')
  // Devis sans offres : sa décision, s'il a un montant à décider.
  return decisionDe(f) === 'a_trancher' && f.montant_ttc != null
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

// ── Décision par offre : retenue / à trancher / écartée / reportée ───────────────
// L'état vit dans chaque offre du jsonb `variantes` (`etat`), avec en option `projet`
// (étiquette courte), `date_reprise` (offre reportée) et `base` ('ht' | 'ttc'). La
// mémoire des offres retenues reste dans variantes_retenues / variante_retenue.
export const ETATS_OFFRE = [
  ['retenue', 'Retenue'],
  ['a_trancher', 'À trancher'],
  ['ecartee', 'Écartée'],
  ['reportee', 'Reportée'],
]
export const ETATS_OFFRE_LIBELLES = Object.fromEntries(ETATS_OFFRE)

/** Offres d'un devis avec leur état (une offre sans état : retenue si elle figure dans variantes_retenues, sinon à trancher). */
export function offresDe(f) {
  const retenues = retenuesDe(f)
  return variantesDe(f).map((v, i) => ({
    i,
    libelle: v.libelle,
    montant: v.montant_ttc,
    etat: v.etat ?? (retenues.includes(i) ? 'retenue' : 'a_trancher'),
    projet: v.projet ?? '',
    base: v.base ?? null,
    date_reprise: v.date_reprise ?? null,
  }))
}

/**
 * Toutes les « offres » d'un ensemble de fichiers, à plat : une ligne par offre d'un
 * devis à offres ; un devis sans offres compte pour une offre unique dont l'état suit
 * sa décision (retenu / à trancher / mis de côté ; remplacé et alternative = écartée).
 * Même règle que la RPC dashboard_chiffres().
 */
export function offresPlat(fichiers) {
  const sortie = []
  for (const f of fichiers ?? []) {
    if (!estDevis(f) || !f.dossier_id) continue
    if (variantesDe(f).length >= 1) {
      for (const o of offresDe(f)) sortie.push({ f, fichier_id: f.id, dossier_id: f.dossier_id, ...o })
    } else if (f.montant_ttc != null) {
      const etat = { retenu: 'retenue', a_trancher: 'a_trancher', mis_de_cote: 'reportee' }[decisionDe(f)] ?? 'ecartee'
      sortie.push({ f, fichier_id: f.id, dossier_id: f.dossier_id, i: null, libelle: f.nom, montant: Number(f.montant_ttc), etat, projet: '', base: null, date_reprise: f.date_reprise ?? null })
    }
  }
  return sortie
}

/** Dossiers « reportés » : au moins un devis mis de côté et aucun retenu, ou une offre reportée et aucune retenue. */
export function dossiersReportes(fichiers) {
  const devis = (fichiers ?? []).filter((f) => estDevis(f) && f.dossier_id)
  const ids = new Set()
  const parDossier = (liste) => {
    const m = new Map()
    for (const x of liste) m.set(x.dossier_id, [...(m.get(x.dossier_id) ?? []), x])
    return m
  }
  for (const [id, l] of parDossier(devis)) {
    if (l.some((f) => decisionDe(f) === 'mis_de_cote') && !l.some((f) => decisionDe(f) === 'retenu')) ids.add(id)
  }
  for (const [id, l] of parDossier(offresPlat(fichiers))) {
    if (l.some((o) => o.etat === 'reportee') && !l.some((o) => o.etat === 'retenue')) ids.add(id)
  }
  return ids
}

/** Potentiel ouvert (par offre) : mêmes agrégats que la RPC. */
export function potentiel(fichiers) {
  const offres = offresPlat(fichiers)
  const ouvertes = offres.filter((o) => o.etat === 'a_trancher')
  const parDevis = new Map()
  for (const o of ouvertes) parDevis.set(o.fichier_id, [...(parDevis.get(o.fichier_id) ?? []), o])
  const reportees = offres.filter((o) => o.etat === 'reportee')
  const somme = (l) => l.reduce((t, o) => t + (Number(o.montant) || 0), 0)
  return {
    aTrancher: {
      offres: ouvertes.length,
      devis: parDevis.size,
      dossiers: new Set(ouvertes.map((o) => o.dossier_id)).size,
      montantMin: [...parDevis.values()].reduce((t, l) => t + Math.min(...l.map((o) => Number(o.montant) || 0)), 0),
    },
    reportees: {
      offres: reportees.length,
      devis: new Set(reportees.map((o) => o.fichier_id)).size,
      dossiers: new Set(reportees.map((o) => o.dossier_id)).size,
      montant: somme(reportees),
    },
  }
}

/**
 * Écriture d'un jeu d'offres : recalcule tout ce qui en découle sur le devis — offres
 * retenues, montant (somme des TTC retenus : « HT » converti par la TVA), décision du
 * devis dérivée. Écriture absolue : rejouable sans doublon par la file hors-ligne.
 * Décision du devis : une offre retenue → retenu ; sinon une offre à trancher → à
 * trancher ; sinon une offre reportée → mis de côté ; sinon (toutes écartées) → alternative.
 */
export function champsApresOffres(variantes) {
  const retenues = variantes.map((v, i) => [v, i]).filter(([v]) => v.etat === 'retenue')
  const total = retenues.length
    ? Math.round(retenues.reduce((t, [v]) => t + ttcOffre({ montant_ttc: v.montant_ttc }, v.base === 'ht' ? 'ht' : 'ttc'), 0) * 100) / 100
    : null
  const decision = retenues.length
    ? 'retenu'
    : variantes.some((v) => v.etat === 'a_trancher')
      ? 'a_trancher'
      : variantes.some((v) => v.etat === 'reportee')
        ? 'mis_de_cote'
        : 'alternative'
  const reprises = variantes.filter((v) => v.etat === 'reportee' && v.date_reprise).map((v) => v.date_reprise).sort()
  const champs = {
    variantes,
    variantes_retenues: retenues.length ? retenues.map(([, i]) => i) : null,
    variante_retenue: retenues.length ? retenues[0][1] : null,
    montant_ttc: total,
    analyse_erreur: null,
    ...champsDecision(decision, { date_reprise: reprises[0] ?? null }),
  }
  if (retenues.length && retenues.every(([v]) => v.base === 'ht')) {
    champs.montant_ht = retenues.reduce((t, [v]) => t + v.montant_ttc, 0)
  } else if (retenues.length && retenues.some(([v]) => v.base)) {
    // Bases HT et TTC mélangées : un « montant HT » unique n'a plus de sens.
    champs.montant_ht = null
  }
  return champs
}

/** Change l'état d'une offre (et sa base HT/TTC ou sa date de reprise) ; renvoie les champs à écrire. */
export function champsEtatOffre(f, i, etat, extras = {}) {
  const variantes = variantesDe(f).map((v, j) => {
    const courant = offresDe(f)[j]
    const base = { ...v, etat: courant.etat, ...(courant.projet ? { projet: courant.projet } : {}) }
    if (j !== i) return base
    const suivant = { ...base, etat }
    if (etat === 'retenue' && extras.base) suivant.base = extras.base
    if (etat === 'reportee') {
      if (extras.date_reprise) suivant.date_reprise = extras.date_reprise
      else delete suivant.date_reprise
    } else delete suivant.date_reprise
    return suivant
  })
  return champsApresOffres(variantes)
}

/** Étiquette de projet d'une offre (texte court) : ne change ni état ni montant. */
export function champsProjetOffre(f, i, projet) {
  const texte = String(projet ?? '').trim().slice(0, 30)
  const variantes = variantesDe(f).map((v, j) => {
    if (j !== i) return v
    const { projet: _ancien, ...reste } = v
    return texte ? { ...reste, projet: texte } : reste
  })
  return { variantes }
}

/** Sous-totaux par étiquette de projet : retenu (TTC), à trancher, reportée, écartée. Vide sans étiquette. */
export function sousTotauxProjets(fichiers) {
  const offres = offresPlat(fichiers).filter((o) => o.i != null)
  if (!offres.some((o) => o.projet)) return []
  const groupes = new Map()
  for (const o of offres) {
    const cle = o.projet || 'Sans projet'
    const g = groupes.get(cle) ?? { projet: cle, retenu: 0, a_trancher: 0, reportee: 0, ecartee: 0, offres: 0 }
    const ttc = o.etat === 'retenue' ? ttcOffre({ montant_ttc: o.montant }, o.base === 'ht' ? 'ht' : 'ttc') : Number(o.montant) || 0
    g[o.etat === 'retenue' ? 'retenu' : o.etat] += ttc
    g.offres += 1
    groupes.set(cle, g)
  }
  return [...groupes.values()].sort((a, b) => (a.projet === 'Sans projet') - (b.projet === 'Sans projet') || a.projet.localeCompare(b.projet))
}
