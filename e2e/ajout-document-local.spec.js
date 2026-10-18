import { test, expect, echoRealtime } from './base.js'
import { rendu } from './aides.js'

// Un document envoyé s'affiche dès que l'insertion en base réussit, sans attendre l'événement temps réel ; l'événement,
// s'il arrive ensuite, ne le duplique pas ; la lecture d'un devis relit sa ligne SEULEMENT si l'écho du résultat manque.
// Ces scénarios tournent avec le serveur Realtime factice (aucun événement n'arrive sauf ceux que le test injecte).
// Fixtures ZZTEST uniques ; fichiers du dépôt et lignes retirés en fin.
const NOM = `ZZTEST-LOC-${Math.random().toString(36).slice(2, 8)}`
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}
const unique = () => Math.random().toString(36).slice(2, 8)

let client, dossier

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: NOM, prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: `${NOM} dossier` })
})

test.afterAll(async () => {
  const restes = await rest('GET', `fichiers?dossier_id=eq.${dossier.id}&select=chemin`)
  if (restes.length) {
    await fetch(`${URL_DB}/storage/v1/object/documents`, { method: 'DELETE', headers: entetes, body: JSON.stringify({ prefixes: restes.map((f) => f.chemin) }) })
  }
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.${NOM} dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.${NOM}`)
})

async function ouvrirFiche(page) {
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await page.locator('input[type=search]').fill(NOM)
  await page.getByText(`${NOM} Essai`).click()
  await page.getByText(`${NOM} dossier`).click()
  await expect(page.getByText(/^Documents déposés/)).toBeVisible()
  await expect(page.locator('button[data-ajout=dossier]')).toBeVisible()
}
const champ = (page) => page.locator('input[type=file][data-ajout=dossier]')
const lignesDu = (page, nom) => page.getByText(nom, { exact: true })
const enBase = (nom) => rest('GET', `fichiers?dossier_id=eq.${dossier.id}&nom=eq.${encodeURIComponent(nom)}&select=*`)

test('écho temps réel jamais reçu : le document est visible, une seule fois', async ({ page }) => {
  const nom = `ZZTEST_LOCAL_${unique()}.pdf`
  await ouvrirFiche(page)
  await champ(page).setInputFiles({ name: nom, mimeType: 'application/pdf', buffer: PDF })
  await expect(lignesDu(page, nom)).toBeVisible() // sans aucun événement temps réel
  await expect(lignesDu(page, nom)).toHaveCount(1)
  expect(await enBase(nom)).toHaveLength(1)
  await rendu(page)
  await expect(lignesDu(page, nom)).toHaveCount(1) // et pas de doublon qui arriverait après coup
})

test('écho temps réel tardif : toujours une seule ligne (déduplication par identifiant)', async ({ page, context }) => {
  const nom = `ZZTEST_LOCAL_${unique()}.pdf`
  await ouvrirFiche(page)
  await champ(page).setInputFiles({ name: nom, mimeType: 'application/pdf', buffer: PDF })
  await expect(lignesDu(page, nom)).toHaveCount(1)
  const [ligne] = await enBase(nom)
  // L'événement d'insertion arrive maintenant (deux fois, comme un rejeu du service) : l'identifiant est déjà dans la liste.
  expect(echoRealtime(context, { table: 'fichiers', type: 'INSERT', record: ligne })).toBeGreaterThan(0)
  echoRealtime(context, { table: 'fichiers', type: 'INSERT', record: ligne })
  await rendu(page)
  await expect(lignesDu(page, nom)).toHaveCount(1)
})

const nomDevis = () => `ZZTEST_LOC_2026${Math.floor(Math.random() * 90000) + 10000}.pdf` // « NOM_9 chiffres.pdf » : typé devis

// La fonction de lecture des devis est simulée : elle écrit un montant dans la vraie ligne (comme la vraie le ferait),
// sans appeler d'IA. `avecEcho` : l'événement de mise à jour est alors injecté avant la réponse de la fonction.
async function simulerLecture(page, context, { avecEcho, relectures }) {
  page.on('request', (r) => {
    if (r.method() === 'GET' && /\/rest\/v1\/fichiers\?(?=.*\bid=eq\.)/.test(r.url())) relectures.push(r.url())
  })
  await context.route(/\/functions\/v1\/devis-montant-v2/, async (route) => {
    const origine = route.request().headers().origin ?? '*'
    const cors = { 'access-control-allow-origin': origine, vary: 'Origin' }
    const { fichierId } = JSON.parse(route.request().postData() ?? '{}')
    const [maj] = await rest('PATCH', `fichiers?id=eq.${fichierId}`, { montant_ttc: 1234, analyse_at: new Date().toISOString(), analyse_erreur: null })
    if (avecEcho) {
      echoRealtime(context, { table: 'fichiers', type: 'UPDATE', record: maj })
      await expect(page.getByText(/1[\s  ]?234/).first()).toBeVisible() // l'écran a appliqué l'écho
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true }) })
  })
}

test('devis déposé, écho temps réel absent : le montant est visible, une seule ligne, une seule relecture', async ({ page, context }) => {
  const relectures = []
  await simulerLecture(page, context, { avecEcho: false, relectures })
  const nom = nomDevis()
  await ouvrirFiche(page)
  await champ(page).setInputFiles({ name: nom, mimeType: 'application/pdf', buffer: PDF })
  await expect(lignesDu(page, nom)).toHaveCount(1)
  await expect(page.getByText(/1[\s  ]?234/).first()).toBeVisible() // montant lu, sans écho
  await expect(lignesDu(page, nom)).toHaveCount(1)
  expect(relectures).toHaveLength(1) // la ligne a été relue : l'écho manquait
  expect(Number((await enBase(nom))[0].montant_ttc)).toBe(1234)
})

test('devis déposé, écho temps réel arrivé : aucune relecture de plus', async ({ page, context }) => {
  const relectures = []
  await simulerLecture(page, context, { avecEcho: true, relectures })
  const nom = nomDevis()
  await ouvrirFiche(page)
  await champ(page).setInputFiles({ name: nom, mimeType: 'application/pdf', buffer: PDF })
  await expect(page.getByText(/1[\s  ]?234/).first()).toBeVisible()
  await expect(lignesDu(page, nom)).toHaveCount(1)
  await page.waitForTimeout(800) // laisse à une relecture indue le temps de partir
  expect(relectures).toHaveLength(0)
})

// Avec le VRAI temps réel : l'ajout local ET l'écho d'insertion de la base coexistent, une seule ligne.
test('vrai temps réel : l’ajout local et l’écho de la base ne donnent qu’une ligne', { tag: '@temps-reel' }, async ({ page }) => {
  const nom = `ZZTEST_LOCAL_${unique()}.pdf`
  await ouvrirFiche(page)
  await champ(page).setInputFiles({ name: nom, mimeType: 'application/pdf', buffer: PDF })
  await expect(lignesDu(page, nom)).toHaveCount(1)
  await page.waitForTimeout(2500) // l'écho réel arrive en général en moins d'une seconde
  await expect(lignesDu(page, nom)).toHaveCount(1)
})
