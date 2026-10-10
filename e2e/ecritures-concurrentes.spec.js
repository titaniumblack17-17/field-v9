import { test, expect } from '@playwright/test'
import { journaliser, noter } from './diag.js'
import { ouvrirDocuments, rendu } from './aides.js'

// Défaut « mise à jour perdue » : l'écho temps réel d'une écriture ANCIENNE arrive après une
// écriture plus récente et remet la fiche en arrière ; le geste suivant part alors d'un état
// périmé et écrase en base le changement intermédiaire. Reproduit ici de façon déterministe :
// les échos temps réel de `fichiers` sont retenus puis libérés à la main (jamais un délai fixe).
// Dossier jetable, nom unique par passage.
const NOM = `ZZTEST-ECR-${Math.random().toString(36).slice(2, 8)}`
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  noter(`TEST ${methode} ${chemin.slice(0, 90)} ${corps ? JSON.stringify(corps).slice(0, 160) : ''} → ${r.status} ${texte.slice(0, 220)}`)
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}

let client, dossier, X
const OFFRES = () => [
  { libelle: 'Fauteuils', montant_ttc: 1000, etat: 'a_trancher' },
  { libelle: 'Local', montant_ttc: 2000, etat: 'a_trancher' },
  { libelle: 'Option', montant_ttc: 500, etat: 'a_trancher' },
]
const variantes = async () => (await rest('GET', `fichiers?id=eq.${X.id}&select=variantes`))[0].variantes

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: NOM, prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: `${NOM} dossier` })
  ;[X] = await rest('POST', 'fichiers', {
    dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', type_doc: 'devis',
    nom: 'ZZTEST_ECRIT_202699401.pdf', date_devis: '2026-10-01', variantes: OFFRES(),
  })
})
test.afterAll(async () => {
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.${NOM} dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.${NOM}`)
})
test.beforeEach(async ({ page }, testInfo) => {
  journaliser(page, testInfo)
  await rest('PATCH', `fichiers?id=eq.${X.id}`, { variantes: OFFRES() }) // chaque test repart des mêmes offres
})

test('trois étiquettes de projet posées à la suite : un écho temps réel tardif n\'en défait aucune', async ({ page }) => {
  // Échos temps réel de `fichiers` retenus, libérés un par un par le test.
  const retenus = []
  let abonne = false
  await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const serveur = ws.connectToServer()
    ws.onMessage((m) => serveur.send(m))
    serveur.onMessage((m) => {
      const texte = typeof m === 'string' ? m : ''
      if (texte.includes(`fichiers-dossier_id-${dossier.id}`) && texte.includes('phx_reply') && texte.includes('"status":"ok"')) abonne = true
      if (texte.includes('"table":"fichiers"') && texte.includes('"type":"UPDATE"')) retenus.push(m)
      else ws.send(m)
    })
    page.__liberer = (n = 1) => retenus.splice(0, n).forEach((m) => ws.send(m))
  })
  await page.route(/todoist-rappel|todoist-tache/, (route) => route.abort())
  await page.goto('/')
  await page.locator('input[type=search]').fill(NOM)
  await page.getByText(`${NOM} Essai`).click()
  await page.getByText(`${NOM} dossier`).click()
  await ouvrirDocuments(page)

  // L'abonnement temps réel de la fiche doit être établi avant la première écriture.
  await expect.poll(() => abonne, { timeout: 30_000 }).toBe(true)

  const poser = async (libelle, projet) => {
    const champ = page.getByLabel(new RegExp(`Projet de l'offre ${libelle}`))
    await champ.fill(projet)
    await champ.blur()
  }
  const projets = async () => (await variantes()).map((o) => o.projet)

  await poser('Fauteuils', 'Projet A')
  await expect.poll(projets).toEqual(['Projet A', undefined, undefined])
  await expect.poll(() => retenus.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1) // écho(s) de la 1re écriture en attente
  const echosDeA = retenus.length
  await poser('Local', 'Projet B')
  await expect.poll(projets).toEqual(['Projet A', 'Projet B', undefined])
  await expect.poll(() => retenus.length, { timeout: 30_000 }).toBeGreaterThan(echosDeA) // la fiche est « en avance » sur eux

  // Arrive l'écho de la PREMIÈRE écriture, devenu périmé : la fiche ne doit pas reculer.
  page.__liberer(echosDeA)
  await rendu(page)
  await expect(page.getByLabel(/Projet de l'offre Local/)).toHaveValue('Projet B')

  // Le geste suivant part de l'état courant, pas d'un état périmé.
  await poser('Option', 'Projet C')
  await expect.poll(projets).toEqual(['Projet A', 'Projet B', 'Projet C'])
  page.__liberer(retenus.length)
})

test('échos livrés dans le désordre (le plus récent d\'abord) : l\'écran garde le dernier état et le geste suivant n\'en défait aucun', async ({ page }) => {
  // Constaté en suite complète : trois échos arrivés dans l'ordre 1, 3, 2. Ici l'ordre est inversé à la main.
  const retenus = []
  let abonne = false
  await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const serveur = ws.connectToServer()
    ws.onMessage((m) => serveur.send(m))
    serveur.onMessage((m) => {
      const texte = typeof m === 'string' ? m : ''
      if (texte.includes(`fichiers-dossier_id-${dossier.id}`) && texte.includes('phx_reply') && texte.includes('"status":"ok"')) abonne = true
      if (texte.includes('"table":"fichiers"') && texte.includes('"type":"UPDATE"')) retenus.push(m)
      else ws.send(m)
    })
    page.__liberer = (ordre) => ordre.forEach((i) => ws.send(retenus[i]))
  })
  await page.route(/todoist-rappel|todoist-tache/, (route) => route.abort())
  await page.goto('/')
  await page.locator('input[type=search]').fill(NOM)
  await page.getByText(`${NOM} Essai`).click()
  await page.getByText(`${NOM} dossier`).click()
  await ouvrirDocuments(page)
  await expect.poll(() => abonne, { timeout: 30_000 }).toBe(true)

  const poser = async (libelle, projet) => {
    const champ = page.getByLabel(new RegExp(`Projet de l'offre ${libelle}`))
    await champ.fill(projet)
    await champ.blur()
  }
  const projets = async () => (await variantes()).map((o) => o.projet)
  await poser('Fauteuils', 'Projet A')
  await expect.poll(projets).toEqual(['Projet A', undefined, undefined])
  await expect.poll(() => retenus.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)
  const n1 = retenus.length
  await poser('Local', 'Projet B')
  await expect.poll(projets).toEqual(['Projet A', 'Projet B', undefined])
  await expect.poll(() => retenus.length, { timeout: 30_000 }).toBeGreaterThan(n1)
  const n2 = retenus.length
  await poser('Option', 'Projet C')
  await expect.poll(projets).toEqual(['Projet A', 'Projet B', 'Projet C'])
  await expect.poll(() => retenus.length, { timeout: 30_000 }).toBeGreaterThan(n2)

  // Livraison inversée : le plus récent d'abord, puis les plus anciens
  page.__liberer([...retenus.keys()].reverse())
  await rendu(page)
  await expect(page.getByLabel(/Projet de l'offre Fauteuils/)).toHaveValue('Projet A')
  await expect(page.getByLabel(/Projet de l'offre Local/)).toHaveValue('Projet B')
  await expect(page.getByLabel(/Projet de l'offre Option/)).toHaveValue('Projet C')

  await poser('Fauteuils', 'Projet D')
  await expect.poll(projets).toEqual(['Projet D', 'Projet B', 'Projet C'])
})
