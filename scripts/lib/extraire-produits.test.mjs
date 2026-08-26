import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extraireProduitsDeFeuille } from './extraire-produits.mjs'

test('extrait une ligne produit simple avec prix conseillé et offre', () => {
  const lignes = [
    ['DEVIS '],
    [],
    [
      'Code',
      'Désignation',
      'Instruction',
      'Qté',
      'Tarif des prix de revente conseillés net',
      'Offre valable du 01/07/2026 au 30/09/2026',
    ],
    ['FE005246', 'Planmeca Viso G1', null, null, 97737, 45850],
  ]
  const produits = extraireProduitsDeFeuille(lignes)
  assert.deepEqual(produits, [
    {
      code: 'FE005246',
      designation: 'Planmeca Viso G1',
      instruction: null,
      prixConseille: 97737,
      prixOffre: 45850,
      offrePeriode: 'Offre valable du 01/07/2026 au 30/09/2026',
    },
  ])
})

test('une ligne sans offre en cours a un prix et une période nuls', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    ['FE004204', 'Résolution endodontique', null, null, 4486, null],
  ]
  const [produit] = extraireProduitsDeFeuille(lignes)
  assert.equal(produit.prixOffre, null)
  assert.equal(produit.offrePeriode, null)
})

test('garde l\'instruction quand elle est présente', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    [
      'FE005247',
      'Céphalostat Planmeca ProCeph A',
      'Prix valable uniquement avec achat de matériel neuf',
      null,
      39895,
      16920,
    ],
  ]
  const [produit] = extraireProduitsDeFeuille(lignes)
  assert.equal(produit.instruction, 'Prix valable uniquement avec achat de matériel neuf')
})

test('ignore les lignes de titre de section sans code ni prix', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    ['Planmeca Viso G1', null, null, null, null, null],
    ['1. Supports du patient supplémentaires', null, null, null, null, null],
    ['FE004174', 'Planmeca CALM', null, null, 1855, null],
  ]
  const produits = extraireProduitsDeFeuille(lignes)
  assert.equal(produits.length, 1)
  assert.equal(produits[0].code, 'FE004174')
})

test('ignore la ligne de totaux sans code juste après l\'en-tête', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    [null, null, null, null, null, null, 0, 0, 0, 0],
    ['FE004174', 'Planmeca CALM', null, null, 1855, null],
  ]
  const produits = extraireProduitsDeFeuille(lignes)
  assert.equal(produits.length, 1)
})

test('accepte un code numérique (Excel sans zéro non significatif)', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    [30006504, 'Tabouret Planmeca Lumo', 'Prix spécial avec l\'unit 3D', null, 1166, null],
  ]
  const [produit] = extraireProduitsDeFeuille(lignes)
  assert.equal(produit.code, '30006504')
})

test('renvoie un tableau vide si aucune ligne d\'en-tête « Code » n\'est trouvée', () => {
  const lignes = [
    ['Offre_Reprise', 'G1'],
    ['Oui', 45385],
    ['Non', 48462],
  ]
  assert.deepEqual(extraireProduitsDeFeuille(lignes), [])
})

// Deux feuilles du tarif (« TPMOY Equipements », « TPMOY Retrofits ») utilisent
// un second format d'en-tête, distinct du format « Code » habituel : la ligne
// d'en-tête commence par « Feature » au lieu de « Code », et ce format n'a
// jamais de colonne d'offre (prixOffre et offrePeriode sont donc toujours nuls).
test('extrait les produits d\'un en-tête « Feature » à 4 colonnes, avec instruction présente ou absente', () => {
  const lignes = [
    ['Feature', 'Description', 'Instructions, comments', 'Price €'],
    [
      'FE005211',
      'PlanCAD Premium Full',
      'Licence incluant tous les modules disponibles',
      19148,
    ],
    [
      30047801,
      'Mise à niveau annuelle PlanCAD Premium Full',
      'Contrat de mise à niveau annuel',
      3911,
    ],
    ['FE003700', 'PlanCAD Premium – module Bite Splint', null, 2119],
  ]
  const produits = extraireProduitsDeFeuille(lignes)
  assert.deepEqual(produits, [
    {
      code: 'FE005211',
      designation: 'PlanCAD Premium Full',
      instruction: 'Licence incluant tous les modules disponibles',
      prixConseille: 19148,
      prixOffre: null,
      offrePeriode: null,
    },
    {
      code: '30047801',
      designation: 'Mise à niveau annuelle PlanCAD Premium Full',
      instruction: 'Contrat de mise à niveau annuel',
      prixConseille: 3911,
      prixOffre: null,
      offrePeriode: null,
    },
    {
      code: 'FE003700',
      designation: 'PlanCAD Premium – module Bite Splint',
      instruction: null,
      prixConseille: 2119,
      prixOffre: null,
      offrePeriode: null,
    },
  ])
})

test('extrait les produits d\'un en-tête « Feature » à 3 colonnes (sans colonne instruction, prix en colonne 2)', () => {
  const lignes = [
    ['Feature', 'Description', 'Price €'],
    ['FE003462', 'Seringue Luzzani Minibright à 6 fonctions avec LED', 1383],
    ['FE001233', 'Seringue Luzzani Ergo 3 fonctions', 725],
  ]
  const produits = extraireProduitsDeFeuille(lignes)
  assert.deepEqual(produits, [
    {
      code: 'FE003462',
      designation: 'Seringue Luzzani Minibright à 6 fonctions avec LED',
      instruction: null,
      prixConseille: 1383,
      prixOffre: null,
      offrePeriode: null,
    },
    {
      code: 'FE001233',
      designation: 'Seringue Luzzani Ergo 3 fonctions',
      instruction: null,
      prixConseille: 725,
      prixOffre: null,
      offrePeriode: null,
    },
  ])
})
