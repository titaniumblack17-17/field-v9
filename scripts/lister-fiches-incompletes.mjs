#!/usr/bin/env node
import { clientDonnees } from './lib/supabase-env.mjs'

// Imprime "id\tnom" pour chaque fiche incomplète, une par ligne — consommé
// par un script bash qui appelle client-web-lookup via curl (plus fiable
// ici que des fetch() Node enchaînés, qui échouaient en rafale).
const { supabase } = clientDonnees() // clé de service si présente (temps B), sinon clé publique

const { data: clients, error } = await supabase
  .from('clients')
  .select(
    'id, nom_praticien, prenom_praticien, specialites, adresse, ville, code_postal, telephone_cabinet, email_cabinet'
  )
  .not('nom_praticien', 'is', null)

if (error) {
  console.error(error.message)
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

for (const c of incomplets) {
  const nom = `${c.prenom_praticien ?? ''} ${c.nom_praticien}`.trim()
  console.log(`${c.id}\t${nom}`)
}
