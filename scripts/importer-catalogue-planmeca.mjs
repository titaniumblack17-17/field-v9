#!/usr/bin/env node
import { basename } from 'node:path'
import 'dotenv/config'
import XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { extraireProduitsDeFeuille } from './lib/extraire-produits.mjs'

const MARQUE = 'Planmeca'
// Feuille de métadonnées internes (barème remise/reprise), sans ligne de
// produit — la faire analyser ne casserait rien (extraireProduitsDeFeuille
// renverrait []), mais l'ignorer explicitement évite un avertissement inutile
// dans le résumé affiché en fin d'import.
const FEUILLES_IGNOREES = new Set(['Ressource'])

const cheminFichier = process.argv[2]
if (!cheminFichier) {
  console.error(
    'Usage : node scripts/importer-catalogue-planmeca.mjs "<chemin du fichier tarif>.xlsx"'
  )
  process.exit(1)
}

const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env
if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
  console.error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis (fichier .env).')
  process.exit(1)
}

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)

const classeur = XLSX.readFile(cheminFichier)
const importeLe = new Date().toISOString()
const nomFichier = basename(cheminFichier)

const produits = []
const resumeParFeuille = []

for (const nomFeuille of classeur.SheetNames) {
  if (FEUILLES_IGNOREES.has(nomFeuille)) continue
  const feuille = classeur.Sheets[nomFeuille]
  const lignes = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: null })
  const extraits = extraireProduitsDeFeuille(lignes)
  resumeParFeuille.push([nomFeuille, extraits.length])
  for (const p of extraits) {
    produits.push({
      marque: MARQUE,
      modele: nomFeuille,
      code: p.code,
      designation: p.designation,
      instruction: p.instruction,
      prix_conseille: p.prixConseille,
      prix_offre: p.prixOffre,
      offre_periode: p.offrePeriode,
      fichier_source: nomFichier,
      importe_le: importeLe,
    })
  }
}

console.log(
  `${produits.length} produits extraits de ${classeur.SheetNames.length - FEUILLES_IGNOREES.size} feuilles :`
)
for (const [feuille, n] of resumeParFeuille) {
  console.log(n === 0 ? `  ⚠ ${feuille} : aucun produit (à vérifier si inattendu)` : `  ${feuille} : ${n}`)
}

if (produits.length === 0) {
  console.error('Aucun produit extrait — rien à importer, arrêt sans toucher à la base.')
  process.exit(1)
}

// Réimporter remplace entièrement les produits de la marque (vidage puis
// réinsertion) plutôt qu'une mise à jour ligne par ligne : un produit disparu
// du nouveau tarif disparaît aussi du catalogue, sans laisser de fiche
// périmée invisible.
const { error: erreurSuppression } = await supabase.from('produits').delete().eq('marque', MARQUE)
if (erreurSuppression) {
  console.error('Échec de la suppression des produits existants :', erreurSuppression.message)
  process.exit(1)
}

const TAILLE_LOT = 500
for (let i = 0; i < produits.length; i += TAILLE_LOT) {
  const lot = produits.slice(i, i + TAILLE_LOT)
  const { error } = await supabase.from('produits').insert(lot)
  if (error) {
    console.error(`Échec de l'import du lot ${Math.floor(i / TAILLE_LOT) + 1} :`, error.message)
    process.exit(1)
  }
}

console.log(`Import terminé : ${produits.length} produits Planmeca en base.`)
