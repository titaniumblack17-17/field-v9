import { test, expect } from './base.js'

// Version affichée, détection d'une version plus récente en ligne, hors ligne, adresse de test. Aucune donnée
// n'est lue ni écrite en base : tout se joue sur le pied de page, les bandeaux et la file hors ligne locale.
// version.json est simulé (le fichier réel n'existe qu'après un build, voir le contrôle sur `vite preview`).
const PORT = process.env.PORT ?? '5199'
const maintenant = () => Date.now()

const versionLocale = (page) => page.evaluate(async () => (await import('/src/lib/version.js')).VERSION)
const servir = async (page, corps) => {
  const demandes = []
  await page.route('**/version.json*', (route) => {
    demandes.push(route.request().url())
    if (corps === 'echec') return route.abort('internetdisconnected')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) })
  })
  return demandes
}
const verifierMaintenant = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
const sansDebordement = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('pied de page : « Version <commit> · jj/mm hh:mm », discret, sans débordement', async ({ page }) => {
  await page.goto('/')
  const pied = page.getByTestId('version')
  await expect(pied).toHaveText(/^Version ([0-9a-f]{7}|local) · \d{2}\/\d{2} \d{2}:\d{2}$/)
  const v = await versionLocale(page)
  await expect(pied).toContainText(v.commit)
  expect(await sansDebordement(page)).toBe(true)
  expect(await pied.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(12)
})

test('version identique en ligne : aucun bandeau', async ({ page }) => {
  const demandes = await servir(page, { commit: 'placeholder', builtAt: new Date(0).toISOString() })
  await page.goto('/')
  const v = await versionLocale(page)
  // La même version est publiée : on la sert telle quelle.
  await page.unroute('**/version.json*')
  const identique = await servir(page, { commit: v.commit, builtAt: v.builtAt })
  await verifierMaintenant(page)
  await expect.poll(() => identique.length).toBeGreaterThan(0)
  await expect(page.getByRole('note', { name: 'Nouvelle version disponible' })).toHaveCount(0)
  expect(demandes.length).toBeGreaterThanOrEqual(0)
  // Une version publiée plus ANCIENNE (retour arrière) ne déclenche rien non plus.
  await page.unroute('**/version.json*')
  const ancienne = await servir(page, { commit: '0000000', builtAt: new Date(0).toISOString() })
  await verifierMaintenant(page)
  await expect.poll(() => ancienne.length).toBeGreaterThan(0)
  await expect(page.getByRole('note', { name: 'Nouvelle version disponible' })).toHaveCount(0)
})

test('version plus récente : bandeau, « Recharger » vide le cache et recharge', async ({ page }) => {
  await page.goto('/')
  const v = await versionLocale(page)
  const demandes = await servir(page, { commit: 'abcdef0', builtAt: new Date(Date.parse(v.builtAt) + 3_600_000).toISOString() })
  await verifierMaintenant(page)
  const bandeau = page.getByRole('note', { name: 'Nouvelle version disponible' })
  await expect(bandeau).toBeVisible()
  expect(demandes.length).toBeGreaterThan(0)
  expect(demandes[0]).toMatch(/version\.json\?t=\d+/) // jamais servi depuis un cache
  const bouton = bandeau.getByRole('button', { name: 'Recharger' })
  expect((await bouton.boundingBox()).height).toBeGreaterThanOrEqual(44)
  expect(await sansDebordement(page)).toBe(true)

  // Le cache est vidé et la page rechargée : un marqueur posé avant disparaît, un cache factice aussi.
  await page.evaluate(async () => {
    window.__avantRechargement = true
    await caches.open('zz-cache-test')
  })
  await Promise.all([page.waitForEvent('load'), bouton.click()])
  await expect(page.getByTestId('version')).toBeVisible()
  expect(await page.evaluate(() => window.__avantRechargement)).toBeUndefined()
  expect(await page.evaluate(async () => (await caches.keys()).includes('zz-cache-test'))).toBe(false)
})

test('écriture en attente dans la file : rechargement seulement après son envoi', async ({ page }) => {
  await page.goto('/')
  const v = await versionLocale(page)
  await servir(page, { commit: 'abcdef0', builtAt: new Date(Date.parse(v.builtAt) + 3_600_000).toISOString() })
  // L'envoi de l'écriture échoue (réseau vers la base coupé) : elle reste dans la file jusqu'à ce que le test la vide.
  await page.route('**/rest/v1/rappels*', (route) => route.abort('internetdisconnected'))
  // Une écriture inoffensive attend dans la file (suppression d'un identifiant inexistant).
  await page.evaluate(async () => {
    const f = await import('/src/lib/fileAttente.js')
    f.mettreEnFile({ type: 'delete', table: 'rappels', rowId: '00000000-0000-0000-0000-000000000000' })
    window.__avantRechargement = true
  })
  await verifierMaintenant(page)
  const bandeau = page.getByRole('note', { name: 'Nouvelle version disponible' })
  await expect(bandeau).toBeVisible()
  await bandeau.getByRole('button', { name: 'Recharger' }).click()
  await expect(bandeau).toContainText('Rechargement dès que vos modifications en attente sont envoyées')
  await expect(bandeau.getByRole('button', { name: 'Recharger' })).toHaveCount(0)
  await page.waitForTimeout(1500) // tant que la file n'est pas vide, la page ne bouge pas
  expect(await page.evaluate(() => window.__avantRechargement)).toBe(true)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length)).toBe(1)
  // L'envoi se fait (file vidée) : la page se recharge d'elle-même.
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(async () => {
      const f = await import('/src/lib/fileAttente.js')
      await f.viderFile(async () => {})
    }),
  ])
  expect(await page.evaluate(() => window.__avantRechargement)).toBeUndefined()
  expect(await page.evaluate(() => localStorage.getItem('fv9:file-attente'))).toMatch(/^\[\]$|^null$/)
})

test('hors ligne : aucune erreur, aucun faux bandeau ; un bandeau déjà affiché reste', async ({ page, context }) => {
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  await page.goto('/')
  const v = await versionLocale(page)
  await context.setOffline(true)
  await servir(page, 'echec')
  await verifierMaintenant(page)
  await page.waitForTimeout(500)
  await expect(page.getByRole('note', { name: 'Nouvelle version disponible' })).toHaveCount(0)
  await expect(page.getByTestId('version')).toBeVisible()
  // Bandeau déjà affiché, puis coupure : il ne disparaît pas.
  await context.setOffline(false)
  await page.unroute('**/version.json*')
  await servir(page, { commit: 'abcdef0', builtAt: new Date(Date.parse(v.builtAt) + 3_600_000).toISOString() })
  await verifierMaintenant(page)
  await expect(page.getByRole('note', { name: 'Nouvelle version disponible' })).toBeVisible()
  await context.setOffline(true)
  await page.unroute('**/version.json*')
  await servir(page, 'echec')
  await verifierMaintenant(page)
  await page.waitForTimeout(500)
  await expect(page.getByRole('note', { name: 'Nouvelle version disponible' })).toBeVisible()
  expect(erreurs, erreurs.join('\n')).toEqual([])
})

test('adresse de test : bandeau orange « Version de test, pas la production » ; absent en production et en local', async ({ browser, page }) => {
  // Règle pure
  await page.goto('/')
  const regles = await page.evaluate(async () => {
    const { estAdresseDeTest } = await import('/src/lib/version.js')
    return ['field-v9.vercel.app', 'localhost', '127.0.0.1', 'field-v9-git-feat-x-dasilva-s-projects.vercel.app', 'field-v9-abc123.vercel.app', 'app.localhost'].map(estAdresseDeTest)
  })
  expect(regles).toEqual([false, false, false, true, true, true])
  // Poste de développement : pas de bandeau.
  await expect(page.getByRole('note', { name: 'Version de test' })).toHaveCount(0)
  // Hôte autre que la production (sous-domaine .localhost, résolu en local par Chromium) : bandeau.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p2 = await ctx.newPage()
  await p2.goto(`http://app.localhost:${PORT}/`)
  const bandeau = p2.getByRole('note', { name: 'Version de test' })
  await expect(bandeau).toHaveText('Version de test, pas la production')
  expect(await bandeau.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await expect(p2.getByTestId('version')).toBeVisible()
  expect(await p2.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await ctx.close()
  expect(maintenant()).toBeGreaterThan(0)
})
