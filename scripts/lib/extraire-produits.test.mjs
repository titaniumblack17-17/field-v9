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
