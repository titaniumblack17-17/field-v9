// Regroupement des étapes du Pipeline projet en 6 familles, dans l'ordre actuel
// des colonnes. « Dossier perdu » et « Terminé » n'en font pas partie : un projet
// actif est un projet ni perdu ni terminé (comme la pastille Projet du Pipeline).
// Ce regroupement est dupliqué dans la RPC dashboard_chiffres() ; un test
// compare les deux.
export const FAMILLES = [
  { cle: 'qualification', libelle: 'Qualification', couleur: '#8B92FF', etapes: ['a_classer', 'prospect', 'prise_contact'] },
  { cle: 'devis', libelle: 'Devis', couleur: '#C084FC', etapes: ['devis_a_faire', 'devis_envoye', 'relance'] },
  { cle: 'negociation', libelle: 'Négociation', couleur: '#22D3EE', etapes: ['visite_local', 'negociation', 'confirmation'] },
  { cle: 'commande', libelle: 'Commande', couleur: '#F5B94A', etapes: ['financement', 'commande'] },
  { cle: 'chantier', libelle: 'Chantier', couleur: '#4ADE80', etapes: ['reunion_chantier', 'installation'] },
  { cle: 'finition', libelle: 'Finition', couleur: '#FF7A7A', etapes: ['finition', 'sav'] },
]

export const COULEURS_OBJECTIF = { signe: '#8B92FF', aTrancher: '#F5B94A', reporte: '#8B8B93', reste: '#2A2C33' }
export const COULEUR_PIPELINE = '#22D3EE'

export const familleDe = (statut) => FAMILLES.find((f) => f.etapes.includes(statut)) ?? null

/** Projet actif : ni perdu ni terminé, rattaché à une famille d'étapes (même définition que la RPC dashboard_chiffres()). */
export const estProjetActif = (d) =>
  d?.type === 'projet' && d.statut !== 'perdu' && d.statut !== 'termine' && familleDe(d.statut) != null

/** Fichiers des seuls projets actifs : le potentiel ouvert (à trancher, offres reportées) ne compte rien d'autre. */
export const fichiersDesProjetsActifs = (fichiers, dossiers) => {
  const ids = new Set(dossiers.filter(estProjetActif).map((d) => d.id))
  return fichiers.filter((f) => ids.has(f.dossier_id))
}
