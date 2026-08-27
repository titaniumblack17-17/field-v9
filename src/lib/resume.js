import { nomClient } from './client'
import { TYPE_LABELS, libelleEtapeDossier } from '../constants/dossiers'

// Texte prêt à coller dans un SMS/mail/WhatsApp pour partager une fiche avec
// un collègue — Field V9 n'a pas de compte partagé, donc pas d'autre moyen
// de faire circuler l'info que de la préparer proprement à copier.
export const resumeClient = (client, dossiers = []) => {
  const lignes = [nomClient(client) ?? 'Client']

  const sousTitre = [client.nom_cabinet, client.ville].filter(Boolean).join(' · ')
  if (sousTitre) lignes.push(sousTitre)

  const adresse = [client.adresse, [client.code_postal, client.ville].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  if (adresse) lignes.push(adresse)

  const tels = [
    client.telephone_portable && `Portable : ${client.telephone_portable}`,
    client.telephone_cabinet && `Cabinet : ${client.telephone_cabinet}`,
  ].filter(Boolean)
  if (tels.length) lignes.push(tels.join(' | '))

  if (client.email) lignes.push(`E-mail : ${client.email}`)

  if (dossiers.length) {
    lignes.push('')
    lignes.push('Dossiers :')
    dossiers.forEach((d) => {
      lignes.push(`- ${d.titre || TYPE_LABELS[d.type]} — ${libelleEtapeDossier(d)}`)
    })
  }

  return lignes.join('\n')
}

export const resumeDossier = (dossier, client, notes = []) => {
  const lignes = [
    [nomClient(client), dossier.titre || TYPE_LABELS[dossier.type]].filter(Boolean).join(' — '),
    `${TYPE_LABELS[dossier.type]} · ${libelleEtapeDossier(dossier)}`,
  ]

  if (dossier.montant_estime != null) lignes.push(`Montant estimé : ${dossier.montant_estime} €`)
  if (dossier.date_installation) lignes.push(`Installation prévue : ${dossier.date_installation}`)

  if (notes.length) {
    lignes.push('')
    lignes.push('Notes :')
    notes.forEach((n) => lignes.push(`- ${n.texte}`))
  }

  return lignes.join('\n')
}
