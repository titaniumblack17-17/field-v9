import React, { useEffect, useRef, useState } from 'react'
import useVersionEnLigne from '../hooks/useVersionEnLigne'
import { estAdresseDeTest, rechargerQuandFileVide } from '../lib/version'

/**
 * Deux bandeaux, tous deux discrets mais impossibles à rater :
 *  • adresse de test (≠ production) : orange, « Version de test, pas la production » ;
 *  • version plus récente en ligne : « Nouvelle version disponible » + « Recharger » (vide le cache du service
 *    worker puis recharge ; si des écritures attendent dans la file hors ligne, recharge seulement après leur envoi).
 */
export default function BandeauVersion() {
  const nouvelle = useVersionEnLigne()
  const [attente, setAttente] = useState(false)
  const annuler = useRef(null)
  useEffect(() => () => annuler.current?.(), [])
  const test = estAdresseDeTest(window.location.hostname)

  const recharger = () => {
    setAttente(true)
    annuler.current = rechargerQuandFileVide({ viderCaches: true })
  }

  return (
    <>
      {test && (
        <div role="note" aria-label="Version de test" className="sticky top-0 z-40 bg-alerte text-white text-xs font-semibold text-center py-1.5">
          Version de test, pas la production
        </div>
      )}
      {nouvelle && (
        <div role="note" aria-label="Nouvelle version disponible" className="sticky top-0 z-40 bg-accent text-white text-sm flex items-center justify-between gap-2 pl-4 pr-1">
          <span className="py-2">
            {attente ? 'Rechargement dès que vos modifications en attente sont envoyées…' : 'Nouvelle version disponible'}
          </span>
          {!attente && (
            <button onClick={recharger} className="min-h-11 px-4 font-semibold flex-shrink-0">
              Recharger
            </button>
          )}
        </div>
      )}
    </>
  )
}
