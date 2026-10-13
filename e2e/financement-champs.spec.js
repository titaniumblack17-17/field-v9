import { test, expect } from '@playwright/test'

// Champs du bloc Financement selon le mode : durée en premier, estimation du paiement périodique (jamais écrite
// en base), libellés propres à « En plusieurs fois » avec le même stockage. Fixtures ZZTEST propres à ce passage.
const NOM = `ZZTEST-CHP-${Math.random().toString(36).slice(2, 8)}`
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}
const D = {}
const clients = []
const ligneFin = async (id) => (await rest('GET', `dossier_financement?dossier_id=eq.${id}&select=*`))[0]

test.beforeAll(async () => {
  for (const [cle, montant] of [['A', 10000], ['B', 6000]]) {
    const [c] = await rest('POST', 'clients', { nom_praticien: `${NOM}-${cle}`, prenom_praticien: 'Essai' })
    clients.push(c)
    ;[D[cle]] = await rest('POST', 'dossiers', { client_id: c.id, type: 'projet', statut: 'devis_envoye', titre: `${NOM}-${cle} dossier`, montant_estime: montant })
  }
})
test.afterAll(async () => {
  for (const d of Object.values(D)) await rest('DELETE', `dossiers?id=eq.${d.id}&titre=like.${NOM}*`)
  for (const c of clients) await rest('DELETE', `clients?id=eq.${c.id}&nom_praticien=like.${NOM}*`)
})

async function ouvrirFiche(page, cle) {
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await page.locator('input[type=search]').fill(`${NOM}-${cle}`)
  await page.getByText(`${NOM}-${cle} Essai`).click()
  await page.getByText(`${NOM}-${cle} dossier`).click()
  await expect(page.getByRole('region', { name: 'Financement' })).toBeVisible()
}
const bloc = (page) => page.getByRole('region', { name: 'Financement' })
const aide = (page) => bloc(page).getByTestId('fin-mensualite-aide')
const libelles = (page) => bloc(page).locator('label').allInnerTexts()
const sansDebordement = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('durée en premier, estimation grisée remplacée par la mensualité saisie, libellés « En plusieurs fois »', async ({ page }) => {
  const erreurs = []
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()))
  page.on('pageerror', (e) => erreurs.push(String(e)))
  await ouvrirFiche(page, 'A')
  const b = bloc(page)

  // Banque : « Durée (mois) » vient avant tous les autres champs ; pas d'estimation tant qu'il manque la durée.
  await b.getByRole('button', { name: 'Mode : Banque' }).click()
  await expect(b.getByLabel('Durée (mois)')).toBeVisible()
  expect((await libelles(page))[0]).toBe('Durée (mois)')
  expect(await libelles(page)).toEqual(['Durée (mois)', 'Organisme', 'Montant financé', 'Apport', 'Mensualité'])
  await expect(aide(page)).toHaveCount(0)

  // Durée 48, apport 2 000 : (10 000 − 2 000) / 48 = 166,67 €, grisé, hors intérêts.
  await b.getByLabel('Durée (mois)').fill('48')
  await b.getByLabel('Apport').fill('2000')
  await b.getByLabel('Apport').blur()
  await expect(aide(page)).toContainText('environ 166,67 €/mois, hors intérêts')
  await expect.poll(async () => Number((await ligneFin(D.A.id))?.apport)).toBe(2000) // écriture arrivée en base…
  expect((await ligneFin(D.A.id)).mensualite).toBeNull() // …et l'estimation n'y est jamais écrite
  expect((await ligneFin(D.A.id)).duree_mois).toBe(48)
  await expect(aide(page)).toHaveClass(/text-texte-faible/)

  // Une mensualité saisie remplace l'estimation, et c'est elle qui est stockée.
  await b.getByLabel('Mensualité').fill('190')
  await b.getByLabel('Mensualité').blur()
  await expect(aide(page)).toHaveCount(0)
  await expect.poll(async () => Number((await ligneFin(D.A.id)).mensualite)).toBe(190)
  // Vidée, l'estimation revient.
  await b.getByLabel('Mensualité').fill('')
  await b.getByLabel('Mensualité').blur()
  await expect(aide(page)).toContainText('environ 166,67 €/mois')
  await expect.poll(async () => (await ligneFin(D.A.id)).mensualite).toBeNull()

  // Leasing et Mixte : mêmes libellés, même estimation.
  for (const mode of ['Leasing', 'Mixte']) {
    await b.getByRole('button', { name: `Mode : ${mode}` }).click()
    expect(await libelles(page)).toEqual(['Durée (mois)', 'Organisme', 'Montant financé', 'Apport', 'Mensualité'])
    await expect(aide(page)).toContainText('environ 166,67 €/mois, hors intérêts')
  }

  // En plusieurs fois : libellés propres, mêmes colonnes (durée_mois, mensualite), calcul automatique si vide.
  await b.getByRole('button', { name: 'Mode : En plusieurs fois' }).click()
  expect(await libelles(page)).toEqual(['Nombre de fois', 'Organisme', 'Montant financé', 'Apport', 'Montant par échéance'])
  await expect(b.getByLabel('Nombre de fois')).toHaveValue('48')
  await expect(aide(page)).toContainText('166,67 € par échéance (calculé)')
  await expect(aide(page)).not.toContainText('hors intérêts')
  await b.getByLabel('Nombre de fois').fill('4')
  await b.getByLabel('Nombre de fois').blur()
  await expect(aide(page)).toContainText('2 000 € par échéance (calculé)')
  await expect.poll(async () => (await ligneFin(D.A.id)).duree_mois).toBe(4)
  await b.getByLabel('Montant par échéance').fill('2500')
  await b.getByLabel('Montant par échéance').blur()
  await expect(aide(page)).toHaveCount(0)
  await expect.poll(async () => Number((await ligneFin(D.A.id)).mensualite)).toBe(2500)

  // Retour à Banque : libellés d'origine ; Comptant : aucun champ.
  await b.getByRole('button', { name: 'Mode : Banque' }).click()
  expect((await libelles(page))[0]).toBe('Durée (mois)')
  await b.getByRole('button', { name: 'Mode : Comptant' }).click()
  await expect(b.getByLabel('Durée (mois)')).toHaveCount(0)
  expect(await sansDebordement(page)).toBe(true)
  expect(erreurs, erreurs.join('\n')).toEqual([])
})

test('hors ligne : l’estimation se calcule sans réseau, la durée est rejouée au retour', async ({ page, context }) => {
  test.setTimeout(110_000)
  await ouvrirFiche(page, 'B')
  const b = bloc(page)
  await context.setOffline(true)
  await b.getByRole('button', { name: 'Mode : Banque' }).click() // crée le financement en file, montant financé 6 000 pré-rempli
  await b.getByLabel('Durée (mois)').fill('12')
  await b.getByLabel('Durée (mois)').blur()
  await expect(aide(page)).toContainText('environ 500 €/mois, hors intérêts')
  await expect(b).toContainText('Enregistré hors ligne')
  await context.setOffline(false)
  await expect.poll(async () => (await ligneFin(D.B.id))?.duree_mois, { timeout: 80_000 }).toBe(12)
  const l = await ligneFin(D.B.id)
  expect(Number(l.montant_finance)).toBe(6000)
  expect(l.mensualite).toBeNull()
})
