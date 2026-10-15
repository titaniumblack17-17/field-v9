import { useEffect, useState } from 'react'
import { estPlusRecente, lireVersionEnLigne } from '../lib/version'

const INTERVALLE_MS = 10 * 60 * 1000

/**
 * Vrai quand une version plus récente que celle qui tourne est publiée en ligne. Vérifiée au démarrage, à chaque
 * retour au premier plan, au retour du réseau et toutes les 10 minutes. Hors ligne ou en erreur : on ne conclut
 * rien (et un constat déjà fait n'est pas retiré).
 */
export default function useVersionEnLigne() {
  const [distante, setDistante] = useState(null)
  useEffect(() => {
    let actif = true
    const verifier = async () => {
      if (document.visibilityState === 'hidden') return
      const v = await lireVersionEnLigne()
      if (actif && v && estPlusRecente(v)) setDistante(v)
    }
    verifier()
    const surVisible = () => document.visibilityState === 'visible' && verifier()
    document.addEventListener('visibilitychange', surVisible)
    window.addEventListener('online', verifier)
    const minuteur = setInterval(verifier, INTERVALLE_MS)
    return () => {
      actif = false
      document.removeEventListener('visibilitychange', surVisible)
      window.removeEventListener('online', verifier)
      clearInterval(minuteur)
    }
  }, [])
  return distante
}
