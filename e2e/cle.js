// Clé utilisée par les tests pour préparer et relire les fixtures ZZTEST directement dans la base (hors application).
//
// Temps B (RLS) : avec les politiques activées, la clé publique ne voit plus rien. On utilise donc la clé de SERVICE si
// elle est fournie (SUPABASE_SERVICE_ROLE_KEY dans `.env.local`, ignoré par git, jamais préfixée VITE_), sinon la clé
// publique — comportement actuel tant que RLS est désactivé.
// Ne sert PAS à l'application sous test : celle-ci garde sa propre clé (voir playwright.config.js, option opt-in).
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

export const CLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
export const CLE_SERVICE_ACTIVE = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
