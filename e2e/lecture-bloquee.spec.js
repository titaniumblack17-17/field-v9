import { test, expect } from './base.js'

// Une lecture qui ne revient jamais (constaté : GET /dossiers resté en vol 45 s en suite complète) ne doit
// pas laisser l'écran sur « Chargement… » : au-delà du délai, dernière version connue, signalée comme telle.
// Lecture seule sur la base réelle.
test('une lecture du Pipeline qui ne revient jamais : dernière version connue après le délai, pas de chargement sans fin', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  // 1re ouverture normale : remplit la dernière version connue
  await page.getByRole('button', { name: 'Pipeline', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Kanban Projet' })).toContainText(/Projet\s*[1-9]/)
  await page.goBack()
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()

  // La lecture des dossiers du Pipeline reste en vol pour toujours
  await page.route(/\/rest\/v1\/dossiers\?.*type=in/, () => {})
  await page.getByRole('button', { name: 'Pipeline', exact: true }).first().click()
  await expect(page.getByText('Chargement…')).toBeVisible()
  await expect(page.getByText(/hors ligne/i)).toBeVisible({ timeout: 40_000 })
  await expect(page.getByText('Chargement…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Kanban Projet' })).toContainText(/Projet\s*[1-9]/)
})
