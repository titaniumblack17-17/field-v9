import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Un seul compte autorisé (Bruce) : pas de gestion multi-utilisateur, juste
// un état connecté/non connecté, nécessaire une fois le RLS activé côté
// base (voir chantier sécurité — tables exposées en libre accès avant ça).
//
// `undefined` = état pas encore connu (premier rendu, avant la réponse de
// getSession) ; `null` = vérifié, pas de session ; sinon la session active.
// Cette distinction évite un flash de l'écran de connexion pendant la
// vérification initiale.
export function useSession() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    const { data: écouteur } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })

    return () => écouteur.subscription.unsubscribe()
  }, [])

  return session
}
