// Un centre ou une SCM peut ne pas avoir de praticien nommé — le nom du
// cabinet sert alors d'identité à afficher, pas seulement de complément.
export const nomClient = (c) => {
  if (!c) return null
  const praticien = [c.prenom_praticien, c.nom_praticien].filter(Boolean).join(' ')
  return praticien || c.nom_cabinet || null
}
