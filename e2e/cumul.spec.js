import { test, expect } from '@playwright/test'

// Cumul d'offres d'un même devis. Dossier jetable ZZTEST-CUMUL, supprimé à la fin.
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}
const ligne = async (id) => (await rest('GET', `fichiers?id=eq.${id}&select=*`))[0]
const estime = async (id) => Number((await rest('GET', `dossiers?id=eq.${id}&select=montant_estime`))[0].montant_estime)
const notes = async (id) => (await rest('GET', `dossier_notes?dossier_id=eq.${id}&select=texte`)).length

let client, dossier, sansDoute, avecDoute

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: 'ZZTEST-CUMUL', prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'negociation', titre: 'ZZTEST-CUMUL dossier' })
  const base = { dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', type_doc: 'devis' }
  ;[sansDoute] = await rest('POST', 'fichiers', {
    ...base, nom: 'ZZTEST_PCICLASSIC_202699014.pdf',
    variantes: [{ libelle: 'Fauteuils cabinets 1 et 2', montant_ttc: 48450 }, { libelle: 'Local panoramique', montant_ttc: 47150 }],
  })
  ;[avecDoute] = await rest('POST', 'fichiers', {
    ...base, nom: 'ZZTEST_VISO_202699015.pdf', date_devis: '2020-01-01',
    a_trancher_raison: 'Montant HT ou TTC non précisé.',
    variantes: [{ libelle: 'Offre A', montant_ttc: 50360 }, { libelle: 'Offre B', montant_ttc: 47150 }],
  })
})

test.afterAll(async () => {
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST-CUMUL dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.ZZTEST-CUMUL`)
})

const ouvrir = async (page) => {
  await page.goto('/')
  await page.locator('input[type=search]').fill('ZZTEST-CUMUL')
  await page.getByText('ZZTEST-CUMUL Essai').click()
  await page.getByText('ZZTEST-CUMUL dossier').click()
  await expect(page.getByLabel('Jalons du dossier')).toBeVisible()
}
const carte = (page, nom) => page.locator('li', { hasText: nom }).first()

test('cumul sans doute HT/TTC : somme, mémoire du choix, un seul tap par offre', async ({ page }) => {
  await ouvrir(page)
  const c = carte(page, 'ZZTEST_PCICLASSIC_202699014')
  await c.getByRole('button', { name: 'Cumuler', exact: true }).click()
  const valider = c.getByRole('button', { name: /^Valider le cumul/ })
  await expect(valider).toBeDisabled()
  await c.getByRole('checkbox', { name: /Fauteuils/ }).click()
  await c.getByRole('checkbox', { name: /Local panoramique/ }).click()
  await expect(c).toContainText(/48.450 \+ 47.150 = 95.600 € TTC/)
  expect((await valider.boundingBox()).height).toBeGreaterThanOrEqual(44)
  await valider.click()
  await expect.poll(async () => (await ligne(sansDoute.id)).montant_ttc).toBe(95600)
  const l = await ligne(sansDoute.id)
  expect(l.variantes_retenues).toEqual([0, 1])
  expect(l.variante_retenue).toBe(0)
  expect(await estime(dossier.id)).toBe(95600)
  expect(await notes(dossier.id)).toBe(1)
  await expect(c).toContainText('Offres cumulées')

  // « Changer » remet le devis à trancher (mémoire effacée)
  await c.getByRole('button', { name: 'Changer', exact: true }).click()
  await expect.poll(async () => (await ligne(sansDoute.id)).variantes_retenues).toBeNull()
  expect((await ligne(sansDoute.id)).montant_ttc).toBeNull()

  // Le choix d'une seule offre reste possible et se mémorise aussi
  await c.getByRole('button', { name: /Local panoramique/ }).first().click()
  await expect.poll(async () => (await ligne(sansDoute.id)).montant_ttc).toBe(47150)
  expect((await ligne(sansDoute.id)).variantes_retenues).toEqual([1])
})

test('cumul avec doute HT/TTC : base par offre, TVA, total, HT conservé seulement si tout est HT', async ({ page }) => {
  await ouvrir(page)
  const c = carte(page, 'ZZTEST_VISO_202699015')
  await c.getByRole('button', { name: 'Cumuler', exact: true }).click()
  await c.getByRole('checkbox', { name: /Offre A/ }).click()
  await c.getByRole('checkbox', { name: /Offre B/ }).click()
  const valider = c.getByRole('button', { name: /^Valider le cumul/ })
  await expect(valider).toBeDisabled() // base non précisée
  await c.getByRole('button', { name: 'HT', exact: true }).first().click()
  await expect(c).toContainText(/× 1,20 = 60.432 €/)
  await expect(valider).toBeDisabled() // la 2e offre n'a pas de base
  await c.getByRole('button', { name: 'TTC', exact: true }).nth(1).click()
  await expect(c).toContainText(/60.432 \+ 47.150 = 107.582 € TTC/)
  expect((await ligne(avecDoute.id)).montant_ttc).toBeNull() // rien d'écrit avant validation
  await valider.click()
  await expect.poll(async () => (await ligne(avecDoute.id)).montant_ttc).toBe(107582)
  const l = await ligne(avecDoute.id)
  expect(l.variantes_retenues).toEqual([0, 1])
  expect(l.montant_ht).toBeNull() // mélange HT/TTC : pas de montant_ht
  // (deux devis chiffrés sur un même dossier se remplacent : le montant du dossier suit le plus récent, règle inchangée)
})

test('hors-ligne : le cumul est mis en file et rejoué sans doublon', async ({ page, context }) => {
  // Remettre le devis sans doute à trancher
  await rest('PATCH', `fichiers?id=eq.${sansDoute.id}`, { montant_ttc: null, variante_retenue: null, variantes_retenues: null })
  const avant = await notes(dossier.id)
  await ouvrir(page)
  const c = carte(page, 'ZZTEST_PCICLASSIC_202699014')
  await context.setOffline(true)
  await c.getByRole('button', { name: 'Cumuler', exact: true }).click()
  await c.getByRole('checkbox', { name: /Fauteuils/ }).click()
  await c.getByRole('checkbox', { name: /Local panoramique/ }).click()
  await c.getByRole('button', { name: /^Valider le cumul/ }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length)).toBeGreaterThan(0)
  expect((await ligne(sansDoute.id)).montant_ttc).toBeNull() // rien n'est parti
  // La même écriture est mise deux fois en file (rejeu d'un même geste) : écriture absolue, pas de doublon
  await page.evaluate(() => {
    const file = JSON.parse(localStorage.getItem('fv9:file-attente'))
    const maj = file.find((a) => a.type === 'update')
    file.push({ ...maj, id: crypto.randomUUID() })
    localStorage.setItem('fv9:file-attente', JSON.stringify(file))
  })
  await context.setOffline(false)
  await page.reload()
  await expect.poll(async () => (await ligne(sansDoute.id)).montant_ttc, { timeout: 30_000 }).toBe(95600)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length), { timeout: 30_000 }).toBe(0)
  expect((await ligne(sansDoute.id)).variantes_retenues).toEqual([0, 1])
  expect(await notes(dossier.id)).toBe(avant + 1) // une seule note, malgré le rejeu
})
