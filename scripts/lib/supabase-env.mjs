// Accès Supabase des scripts hors application (import de contacts, catalogue, fiches…).
//
// Temps B de la sécurité (RLS) : les tables ne seront plus lisibles ni modifiables avec la clé publique (« anon »,
// visible dans l'application). Ces scripts utilisent donc la clé de SERVICE quand elle est présente :
//   SUPABASE_SERVICE_ROLE_KEY dans `.env.local` (ignoré par git — voir .gitignore), JAMAIS dans `.env` ni dans le code,
//   et JAMAIS précédée de VITE_ (une variable VITE_ est embarquée dans l'application publiée).
// Sans clé de service, on retombe sur la clé publique avec un avertissement : tant que RLS est désactivé, tout marche
// comme avant ; une fois RLS activé, les écritures et lectures échoueront (erreur Supabase contrôlée par chaque script).
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local', quiet: true }) // d'abord : la clé de service
dotenv.config({ quiet: true }) // puis .env (ne remplace jamais une variable déjà posée)

export function configSupabase() {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon) {
    console.error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis (fichier .env).')
    process.exit(1)
  }
  if (!service) {
    console.warn('⚠ SUPABASE_SERVICE_ROLE_KEY absente (.env.local) : clé publique utilisée — ne fonctionnera plus une fois RLS activé (docs/securite-temps-b/).')
  }
  return { url, anon, cleDonnees: service || anon, serviceActive: Boolean(service) }
}

/** Client Supabase pour les lectures/écritures de données (clé de service si présente, sinon clé publique). */
export function clientDonnees() {
  const c = configSupabase()
  const supabase = createClient(c.url, c.cleDonnees, { auth: { persistSession: false, autoRefreshToken: false } })
  return { ...c, supabase }
}
