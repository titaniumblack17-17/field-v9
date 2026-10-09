import React from 'react'
import { joursEnAttente, MOTIFS_ATTENTE_SAV_LABELS } from '../constants/dossiers'

/**
 * « À qui la balle » : pastille « ⏳ <motif> · N j » sur un dossier qui attend
 * un tiers (SAV en attente, devis envoyé ou relancé). Rien si le dossier n'est
 * pas au statut En attente. Mêmes données qu'avant : `bloque_par` pour le motif d'un SAV,
 * `joursEnAttente` pour la durée.
 */
export default function PastilleAttente({ dossier, className = '' }) {
  // Seulement le statut « En attente » : un dossier « nouveau » qui porte un
  // bloque_par n'en reçoit pas, et un devis envoyé n'est pas « en attente ».
  if (dossier.statut !== 'en_attente') return null
  const jours = joursEnAttente(dossier)
  if (jours == null) return null
  const motif =
    dossier.type === 'sav'
      ? MOTIFS_ATTENTE_SAV_LABELS[dossier.bloque_par] ?? dossier.bloque_par ?? 'motif à préciser'
      : 'réponse client'
  return (
    <span
      className={`inline-block max-w-full truncate align-middle bg-fond text-alerte text-[11px] font-bold rounded-lg px-[9px] py-[3px] leading-tight ${className}`}
    >
      ⏳ {motif} · {jours} j
    </span>
  )
}
