import Dexie from 'dexie'

export const db = new Dexie('FieldV9')
db.version(1).stores({
  cabinets: '++id, nom, praticien, adresse, ville, cp, tel, portable, mail, codeAcces, notes, marquesInstallees, createdAt, updatedAt',
  dossiers: '++id, cabinetId, type, label, etape, montantEstime, montantDevis, montantSigne, rappelDate, rappelNote, perdu, todoistId, createdAt, updatedAt',
  activites: '++id, dossierId, cabinetId, type, contenu, createdAt',
  rappels: '++id, dossierId, cabinetId, message, echeance, fait, createdAt',
  config: '++id, cle, valeur'
})

export const ETAPES = [
  { id: 'prospect',     label: 'Prospect',          color: '#888780', bg: '#F1EFE8' },
  { id: 'devis-cours',  label: 'Devis en cours',    color: '#378ADD', bg: '#E6F1FB' },
  { id: 'devis-envoye', label: 'Devis envoye',      color: '#185FA5', bg: '#D0E8F8' },
  { id: 'relance',      label: 'Relance',            color: '#EF9F27', bg: '#FAEEDA' },
  { id: 'nego',         label: 'Negociation',        color: '#BA7517', bg: '#F5E4C8' },
  { id: 'valide',       label: 'Devis valide',       color: '#639922', bg: '#EAF3DE' },
  { id: 'plan',         label: 'Plan',               color: '#3B6D11', bg: '#DFF0CC' },
  { id: 'cdc',          label: 'CDC',                color: '#3B6D11', bg: '#DFF0CC' },
  { id: 'commande',     label: 'Commande',           color: '#1D9E75', bg: '#E1F5EE' },
  { id: 'reception',    label: 'Reception materiel', color: '#0F6E56', bg: '#C8EDE3' },
  { id: 'financement',  label: 'Financement',        color: '#0F6E56', bg: '#C8EDE3' },
  { id: 'install-prog', label: 'Installation prog',  color: '#7F77DD', bg: '#EEEDFB' },
  { id: 'install',      label: 'Installation',       color: '#534AB7', bg: '#E0DFF8' },
  { id: 'suivi',        label: 'Suivi installation', color: '#534AB7', bg: '#E0DFF8' },
  { id: 'sav',          label: 'SAV',                color: '#888780', bg: '#F1EFE8' },
  { id: 'perdu',        label: 'Perdu',              color: '#E24B4A', bg: '#FCEBEB' },
]
export const ETAPE_MAP = Object.fromEntries(ETAPES.map(e => [e.id, e]))

export const now = () => new Date().toISOString()

export async function creerCabinet(data) {
  return db.cabinets.add({ ...data, createdAt: now(), updatedAt: now() })
}
export async function creerDossier(data) {
  return db.dossiers.add({ ...data, etape: data.etape || 'prospect', perdu: false, createdAt: now(), updatedAt: now() })
}
export async function ajouterActivite(data) {
  return db.activites.add({ ...data, createdAt: now() })
}
export async function avancerEtape(dossierId, nouvelleEtape) {
  const e = ETAPE_MAP[nouvelleEtape]
  await db.dossiers.update(dossierId, { etape: nouvelleEtape, perdu: nouvelleEtape === 'perdu', updatedAt: now() })
  await ajouterActivite({ dossierId, type: 'Etape', contenu: '-> ' + (e ? e.label : nouvelleEtape) })
}
export async function seedDemo() {
  const count = await db.cabinets.count()
  if (count > 0) return
  const c1 = await creerCabinet({ nom: 'Cabinet Elhaik', praticien: 'Dr. Elhaik', adresse: '92 rue Carnot', ville: 'Suresnes', cp: '92150', tel: '01 47 28 XX XX', portable: '06 12 XX XX XX', mail: 'elhaik@cabinet.fr', codeAcces: 'B2047', notes: 'Renovation 3 salles. Budget valide.', marquesInstallees: 'Ancien Anthos' })
  const c2 = await creerCabinet({ nom: 'Cabinet Gahnassia-Lewin', praticien: 'Dr. Gahnassia-Lewin', adresse: '14 av. de la Gare', ville: 'Louviers', cp: '27400', tel: '02 32 XX XX XX', portable: '06 XX XX XX XX', mail: 'gahnassia@cabinet.fr', codeAcces: 'L1209', notes: '4 salles a equiper.' })
  const c3 = await creerCabinet({ nom: 'Centre ADN', praticien: 'Dr. Nezri', adresse: '28 bd Pasteur', ville: 'Paris', cp: '75015', tel: '01 45 XX XX XX', portable: '07 XX XX XX XX', mail: 'nezri@adn-dental.fr', codeAcces: 'A0042', notes: '9 unites Planmeca.' })
  const c4 = await creerCabinet({ nom: 'Cabinet Mamouni', praticien: 'Dr. Mamouni', adresse: '5 rue de Silly', ville: 'Boulogne', cp: '92100', tel: '01 46 XX XX XX', portable: '06 XX XX XX XX', mail: 'mamouni@cabinet.fr', codeAcces: '' })
  const c5 = await creerCabinet({ nom: 'Cabinet Pricop', praticien: 'Dr. Pricop', adresse: '12 rue de Flore', ville: 'Le Mans', cp: '72000', tel: '02 43 XX XX XX', portable: '06 XX XX XX XX', mail: 'pricop@cabinet.fr', codeAcces: 'M0081' })
  const d1 = await creerDossier({ cabinetId: c1, type: 'projet', label: 'Projet 3 unites Planmeca', etape: 'devis-cours', montantEstime: 92000 })
  const d2 = await creerDossier({ cabinetId: c1, type: 'sav', label: 'SAV fauteuil salle 2', etape: 'sav', montantEstime: 0 })
  const d3 = await creerDossier({ cabinetId: c2, type: 'projet', label: 'Projet 4 salles', etape: 'devis-cours', montantEstime: 140000 })
  const d4 = await creerDossier({ cabinetId: c3, type: 'projet', label: '9 unites Planmeca', etape: 'valide', montantEstime: 320000, montantDevis: 318500 })
  const d5 = await creerDossier({ cabinetId: c4, type: 'projet', label: '2 unites Cefla', etape: 'relance', montantEstime: 45000 })
  const d6 = await creerDossier({ cabinetId: c5, type: 'projet', label: 'Installation en cours', etape: 'install', montantEstime: 55000, montantSigne: 54800 })
  await ajouterActivite({ dossierId: d1, cabinetId: c1, type: 'RDV', contenu: 'Besoin confirme : 3 unites Planmeca Pro 50. Budget OK. Financement Cetelem 36 mois.' })
  await ajouterActivite({ dossierId: d1, cabinetId: c1, type: 'Appel', contenu: 'Confirme RDV presentation devis semaine prochaine.' })
  await ajouterActivite({ dossierId: d3, cabinetId: c2, type: 'RDV', contenu: '4 salles a equiper. Priorite Cefla Anthos.' })
  await ajouterActivite({ dossierId: d4, cabinetId: c3, type: 'Etape', contenu: '-> Devis valide. BC signe. Acompte 30% recu.' })
  await ajouterActivite({ dossierId: d5, cabinetId: c4, type: 'Note', contenu: 'Devis envoye il y a 7 jours. Relance a faire.' })
  await db.config.add({ cle: 'objectifCA', valeur: '5000000' })
  await db.config.add({ cle: 'user', valeur: 'Bruce' })
}
