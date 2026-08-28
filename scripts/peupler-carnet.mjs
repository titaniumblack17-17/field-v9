#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { parserVCards, extraireContact, formaterTelephone, normaliser, estNumeroFR } from './lib/vcard.mjs'

// Peuple la table carnet_contacts à partir d'un export vCard de Contacts.app
// (macOS) — carnet de référence PERSISTANT, distinct des fiches clients :
// une fois peuplé, capture-intake s'en sert pour compléter automatiquement
// les fiches créées par dictée (numéro, adresse…) sans que Bruce ait à le
// réclamer. Voir importer-contacts-mac.mjs pour le comblement ponctuel des
// fiches déjà existantes.
//
// Remplace intégralement le contenu de la table à chaque exécution (on
// repart d'un export à jour plutôt que d'accumuler des doublons au fil des
// ré-exports) : pas de --appliquer, ce script écrit toujours.

const cheminFichier = process.argv[2]
if (!cheminFichier) {
  console.error('Usage : node scripts/peupler-carnet.mjs "<export.vcf>"')
  process.exit(1)
}

const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env
if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
  console.error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis (fichier .env).')
  process.exit(1)
}

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)

const texteVCard = readFileSync(cheminFichier, 'utf8')
const cartes = parserVCards(texteVCard)
console.log(`${cartes.length} contact${cartes.length > 1 ? 's' : ''} lu${cartes.length > 1 ? 's' : ''} dans l'export.`)

const lignes = []
for (const champsVCard of cartes) {
  const c = extraireContact(champsVCard)
  if (!c.nomFamille) continue

  // Un numéro qui ne colle pas au format français est conservé tel quel
  // dans le carnet (utile pour un contact vraiment à l'étranger) mais
  // capture-intake ne le proposera jamais pour une fiche Field — le filtre
  // s'applique à la lecture, pas à l'écriture ici.
  lignes.push({
    nom_famille: c.nomFamille,
    prenom: c.prenom,
    nom_normalise: normaliser(c.nomFamille),
    prenom_normalise: c.prenom ? normaliser(c.prenom) : null,
    telephone_portable: c.telephonePortable
      ? estNumeroFR(c.telephonePortable)
        ? formaterTelephone(c.telephonePortable)
        : c.telephonePortable.trim()
      : null,
    telephone_cabinet: c.telephoneCabinet
      ? estNumeroFR(c.telephoneCabinet)
        ? formaterTelephone(c.telephoneCabinet)
        : c.telephoneCabinet.trim()
      : null,
    email: c.email,
    email_cabinet: c.email_cabinet,
    adresse: c.adresse,
    ville: c.ville,
    code_postal: c.code_postal,
  })
}

console.log(`${lignes.length} contact${lignes.length > 1 ? 's' : ''} avec un nom exploitable, à enregistrer.`)

const { error: erreurVidage } = await supabase.from('carnet_contacts').delete().not('id', 'is', null)
if (erreurVidage) {
  console.error('Impossible de vider le carnet existant :', erreurVidage.message)
  process.exit(1)
}

const TAILLE_LOT = 500
let ecrites = 0
for (let i = 0; i < lignes.length; i += TAILLE_LOT) {
  const lot = lignes.slice(i, i + TAILLE_LOT)
  const { error } = await supabase.from('carnet_contacts').insert(lot)
  if (error) {
    console.error(`Échec sur le lot ${i}-${i + lot.length} :`, error.message)
    process.exit(1)
  }
  ecrites += lot.length
}

console.log(`${ecrites} contact${ecrites > 1 ? 's' : ''} enregistré${ecrites > 1 ? 's' : ''} dans le carnet.`)
