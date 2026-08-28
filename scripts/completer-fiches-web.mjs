#!/usr/bin/env node
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// Passe en revue toutes les fiches clients incomplètes et déclenche
// client-web-lookup (édge function, écriture automatique) sur chacune —
// équivalent en lot du bouton « Chercher sur le web » de la fiche.
// À relancer ponctuellement si de nouvelles fiches incomplètes s'accumulent.

const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env
if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
  console.error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis (fichier .env).')
  process.exit(1)
}

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)

const { data: clients, error } = await supabase
  .from('clients')
  .select(
    'id, nom_praticien, prenom_praticien, specialites, adresse, ville, code_postal, telephone_cabinet, email_cabinet'
  )
  .not('nom_praticien', 'is', null)

if (error) {
  console.error('Erreur lecture clients :', error.message)
  process.exit(1)
}

const incomplets = clients.filter(
  (c) =>
    !c.prenom_praticien ||
    !c.specialites?.length ||
    !c.adresse ||
    !c.ville ||
    !c.code_postal ||
    !c.telephone_cabinet ||
    !c.email_cabinet
)

console.log(`${incomplets.length} fiche(s) incomplète(s) sur ${clients.length} à traiter.\n`)

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

// Un lot serré de dizaines d'appels enchaînés sans pause a fait s'effondrer
// la connexion sortante en rafale (« fetch failed » en cascade dès le 7e
// appel lors du premier essai) — un répit entre deux requêtes, et une reprise
// avant d'abandonner, suffisent à éviter ça.
const appeler = async (clientId, tentative = 1) => {
  try {
    const res = await fetch(`${VITE_SUPABASE_URL}/functions/v1/client-web-lookup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${VITE_SUPABASE_ANON_KEY}`,
        apikey: VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ client_id: clientId }),
    })
    const data = await res.json()
    if (!res.ok) return { echec: data.error ?? String(res.status) }
    return { data }
  } catch (e) {
    if (tentative < 3) {
      await attendre(3000 * tentative)
      return appeler(clientId, tentative + 1)
    }
    return { echec: e.message }
  }
}

let traitees = 0
let ecrites = 0
let echecs = 0

for (const c of incomplets) {
  const nom = `${c.prenom_praticien ?? ''} ${c.nom_praticien}`.trim()
  process.stdout.write(`[${traitees + 1}/${incomplets.length}] ${nom}... `)

  const { data, echec } = await appeler(c.id)
  if (echec) {
    console.log(`ÉCHEC (${echec})`)
    echecs++
  } else if (data.ecrit) {
    console.log(`✓ ${data.champsEcrits.join(', ')}`)
    ecrites++
  } else {
    console.log('rien trouvé' + (data.incertitude ? ` — ${data.incertitude.slice(0, 80)}` : ''))
  }
  traitees++

  await attendre(1500)
}

console.log(`\n${traitees} fiches traitées, ${ecrites} complétées, ${echecs} échec(s).`)
