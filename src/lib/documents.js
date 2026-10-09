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

/**
 * Un devis est « à trancher » tant que Bruce n'a pas retenu d'offre alors que
 * plusieurs coexistent, ou qu'un motif de doute (HT/TTC…) est posé sans montant.
 * Un devis dont le TTC est déjà écrit n'est jamais « à trancher ».
 */
export function aTrancher(f) {
  if (!estDevis(f) || f.montant_ttc != null) return false
  return variantesDe(f).length >= 2 || Boolean(f.a_trancher_raison)
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
  return { variante_retenue: i, montant_ttc: v.montant_ttc, a_trancher_raison: null, analyse_erreur: null }
}

/** Remet le devis « à trancher » : l'offre retenue et le montant qui en venait sont retirés. */
export const champsRemiseATrancher = () => ({ variante_retenue: null, montant_ttc: null })
