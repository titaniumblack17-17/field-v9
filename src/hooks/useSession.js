import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { connexionDesactiveePourTests, nettoyerAdresse, sessionLocale } from '../lib/session'

/**
 * État de connexion : 'connecte' | 'deconnecte'. Décidé tout de suite et sans réseau d'après la session enregistrée
 * localement (pas d'attente, pas d'écran de connexion qui clignote, pas d'écran bloquant hors ligne). L'écran de
 * connexion n'apparaît que s'il n'existe AUCUNE session locale, ou quand Supabase annonce une déconnexion (jeton de
 * renouvellement refusé, déconnexion volontaire). Un renouvellement impossible faute de réseau ne déconnecte jamais.
 */
export function useSession() {
  const [etat, setEtat] = useState(() => (connexionDesactiveePourTests() || sessionLocale() ? 'connecte' : 'deconnecte'))
  const [email, setEmail] = useState(() => sessionLocale()?.user?.email ?? null)

  useEffect(() => {
    if (connexionDesactiveePourTests()) return undefined
    let actif = true
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!actif) return
        if (data.session) {
          setEtat('connecte')
          setEmail(data.session.user?.email ?? null)
        } else if (!sessionLocale()) {
          setEtat('deconnecte')
        }
      })
      .catch(() => {})
    const { data } = supabase.auth.onAuthStateChange((evenement, s) => {
      if (evenement === 'SIGNED_OUT') {
        setEtat('deconnecte')
        setEmail(null)
      } else if (s) {
        setEtat('connecte')
        setEmail(s.user?.email ?? null)
        if (/access_token=/.test(window.location.hash)) nettoyerAdresse() // jetons du lien : jamais laissés dans l'adresse
      }
    })
    return () => {
      actif = false
      data.subscription.unsubscribe()
    }
  }, [])

  return { etat, email }
}
