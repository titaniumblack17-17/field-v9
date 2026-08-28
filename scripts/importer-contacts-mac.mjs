#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// Contacts.app (macOS) → Fichier → Exporter → Exporter vCard, sur la sélection
// ou tout le carnet. Ce script comble les champs vides des fiches Field —
// jamais d'écrasement d'une valeur déjà saisie, même différente de celle du
// carnet d'adresses : la fiche Field fait autorité une fois renseignée.
//
// Aperçu par défaut (rien n'est écrit) ; --appliquer pour enregistrer.

const cheminFichier = process.argv[2]
const appliquer = process.argv.includes('--appliquer')

if (!cheminFichier) {
  console.error('Usage : node scripts/importer-contacts-mac.mjs "<export.vcf>" [--appliquer]')
  console.error("Sans --appliquer : affiche ce qui serait complété, sans toucher à la base.")
  process.exit(1)
}

const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env
if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
  console.error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis (fichier .env).')
  process.exit(1)
}

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)

// --- Lecture vCard ---
// Une ligne qui commence par une espace ou une tabulation est la suite de la
// précédente (RFC 6350, "line folding") — un standard qu'Apple applique sur
// les valeurs longues (ex. une adresse complète).
const deplierLignes = (texte) =>
  texte.split(/\r\n|\r|\n/).reduce((lignes, ligne) => {
    if (/^[ \t]/.test(ligne) && lignes.length) {
      lignes[lignes.length - 1] += ligne.slice(1)
    } else {
      lignes.push(ligne)
    }
    return lignes
  }, [])

const parserLigne = (ligne) => {
  const deuxPoints = ligne.indexOf(':')
  if (deuxPoints === -1) return null
  const avant = ligne.slice(0, deuxPoints)
  const valeur = ligne.slice(deuxPoints + 1)
  const [nomBrut, ...params] = avant.split(';')
  const nom = nomBrut.toUpperCase()
  const types = params
    .filter((p) => /^type=/i.test(p))
    .flatMap((p) => p.slice(5).split(','))
    .map((t) => t.toUpperCase())
  return { nom, types, valeur }
}

const parserVCards = (texte) => {
  const lignes = deplierLignes(texte)
  const cartes = []
  let courante = null
  for (const ligneBrute of lignes) {
    const ligne = ligneBrute.trim()
    if (/^BEGIN:VCARD$/i.test(ligne)) {
      courante = []
      continue
    }
    if (/^END:VCARD$/i.test(ligne)) {
      if (courante) cartes.push(courante)
      courante = null
      continue
    }
    if (!courante) continue
    const champ = parserLigne(ligne)
    if (champ) courante.push(champ)
  }
  return cartes
}

const chiffres = (v) => (v ?? '').replace(/\D/g, '')

// Un contact peut porter plusieurs TEL/EMAIL avec des TYPE différents — on
// devine portable/cabinet par l'étiquette Apple, avec un repli raisonnable
// si aucune étiquette ne tranche (le premier numéro devient le portable,
// le second le fixe).
const extraireContact = (champs) => {
  const val = (nom) => champs.find((c) => c.nom === nom)?.valeur?.trim() || null

  const tousTels = champs.filter((c) => c.nom === 'TEL')
  const portable =
    tousTels.find((c) => c.types.some((t) => ['CELL', 'IPHONE', 'MOBILE'].includes(t))) ?? tousTels[0]
  const fixe =
    tousTels.find((c) => c !== portable && c.types.includes('WORK')) ??
    tousTels.find((c) => c !== portable)

  const tousEmails = champs.filter((c) => c.nom === 'EMAIL')
  const emailPerso = tousEmails.find((c) => !c.types.includes('WORK')) ?? tousEmails[0]
  const emailPro = tousEmails.find((c) => c !== emailPerso && c.types.includes('WORK'))

  // ADR: boîte postale;complément;rue;ville;région;code postal;pays
  const adr = champs.find((c) => c.nom === 'ADR')
  let adresse = null
  let ville = null
  let codePostal = null
  if (adr) {
    const parties = adr.valeur.split(';')
    adresse = [parties[2], parties[1]].filter(Boolean).join(' ').trim() || null
    ville = parties[3]?.trim() || null
    codePostal = parties[5]?.trim() || null
  }

  // N: Nom;Prénom;deuxième prénom;particule;suffixe — repli sur FN (nom
  // complet affiché) si N est absent, en supposant "Prénom Nom".
  const n = val('N')
  let nomFamille = null
  let prenom = null
  if (n) {
    const [nf, pr] = n.split(';')
    nomFamille = nf?.trim() || null
    prenom = pr?.trim() || null
  }
  if (!nomFamille) {
    const fn = val('FN')
    if (fn) {
      const mots = fn.trim().split(/\s+/)
      nomFamille = mots.length > 1 ? mots.slice(1).join(' ') : mots[0]
      prenom = mots.length > 1 ? mots[0] : null
    }
  }

  return {
    nomFamille,
    prenom,
    telephonePortable: portable ? chiffresEnNumero(portable.valeur) : null,
    telephoneCabinet: fixe ? chiffresEnNumero(fixe.valeur) : null,
    email: emailPerso?.valeur || null,
    email_cabinet: emailPro?.valeur || null,
    adresse,
    ville,
    code_postal: codePostal,
  }
}

// Un numéro non-français (pas 10 chiffres) est extrait tel quel plutôt que
// rejeté : contrairement à la dictée, une entrée de carnet d'adresses n'a
// pas de raison d'être mal transcrite, et rejeter par principe perdrait des
// numéros valides à l'étranger.
const chiffresEnNumero = (v) => {
  const digits = chiffres(v)
  return digits.length >= 8 ? v.trim() : null
}

const normaliser = (v) =>
  (v ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const { data: clients, error: erreurClients } = await supabase
  .from('clients')
  .select(
    'id, nom_praticien, prenom_praticien, adresse, ville, code_postal, telephone_portable, telephone_cabinet, email, email_cabinet'
  )

if (erreurClients) {
  console.error('Impossible de lire les fiches clients :', erreurClients.message)
  process.exit(1)
}

const texteVCard = readFileSync(cheminFichier, 'utf8')
const cartes = parserVCards(texteVCard)
console.log(`${cartes.length} contact${cartes.length > 1 ? 's' : ''} lu${cartes.length > 1 ? 's' : ''} dans l'export.`)

const CHAMPS = [
  'telephonePortable',
  'telephoneCabinet',
  'email',
  'email_cabinet',
  'adresse',
  'ville',
  'code_postal',
]
// Le contact vCard nomme ses champs en camelCase (portable/cabinet), la
// fiche client en colonnes snake_case — cette table fait la correspondance
// une seule fois plutôt que de la répéter à chaque comblement.
const COLONNE = {
  telephonePortable: 'telephone_portable',
  telephoneCabinet: 'telephone_cabinet',
  email: 'email',
  email_cabinet: 'email_cabinet',
  adresse: 'adresse',
  ville: 'ville',
  code_postal: 'code_postal',
}

let nbRapproches = 0
const misesAJour = []

for (const champsVCard of cartes) {
  const contact = extraireContact(champsVCard)
  if (!contact.nomFamille) continue

  const n = normaliser(contact.nomFamille)
  const p = normaliser(contact.prenom)
  // Même règle de rapprochement que la capture par dictée : les prénoms
  // doivent concorder, ou l'un des deux être absent — deux praticiens
  // homonymes aux prénoms différents ne doivent jamais se confondre.
  const correspond = clients.find((c) => {
    if (normaliser(c.nom_praticien) !== n) return false
    const cp = normaliser(c.prenom_praticien)
    return !cp || !p || cp === p
  })
  if (!correspond) continue
  nbRapproches++

  const update = {}
  for (const champ of CHAMPS) {
    const valeur = contact[champ]
    const colonne = COLONNE[champ]
    if (valeur && !correspond[colonne]) update[colonne] = valeur
  }

  if (Object.keys(update).length) {
    misesAJour.push({
      id: correspond.id,
      nom: `${correspond.prenom_praticien ?? ''} ${correspond.nom_praticien}`.trim(),
      update,
    })
  }
}

console.log(
  `${nbRapproches} contact${nbRapproches > 1 ? 's' : ''} rapproché${nbRapproches > 1 ? 's' : ''} d'une fiche existante, ${misesAJour.length} avec au moins un champ à compléter.\n`
)

for (const { nom, update } of misesAJour) {
  console.log(`${nom} :`)
  for (const [k, v] of Object.entries(update)) console.log(`  ${k} → ${v}`)
}

if (!misesAJour.length) {
  console.log('Rien à compléter.')
  process.exit(0)
}

if (!appliquer) {
  console.log('\nAperçu seulement, rien n\'a été écrit. Relancer avec --appliquer pour enregistrer.')
  process.exit(0)
}

let nbEchecs = 0
for (const { id, update } of misesAJour) {
  const { error } = await supabase.from('clients').update(update).eq('id', id)
  if (error) {
    nbEchecs++
    console.error(`Échec pour ${id} :`, error.message)
  }
}

console.log(`\n${misesAJour.length - nbEchecs} fiche${misesAJour.length - nbEchecs > 1 ? 's' : ''} complétée${misesAJour.length - nbEchecs > 1 ? 's' : ''}.`)
