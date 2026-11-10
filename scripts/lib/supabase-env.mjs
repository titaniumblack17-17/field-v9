// Accès Supabase des scripts hors application (import de contacts, catalogue, fiches…).
//
// Temps B de la sécurité (RLS) : les tables ne seront plus lisibles ni modifiables avec la clé publique (« anon »,
// visible dans l'application). Ces scripts utilisent donc la clé de SERVICE quand elle est présente :
//   SUPABASE_SERVICE_ROLE_KEY dans `.env.local` (ignoré par git — voir .gitignore), JAMAIS dans `.env` ni dans le code,
//   et JAMAIS précédée de VITE_ (une variable VITE_ est embarquée dans l'application publiée).
// Sans clé de service : repli sur la clé publique en LECTURE seulement (avertissement) ; tout script qui écrit s'arrête (exit 1).
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true }) // d'abord : la clé de service
dotenv.config({ quiet: true }) // puis .env (ne remplace jamais une variable déjà posée)

export function configSupabase({ ecriture = false } = {}) {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon) {
    console.error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis (fichier .env).')
    process.exit(1)
  }
  if (!service) {
    if (ecriture) {
      // Un script qui écrit ne retombe JAMAIS sur la clé publique : une écriture « réussie » aujourd'hui échouerait en silence demain (RLS).
      console.error('✗ SUPABASE_SERVICE_ROLE_KEY absente (.env.local) : ce script écrit dans la base, il ne tourne pas avec la clé publique. Aucune requête envoyée.')
      process.exit(1)
    }
    console.warn('⚠ SUPABASE_SERVICE_ROLE_KEY absente (.env.local) : lecture avec la clé publique — ne fonctionnera plus une fois RLS activé (docs/securite-temps-b/).')
  }
  return { url, anon, cleDonnees: service || anon, serviceActive: Boolean(service) }
}

/** Client Supabase. `ecriture: true` exige la clé de service (sortie code 1 sinon) ; en lecture seule, le repli sur la clé publique reste permis. */
export function clientDonnees({ ecriture = false } = {}) {
  const c = configSupabase({ ecriture })
  const supabase = createClient(c.url, c.cleDonnees, { auth: { persistSession: false, autoRefreshToken: false } })
  return { ...c, supabase }
}
