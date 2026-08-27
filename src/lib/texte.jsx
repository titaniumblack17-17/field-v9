import React from 'react'

const URL_REGEX = /(https?:\/\/[^\s]+)/g

// Une parenthèse fermante ou un point final collé au lien (fin de phrase) ne
// doit pas faire partie de l'URL ouverte, sous peine de 404.
const PONCTUATION_FINALE = /[.,;:!?)\]}»”'"]+$/

// Un lien collé dans une note (Plaud, devis fournisseur…) doit s'ouvrir d'un
// tap — sans ça, il faut sélectionner le texte à la main pour le copier.
export const lienifier = (texte) => {
  if (!texte) return texte
  return texte.split(URL_REGEX).map((partie, i) => {
    if (i % 2 === 0) return partie
    const fin = partie.match(PONCTUATION_FINALE)?.[0] ?? ''
    const url = fin ? partie.slice(0, -fin.length) : partie
    return (
      <React.Fragment key={i}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-accent underline break-all"
        >
          {url}
        </a>
        {fin}
      </React.Fragment>
    )
  })
}
