export const TYPE_LABELS = { projet: 'Projet de vente', sav: 'SAV', plan: 'Plan / cahier des charges' }

export const TYPE_OPTIONS = [
  ['projet', 'Projet de vente'],
  ['sav', 'SAV'],
  ['plan', 'Plan / cahier des charges'],
]

// Plan d'implantation rattaché à une vente : c'est une tâche du projet, pas un
// dossier à part. Le type « plan » reste réservé aux plans faits pour un autre
// commercial ou en projet partagé, où le plan est la prestation elle-même.
export const PLAN_STATUT_OPTIONS = [
  ['a_faire', 'À faire'],
  ['en_cours', 'En cours'],
  ['fait', 'Fait'],
]

export const PLAN_STATUT_LABELS = Object.fromEntries(PLAN_STATUT_OPTIONS)

// Statut d'accueil quand un dossier change de type : le statut courant
// appartient au vocabulaire de l'ancien type et n'a plus de sens.
// Un projet atterrit dans « À classer » plutôt qu'à une étape arbitraire —
// c'est à Bruce de le situer dans son pipeline.
export const STATUT_PAR_DEFAUT = { projet: 'a_classer', sav: 'ouvert', plan: 'a_planifier' }

export const ETAPES_PROJET = [
  // Colonne d'attente pour les dossiers importés dont l'étape Notion n'avait
  // pas d'équivalent (Négociation, Rendez-vous cabinet). Placée en tête pour
  // rester visible : en fin de pipeline, après 14 colonnes, elle passerait
  // inaperçue.
  ['a_classer', 'À classer'],
  ['prospect', 'Prospect'],
  ['prise_contact', 'Prise de contact'],
  ['devis_a_faire', 'Devis à faire'],
  ['devis_envoye', 'Devis envoyé'],
  ['relance', 'Relance'],
  ['visite_local', 'Visite local'],
  ['negociation', 'Négociation'],
  ['confirmation', 'Confirmation'],
  ['commande', 'Commande'],
  ['reunion_chantier', 'Réunion de chantier'],
  ['installation', 'Installation'],
  ['finition', 'Finition'],
  ['financement', 'Financement'],
  ['perdu', 'Dossier perdu'],
  ['sav', 'SAV'],
]

// Cycle de vie d'un plan, repris du flux Todoist qui le suivait jusqu'ici :
// un plan n'est pas soldé quand il est envoyé, il l'est quand il est réglé.
// Sans ces étapes, un plan livré et jamais payé restait invisible.
export const STATUTS_PLAN = [
  ['a_planifier', 'À planifier'],
  ['en_cours', 'En cours'],
  ['envoye', 'Envoyé'],
  ['installe', 'Installé'],
  ['reglement_demande', 'Règlement demandé'],
  ['solde', 'Soldé'],
]

export const STATUTS_PLAN_LABELS = Object.fromEntries(STATUTS_PLAN)

export const STATUTS_SAV = [
  ['ouvert', 'Ouvert'],
  ['clos', 'Clos'],
]

// Les commerciaux pour qui Bruce produit des plans. BDS, c'est lui : un plan
// à son propre nom est intégré à sa vente, pas facturé.
export const COMMERCIAUX = [
  ['JYM', 'Jean-Yves Mevel'],
  ['AB', 'Alain Bailleul'],
  ['PL', 'Pierre Lecomte'],
  ['PF', 'Paul Fouillet'],
  ['SDR', 'Stéphane Do Rego'],
  ['LG', 'Laurent Gaston'],
  ['DB', 'Didier Bellaz'],
  ['BDS', 'Bruce Da Silva'],
]

export const COMMERCIAUX_LABELS = Object.fromEntries(COMMERCIAUX)

export const COMMERCIAL_OPTIONS = COMMERCIAUX.map(([code, nom]) => [code, `${code} — ${nom}`])

// Un plan encore à produire sans commercial désigné : on sait qu'il y a du
// travail, pas pour qui. C'est la question à poser en premier.
export const PLAN_SANS_COMMERCIAL = (d) =>
  d?.type === 'plan' && !d.commercial && ['a_planifier', 'en_cours'].includes(d.statut)

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
  projet: { bordure: '#FF2D87', fond: '#FFE4F0', texte: '#9D0F55', badge: 'Projet' },
  sav: { bordure: '#FF6A00', fond: '#FFEBD9', texte: '#8A3A00', badge: 'SAV' },
  plan: { bordure: '#5A8F2A', fond: '#EAF3DE', texte: '#27500A', badge: 'Plan' },
}

// Pour un Plan, c'est le type de rémunération qui porte l'information utile :
// le liseré la rend lisible sans ouvrir la fiche.
const STYLES_PLAN = {
  facture: { bordure: '#5A8F2A', fond: '#EAF3DE', texte: '#27500A', badge: 'Plan facturé' },
  integre: { bordure: '#378ADD', fond: '#E6F1FB', texte: '#0C447C', badge: 'Plan intégré' },
  partage: { bordure: '#7C3AED', fond: '#EDE7FB', texte: '#4C1D95', badge: 'Plan partagé' },
}

export function styleDossier(dossier) {
  if (dossier?.type === 'plan') {
    return STYLES_PLAN[dossier.remuneration_type] ?? STYLES_TYPE.plan
  }
  return STYLES_TYPE[dossier?.type] ?? STYLES_TYPE.projet
}
