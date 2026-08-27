import React, { useEffect, useRef, useState } from 'react'

/**
 * Texte qu'on corrige d'un appui.
 *
 * Tout ce qui se saisit doit pouvoir se reprendre : une faute de frappe, une
 * précision qui vient après coup. Un champ qui ne s'écrit qu'une fois oblige à
 * supprimer et refaire, et on perd la date de création au passage.
 *
 * L'enregistrement est explicite — pas au flou. Sur un téléphone, un doigt qui
 * effleure ailleurs enregistrerait une saisie à moitié faite.
 */
export default function TexteModifiable({
  valeur,
  onEnregistrer,
  placeholder = 'Ajouter…',
  type = 'text',
  multiligne = false,
  className = 'text-texte',
  vide = 'Non renseigné',
  // Quand le parent a déjà un bouton « Modifier », l'éditeur doit s'ouvrir du
  // premier coup : deux appuis pour corriger une faute, c'est un appui de trop.
  ouvertParDefaut = false,
  onFermer,
  // Ce qui s'affiche hors édition, quand la valeur brute n'est pas lisible :
  // une date ISO ne se montre pas telle quelle.
  rendu,
}) {
  const [edition, setEdition] = useState(ouvertParDefaut)
  const [brouillon, setBrouillon] = useState(valeur ?? '')
  const [enCours, setEnCours] = useState(false)
  const champRef = useRef(null)

  // Une note longue rouvre à sa taille fixe (3 lignes) et reste tronquée
  // jusqu'à la première frappe : sans cet ajustement au montage, on ne voit
  // pas la fin de ce qu'on avait déjà écrit avant même de continuer à taper.
  const ajusterHauteur = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => {
    if (!edition) setBrouillon(valeur ?? '')
  }, [valeur, edition])

  useEffect(() => {
    if (edition) {
      champRef.current?.focus()
      if (multiligne) ajusterHauteur(champRef.current)
    }
  }, [edition, multiligne])

  const enregistrer = async () => {
    const propre = typeof brouillon === 'string' ? brouillon.trim() : brouillon
    if (propre === (valeur ?? '')) {
      setEdition(false)
      return
    }
    setEnCours(true)
    await onEnregistrer(propre || null)
    setEnCours(false)
    setEdition(false)
    onFermer?.()
  }

  const annuler = () => {
    setBrouillon(valeur ?? '')
    setEdition(false)
    onFermer?.()
  }

  if (!edition) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation()
          setEdition(true)
        }}
        className={`text-left w-full ${valeur ? className : 'text-texte-fantome'}`}
      >
        {valeur ? (rendu ? rendu(valeur) : valeur) : vide}
      </button>
    )
  }

  const Champ = multiligne ? 'textarea' : 'input'

  return (
    <div className="flex items-start gap-2">
      <Champ
        ref={champRef}
        type={multiligne ? undefined : type}
        rows={multiligne ? 3 : undefined}
        value={brouillon}
        onChange={(e) => {
          setBrouillon(e.target.value)
          if (multiligne) ajusterHauteur(e.target)
        }}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !multiligne) enregistrer()
          if (e.key === 'Escape') annuler()
        }}
        className={`flex-1 min-w-0 bg-carte-douce rounded-lg px-2 py-1 text-texte outline-none placeholder:text-texte-fantome resize-none ${multiligne ? 'overflow-hidden' : ''}`}
      />
      <button
        onClick={annuler}
        aria-label="Annuler"
        className="h-11 w-8 flex-shrink-0 text-texte-fantome"
      >
        ×
      </button>
      <button
        onClick={enregistrer}
        disabled={enCours}
        aria-label="Enregistrer"
        className="h-11 w-8 flex-shrink-0 text-accent disabled:opacity-40"
      >
        {enCours ? '…' : '✓'}
      </button>
    </div>
  )
}
