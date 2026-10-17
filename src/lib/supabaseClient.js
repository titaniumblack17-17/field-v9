import { createClient } from '@supabase/supabase-js'
import { CLE_SESSION } from './session'

// Session longue et persistante : conservée dans le navigateur, jeton renouvelé automatiquement (au retour au
// premier plan et en tâche de fond). Le client envoie le jeton de l'utilisateur connecté dans chaque requête ;
// la base reste ouverte tant que RLS n'est pas activé (temps B).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      storageKey: CLE_SESSION,
      persistSession: true,
      autoRefreshToken: true,
      // Lien reçu par e-mail : la session est lue dans l'adresse (flux implicite, valable dans n'importe quel navigateur).
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  }
)

/**
 * Avant tout rejeu de la file hors ligne : laisse le client renouveler un jeton périmé (le renouvellement a lieu dans
 * getSession). Sans réseau, l'appel échoue sans bruit : l'écriture sera simplement retentée plus tard.
 */
export async function assurerJeton() {
  try {
    await supabase.auth.getSession()
  } catch {
    // réseau absent : rien à faire
  }
}
