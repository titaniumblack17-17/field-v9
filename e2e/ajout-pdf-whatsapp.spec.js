import { test, expect } from './base.js'

// PDF reçu par WhatsApp, enregistré dans Fichiers puis ajouté depuis l'iPhone : nom à espaces et accents,
// type MIME parfois vide. Fixtures ZZTEST uniques à ce passage, fichiers du dépôt retirés en fin.
const NOM = `ZZTEST-WA-${Math.random().toString(36).slice(2, 8)}`
const NOM_PDF = 'WhatsApp Document 2026-10-12 at 11.02.33 – Éléonore côté (1).pdf'
const NOM_PDF_SANS_TYPE = 'WhatsApp Document 2026-10-12 at 11.05.10 è.pdf'
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
const fichiersDuDossier = () => rest('GET', `fichiers?dossier_id=eq.${dossier.id}&select=id,nom,chemin,type_doc,type_mime,taille`)

let client, dossier

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: NOM, prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: `${NOM} dossier` })
})

test.afterAll(async () => {
  const restes = await fichiersDuDossier()
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
  // Dossier neuf : aucun document, donc ni compte ni jalons à attendre — la rubrique et son bouton suffisent.
  await expect(page.getByText(/^Documents déposés/)).toBeVisible()
  await expect(page.locator('button[data-ajout=dossier]')).toBeVisible()
}

test.use({ viewport: { width: 390, height: 844 } })

test('le champ fichier accepte explicitement .pdf', async ({ page }) => {
  await ouvrirFiche(page)
  const accept = await page.locator('input[type=file][data-ajout=dossier]').getAttribute('accept')
  expect(accept).toContain('application/pdf')
  expect(accept).toContain('.pdf')
})

test('PDF au nom WhatsApp (espaces, accents) : en base, rangé « autre », type PDF ; sans type MIME aussi', async ({ page }) => {
  await ouvrirFiche(page)
  const champ = page.locator('input[type=file][data-ajout=dossier]')
  await champ.setInputFiles({ name: NOM_PDF, mimeType: 'application/pdf', buffer: PDF })
  await expect(page.getByText(NOM_PDF)).toBeVisible()
  // Safari iOS livre parfois le fichier sans type MIME
  await champ.setInputFiles({ name: NOM_PDF_SANS_TYPE, mimeType: '', buffer: PDF })
  await expect(page.getByText(NOM_PDF_SANS_TYPE)).toBeVisible()

  const lignes = await fichiersDuDossier()
  expect(lignes).toHaveLength(2)
  for (const nom of [NOM_PDF, NOM_PDF_SANS_TYPE]) {
    const l = lignes.find((x) => x.nom.normalize('NFC') === nom.normalize('NFC'))
    expect(l, nom).toBeTruthy()
    expect(l.type_doc).toBe('autre')
    expect(l.type_mime).toBe('application/pdf')
    expect(l.taille).toBe(PDF.length)
    const objet = await fetch(`${URL_DB}/storage/v1/object/authenticated/documents/${l.chemin}`, { headers: entetes })
    expect(objet.status).toBe(200)
    expect(objet.headers.get('content-type')).toContain('application/pdf')
  }
})

test('iPhone : la feuille d’ajout porte la ligne d’aide WhatsApp et mène au sélecteur', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const page = await ctx.newPage()
  await ouvrirFiche(page)
  await page.locator('button[data-ajout=dossier]').click()
  const feuille = page.getByRole('dialog')
  await expect(feuille).toContainText('Depuis WhatsApp : partager › Enregistrer dans Fichiers, puis choisir le fichier ici.')
  const [selecteur] = await Promise.all([page.waitForEvent('filechooser'), feuille.getByRole('button', { name: 'Choisir un fichier' }).click()])
  await selecteur.setFiles({ name: 'WhatsApp Document 2026-10-12 at 11.09.00 ï.pdf', mimeType: 'application/pdf', buffer: PDF })
  await expect(page.getByText('WhatsApp Document 2026-10-12 at 11.09.00 ï.pdf')).toBeVisible()
  await ctx.close()
})

test('hors ligne : message visible (jamais muet), puis « Réessayer » envoie au retour du réseau', async ({ page, context }) => {
  await ouvrirFiche(page)
  const nom = 'WhatsApp Document 2026-10-12 at 11.20.00 hors ligne.pdf'
  await context.setOffline(true)
  await page.locator('input[type=file][data-ajout=dossier]').setInputFiles({ name: nom, mimeType: 'application/pdf', buffer: PDF })
  const alerte = page.getByRole('alert')
  await expect(alerte).toContainText('Pas de réseau')
  expect(await fichiersDuDossier().catch(() => [])).not.toContainEqual(expect.objectContaining({ nom }))
  await context.setOffline(false)
  await alerte.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page.getByText(nom)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('type MIME vide (cas Safari iOS, non reproductible dans Chromium) : déduit de l’extension', async ({ page }) => {
  await page.goto('/')
  const types = await page.evaluate(async () => {
    const { typeMime } = await import('/src/lib/fichiers.js')
    const f = (nom, type) => new File(['x'], nom, { type })
    return [
      typeMime(f('WhatsApp Document 2026-10-12 at 11.02.33.pdf', ''), 'WhatsApp Document 2026-10-12 at 11.02.33.pdf'),
      typeMime(f('IMG_0001.HEIC', ''), 'IMG_0001.HEIC'),
      typeMime(f('x.pdf', 'application/pdf'), 'x.pdf'),
      typeMime(f('inconnu.xyz', ''), 'inconnu.xyz'),
    ]
  })
  expect(types).toEqual(['application/pdf', 'image/heic', 'application/pdf', ''])
})
