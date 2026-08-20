export const TYPE_LABELS = { projet: 'Projet de vente', sav: 'SAV', plan: 'Plan / cahier des charges' }

export const ETAPES_PROJET = [
  ['prospect', 'Prospect'],
  ['prise_contact', 'Prise de contact'],
  ['devis_a_faire', 'Devis à faire'],
  ['devis_envoye', 'Devis envoyé'],
  ['relance', 'Relance'],
  ['visite_local', 'Visite local'],
  ['confirmation', 'Confirmation'],
  ['commande', 'Commande'],
  ['reunion_chantier', 'Réunion de chantier'],
  ['installation', 'Installation'],
  ['finition', 'Finition'],
  ['financement', 'Financement'],
  ['perdu', 'Dossier perdu'],
  ['sav', 'SAV'],
]

export const STATUTS_SAV = [
  ['ouvert', 'Ouvert'],
  ['clos', 'Clos'],
]

export const REMUNERATION = {
  facture: 'Facturé 500 € TTC',
  integre: 'Intégré au suivi normal',
  partage: 'Partagé avec un collègue',
}

export const REMUNERATION_OPTIONS = [
  ['facture', 'Facturé 500 € TTC'],
  ['integre', 'Intégré au suivi normal'],
  ['partage', 'Partagé avec un collègue'],
]

// Liseré / code couleur du dossier (spec §4.2). Palette reprise de l'ancien
// Kanban pour rester cohérente avec ce que Bruce connaît déjà.
const STYLES_TYPE = {
  projet: { bordure: '#378ADD', fond: '#E6F1FB', texte: '#0C447C', badge: 'Projet' },
  sav: { bordure: '#C2740A', fond: '#FAEEDA', texte: '#633806', badge: 'SAV' },
  plan: { bordure: '#5A8F2A', fond: '#EAF3DE', texte: '#27500A', badge: 'Plan' },
}

// Pour un Plan, c'est le type de rémunération qui porte l'information utile :
// le liseré la rend lisible sans ouvrir la fiche.
const STYLES_PLAN = {
  facture: { bordure: '#5A8F2A', fond: '#EAF3DE', texte: '#27500A', badge: 'Plan facturé' },
  integre: { bordure: '#0F766E', fond: '#DCF2EF', texte: '#0B4F4A', badge: 'Plan intégré' },
  partage: { bordure: '#7C3AED', fond: '#EDE7FB', texte: '#4C1D95', badge: 'Plan partagé' },
}

export function styleDossier(dossier) {
  if (dossier?.type === 'plan') {
    return STYLES_PLAN[dossier.remuneration_type] ?? STYLES_TYPE.plan
  }
  return STYLES_TYPE[dossier?.type] ?? STYLES_TYPE.projet
}
