import React from 'react'
import { estEnAttente, joursEnAttente, joursDepuisStatut, MOTIFS_ATTENTE_SAV_LABELS } from '../constants/dossiers'

/**
 * Pastille « ⏳ <bloque_par> · N j » : un dossier dont `bloque_par` est renseigné
 * et qui n'est pas terminé. Le motif structuré d'un SAV est traduit en libellé ;
 * un texte libre s'affiche tel quel (tronqué par la largeur). Rien sinon.
 */
export default function PastilleAttente({ dossier, className = '' }) {
  if (!estEnAttente(dossier)) return null
  const jours = joursEnAttente(dossier) ?? joursDepuisStatut(dossier)
  const brut = dossier.bloque_par.trim()
  const motif = MOTIFS_ATTENTE_SAV_LABELS[brut] ?? brut
  return (
    <span
      className={`inline-block max-w-full truncate align-middle bg-fond text-alerte text-[11px] font-bold rounded-lg px-[9px] py-[3px] leading-tight ${className}`}
    >
      ⏳ {motif}
      {jours != null && ` · ${jours} j`}
    </span>
  )
}
