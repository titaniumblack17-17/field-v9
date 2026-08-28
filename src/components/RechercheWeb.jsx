import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * Recherche web à la demande, fiche par fiche. Écrit directement (comme à la
 * création d'un nouveau client, et comme le passage en lot sur les fiches
 * existantes) : le garde-fou n'est plus une relecture manuelle mais le
 * prompt côté edge function, qui s'abstient en cas de doute réel sur
 * l'identité du praticien. Sert surtout à forcer un nouveau passage sur une
 * fiche précise (ex. après avoir complété un champ à la main, qui débloque
 * la recherche des champs encore vides).
 */
export default function RechercheWeb({ client, onComplete }) {
  const [enCours, setEnCours] = useState(false)
  const [resultat, setResultat] = useState(null)
  const [erreur, setErreur] = useState(null)

  const chercher = async () => {
    setEnCours(true)
    setErreur(null)
    setResultat(null)

    const { data, error } = await supabase.functions.invoke('client-web-lookup', {
      body: { client_id: client.id },
    })

    setEnCours(false)

    if (error) {
      setErreur('Recherche impossible — réessaie dans un instant.')
      return
    }

    setResultat(data)
    if (data.ecrit) onComplete?.()
  }

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={chercher}
        disabled={enCours}
        className="text-accent text-sm font-medium disabled:opacity-50"
      >
        {enCours ? 'Recherche en cours…' : '🔎 Chercher sur le web'}
      </button>

      {erreur && <p className="text-erreur text-xs mt-2">{erreur}</p>}

      {resultat && (
        <p className="text-texte-faible text-xs mt-2">
          {resultat.ecrit
            ? `✓ Complété : ${resultat.champsEcrits.join(', ')}`
            : resultat.incertitude || 'Rien trouvé avec une confiance suffisante.'}
        </p>
      )}
    </div>
  )
}
