import { test, expect } from '@playwright/test'
import fs from 'node:fs'

// Smoke test de fin de phase : Brief du soir, rapport hebdo, capture (en ligne
// et hors-ligne), rappel + synchro Todoist. Écrit uniquement sur des lignes
// préfixées ZZTEST-SMOKE, supprimées à la fin ; l'identifiant de la tâche
// Todoist créée est consigné dans test-results/ pour être supprimé aussi.
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}

let client, dossier
const taches = []

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: 'ZZTEST-SMOKE', prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: 'ZZTEST-SMOKE dossier' })
})

test.afterAll(async () => {
  const rappels = await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=id,todoist_task_id`)
  for (const r of rappels) if (r.todoist_task_id) taches.push(r.todoist_task_id)
  fs.mkdirSync('test-results', { recursive: true })
  fs.writeFileSync('test-results/smoke-todoist.json', JSON.stringify(taches))
  await rest('DELETE', `rappels?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', 'captures?texte=like.ZZTEST-SMOKE*')
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST-SMOKE dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.ZZTEST-SMOKE`)
})

const surveiller = (page) => {
  const p = []
  page.on('console', (m) => m.type() === 'error' && p.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => p.push(`pageerror: ${e.message}`))
  page.on('response', (r) => r.status() >= 400 && p.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`))
  return p
}

test('Brief du soir : Priorité du jour, Aussi à traiter, rapport hebdo', async ({ page }) => {
  const problemes = surveiller(page)
  await page.goto('/')
  // La carte « Priorité du jour » est devenue la bande « À appeler » ; son
  // contenu reste accessible dans la feuille.
  await page.getByRole('button', { name: /^\d+\s*À appeler/ }).click()
  await expect(page.getByRole('dialog').getByText('Priorité du jour')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Aussi à traiter', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: /Voir les \d+ autres/ }).click()
  const rapport = page.getByRole('button', { name: /Rapport hebdo/ })
  await rapport.scrollIntoViewIfNeeded()
  const avant = (await page.locator('main').innerText()).length
  await rapport.click()
  await expect.poll(async () => (await page.locator('main').innerText()).length).toBeGreaterThan(avant + 40)
  expect(problemes).toEqual([])
})

test('capture : envoi en ligne, puis hors-ligne mis en file et rejoué', async ({ page, context }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Capture', exact: true }).click()
  const champ = page.getByPlaceholder("Client, qu'est-ce qui se passe ?")
  await champ.fill('ZZTEST-SMOKE en ligne : essai de capture, ne rien créer.')
  await page.getByRole('button', { name: 'Envoyer' }).click()
  await expect.poll(async () => (await rest('GET', 'captures?texte=like.ZZTEST-SMOKE*%20en%20ligne*&select=id')).length, { timeout: 40_000 }).toBe(1)

  await context.setOffline(true)
  await champ.fill('ZZTEST-SMOKE hors-ligne : essai de capture, ne rien créer.')
  await page.getByRole('button', { name: 'Envoyer' }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length), { timeout: 15_000 }).toBeGreaterThan(0)
  expect((await rest('GET', 'captures?texte=like.ZZTEST-SMOKE*hors-ligne*&select=id')).length).toBe(0)
  await context.setOffline(false)
  await expect.poll(async () => (await rest('GET', 'captures?texte=like.ZZTEST-SMOKE*hors-ligne*&select=id')).length, { timeout: 60_000 }).toBe(1)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length)).toBe(0)
})

test('rappel : création, synchro Todoist, clôture', async ({ page }) => {
  const problemes = surveiller(page)
  await page.goto('/')
  await page.locator('input[type=search]').fill('ZZTEST-SMOKE')
  await page.getByText('ZZTEST-SMOKE Essai').click()
  await page.getByText('ZZTEST-SMOKE dossier').click()
  await page.getByRole('button', { name: '+ Ajouter' }).first().click()
  await page.locator('#rappel-date').fill('2026-10-12') // un lundi
  await page.locator('#rappel-note').fill('ZZTEST-SMOKE rappel de test — à supprimer')
  await page.getByRole('button', { name: 'Poser ce rappel' }).click()
  await expect.poll(async () => (await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=todoist_task_id`))[0]?.todoist_task_id ?? null, { timeout: 30_000 }).not.toBeNull()

  await page.getByRole('button', { name: 'Marquer ce rappel comme fait' }).click()
  const enregistrer = page.getByRole('button', { name: 'Valider' })
  await enregistrer.click()
  await expect.poll(async () => (await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=fait_at`))[0]?.fait_at ?? null, { timeout: 20_000 }).not.toBeNull()
  expect(problemes).toEqual([])
})
