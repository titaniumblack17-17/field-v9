#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import {
  parserVCards,
  clefTelephone,
  estNumeroFR,
  extraireContact,
  formaterTelephone,
  normaliser,
} from './lib/vcard.mjs'

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

// Un nom de famille seul (sans prénom sur la fiche Field) rapproche parfois
// plusieurs contacts du carnet sans lien entre eux — de la famille, un
// ancien numéro, une fiche en double. Regrouper les candidats PAR CLIENT ET
// PAR CHAMP avant d'écrire permet de s'en apercevoir : si toutes les
// correspondances s'accordent sur une valeur, elle est sûre ; si elles se
// contredisent, mieux vaut ne rien écrire qu'un numéro pris au hasard.
const candidatsParClient = new Map() // id -> { nom, champs: { colonne -> Map(clef -> valeurOriginale) } }
let nbRapproches = 0

const clefDe = (colonne, valeur) =>
  colonne === 'telephone_portable' || colonne === 'telephone_cabinet'
    ? clefTelephone(valeur)
    : normaliser(valeur)

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

  let entree = candidatsParClient.get(correspond.id)
  if (!entree) {
    entree = {
      nom: `${correspond.prenom_praticien ?? ''} ${correspond.nom_praticien}`.trim(),
      champs: {},
      existant: correspond,
    }
    candidatsParClient.set(correspond.id, entree)
  }

  for (const champ of CHAMPS) {
    const valeur = contact[champ]
    const colonne = COLONNE[champ]
    if (!valeur || correspond[colonne]) continue // déjà rempli sur la fiche : jamais écrasé
    if (!entree.champs[colonne]) entree.champs[colonne] = new Map()
    const clef = clefDe(colonne, valeur)
    if (!entree.champs[colonne].has(clef)) {
      entree.champs[colonne].set(
        clef,
        colonne.startsWith('telephone') ? formaterTelephone(valeur) : valeur
      )
    }
  }
}

// Un numéro/email proposé pour un champ qui EXISTE DÉJÀ, à l'identique,
// sur le champ jumeau de la même fiche (portable/cabinet, email/pro) sent
// le doublon ou le mauvais classement plutôt qu'une vraie information
// manquante — on ne l'écrit pas sans un coup d'œil.
const PAIRES = {
  telephone_portable: 'telephone_cabinet',
  telephone_cabinet: 'telephone_portable',
  email: 'email_cabinet',
  email_cabinet: 'email',
}
const dejaSurChampJumeau = (colonne, valeur, existant) => {
  const jumelle = PAIRES[colonne]
  if (!jumelle || !existant[jumelle]) return false
  const clef = colonne.startsWith('telephone') ? clefTelephone : normaliser
  return clef(valeur) === clef(existant[jumelle])
}

const misesAJour = []
const ambigus = []
const suspects = []

for (const [id, { nom, champs, existant }] of candidatsParClient) {
  const update = {}
  const conflits = []
  const raisonsSuspectes = []
  for (const [colonne, candidats] of Object.entries(champs)) {
    if (candidats.size === 1) {
      const valeur = [...candidats.values()][0]
      if (colonne.startsWith('telephone') && !estNumeroFR(valeur)) {
        raisonsSuspectes.push(`${colonne} : ${valeur} (numéro non français — rapprochement possiblement erroné)`)
      } else if (dejaSurChampJumeau(colonne, valeur, existant)) {
        raisonsSuspectes.push(
          `${colonne} : ${valeur} (identique au ${PAIRES[colonne]} déjà sur la fiche — doublon ou mauvais champ probable)`
        )
      } else {
        update[colonne] = valeur
      }
    } else {
      conflits.push(`${colonne} : ${[...candidats.values()].join(' / ')}`)
    }
  }
  // Un numéro non français, ou un homonyme prouvé par ailleurs (un champ en
  // conflit pour ce même nom — preuve que plusieurs personnes distinctes du
  // carnet portent ce nom), fait douter de tout le rapprochement pour cette
  // fiche, pas seulement du champ en cause : on retient alors TOUS les
  // champs proposés plutôt que d'appliquer les autres à moitié en se fiant
  // à une correspondance douteuse.
  if (raisonsSuspectes.length) {
    suspects.push({ nom, raisons: raisonsSuspectes })
  } else if (conflits.length && Object.keys(update).length) {
    suspects.push({
      nom,
      raisons: Object.entries(update).map(
        ([k, v]) => `${k} : ${v} (homonyme confirmé par ailleurs sur ce nom — rapprochement jugé incertain)`
      ),
    })
  } else if (Object.keys(update).length) {
    misesAJour.push({ id, nom, update })
  }
  if (conflits.length) ambigus.push({ nom, conflits })
}

console.log(
  `${nbRapproches} contact${nbRapproches > 1 ? 's' : ''} du carnet rapproché${nbRapproches > 1 ? 's' : ''} à ${candidatsParClient.size} fiche${candidatsParClient.size > 1 ? 's' : ''} Field, ${misesAJour.length} avec au moins un champ à compléter sans ambiguïté.\n`
)

for (const { nom, update } of misesAJour) {
  console.log(`${nom} :`)
  for (const [k, v] of Object.entries(update)) console.log(`  ${k} → ${v}`)
}

if (ambigus.length) {
  console.log(
    `\n⚠ ${ambigus.length} fiche${ambigus.length > 1 ? 's' : ''} avec un champ ambigu (plusieurs valeurs différentes trouvées pour le même nom dans le carnet) — non complété${ambigus.length > 1 ? 's' : ''} automatiquement, à vérifier à la main :\n`
  )
  for (const { nom, conflits } of ambigus) {
    console.log(`${nom} :`)
    for (const c of conflits) console.log(`  ${c}`)
  }
}

if (suspects.length) {
  console.log(
    `\n⚠ ${suspects.length} fiche${suspects.length > 1 ? 's' : ''} avec un numéro suspect (rapprochement homonyme possiblement erroné) — non complété${suspects.length > 1 ? 's' : ''} automatiquement, à vérifier à la main :\n`
  )
  for (const { nom, raisons } of suspects) {
    console.log(`${nom} :`)
    for (const r of raisons) console.log(`  ${r}`)
  }
}

if (!misesAJour.length) {
  console.log('\nRien à compléter sans ambiguïté.')
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
