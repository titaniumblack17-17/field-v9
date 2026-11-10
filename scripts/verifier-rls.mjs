// Vérification du temps B : avec la clé publique SEULE, chaque table doit renvoyer [] ou une erreur — jamais des lignes.
// ⚠ NE PAS LANCER avant le feu vert de Bruce : ce script interroge la base de production (lecture seule, limit=1).
//   node scripts/verifier-rls.mjs               → toutes les tables
//   node scripts/verifier-rls.mjs produits      → seulement celles nommées (à lancer après chaque bascule)
// Avant la première bascule, il affichera « OUVERTE » partout : c'est normal. Code de sortie 1 si une table vérifiée est ouverte.
import dotenv from 'dotenv'
import { TABLES_PROTEGEES, jugerReponse } from './lib/verifier-rls.mjs'

dotenv.config({ quiet: true })
const URL_DB = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY // volontairement PAS la clé de service
if (!URL_DB || !ANON) { console.error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY requis (.env).'); process.exit(2) }

const demandees = process.argv.slice(2)
const inconnues = demandees.filter((t) => !TABLES_PROTEGEES.includes(t))
if (inconnues.length) { console.error(`Table(s) inconnue(s) : ${inconnues.join(', ')}`); process.exit(2) }
const tables = demandees.length ? demandees : TABLES_PROTEGEES

let ouvertes = 0
for (const t of tables) {
  let verdict
  try {
    const r = await fetch(`${URL_DB}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
    verdict = jugerReponse(r.status, await r.text())
  } catch (e) {
    verdict = { ferme: false, detail: `requête impossible : ${e.message}` } // ni succès ni échec avéré : traité comme à examiner
  }
  if (!verdict.ferme) ouvertes++
  console.log(`${verdict.ferme ? 'FERMÉE ' : 'OUVERTE'}  ${t.padEnd(32)} ${verdict.detail}`)
}
console.log(ouvertes ? `\n✗ ${ouvertes} table(s) ouverte(s) ou à examiner sur ${tables.length}` : `\n✓ ${tables.length} table(s) fermée(s) à la clé publique`)
process.exit(ouvertes ? 1 : 0)
