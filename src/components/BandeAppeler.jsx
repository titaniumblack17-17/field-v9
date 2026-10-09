import React from 'react'
import { nomClient } from '../lib/client'

/** Numéro à composer pour un élément du Brief : portable d'abord, cabinet sinon. */
export const telDe = (item) =>
  item.dossier.clients?.telephone_portable || item.dossier.clients?.telephone_cabinet || null

/**
 * « Appeler » : un lien tel: quand le client a un numéro (même geste qu'avant :
 * le téléphone compose), sinon ouvre la fiche du dossier pour le chercher.
 */
export function BoutonAppeler({ item, onOuvrir, className }) {
  const tel = telDe(item)
  return tel ? (
    <a href={`tel:${tel}`} className={className}>
      Appeler
    </a>
  ) : (
    <button onClick={() => onOuvrir(item.dossier)} className={className}>
      Appeler
    </button>
  )
}

/**
 * Bande « À appeler » en tête du Board : le nombre de contacts à traiter, le
 * premier d'entre eux et son motif, un tap pour ouvrir la feuille, et le bouton
 * qui lance l'appel du premier. Remplace le grand bloc « Priorité du jour » ;
 * les données sont exactement les siennes.
 */
export default function BandeAppeler({ nombre, premier, onOuvrirFeuille, onOuvrirDossier }) {
  return (
    <div className="flex gap-2 mt-4 min-h-14">
      <button
        onClick={onOuvrirFeuille}
        aria-haspopup="dialog"
        className="flex-1 min-w-0 flex items-center gap-3 bg-carte rounded-[14px] px-3 py-2 text-left active:scale-[0.99] transition"
      >
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent-vif text-fond font-bold text-sm flex items-center justify-center tabular-nums">
          {nombre}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs text-texte-doux">
            À appeler · {nombre} contact{nombre > 1 ? 's' : ''}
          </span>
          <span className="block truncate">
            <span className="text-[15px] font-bold text-texte">{nomClient(premier.dossier.clients) ?? '—'}</span>
            {premier.libelle && <span className="text-xs text-texte-doux"> · {premier.libelle}</span>}
          </span>
        </span>
        <span className="flex-shrink-0 text-texte-doux text-xl leading-none" aria-hidden="true">
          ›
        </span>
      </button>
      <BoutonAppeler
        item={premier}
        onOuvrir={onOuvrirDossier}
        className="flex-shrink-0 w-24 h-14 rounded-[14px] bg-accent-vif text-fond font-bold flex items-center justify-center"
      />
    </div>
  )
}
