import { test, expect } from '@playwright/test'
import { aTrancher } from '../src/lib/documents.js'

// Lecture seule sur la base réelle : ces tests n'écrivent rien (« Plus tard »
// reste un état local de l'écran).
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const lire = async (chemin) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { headers: { apikey: CLE, Authorization: `Bearer ${CLE}` } })
  return r.json()
}

const surveiller = (page) => {
  const p = []
  page.on('console', (m) => m.type() === 'error' && p.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => p.push(`pageerror: ${e.message}`))
  page.on('response', (r) => r.status() >= 400 && p.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`))
  return p
}
const pasDeDebordement = async (page) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw).toBeLessThanOrEqual(cw)
}
const accueil = async (page) => {
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
}
const bande = (page) => page.getByRole('button', { name: /^\d+\s*À appeler/ })

test('bande « À appeler » : gabarit, feuille, fermetures, focus, contact', async ({ page }) => {
  const problemes = surveiller(page)
  await accueil(page)
  const b = bande(page)
  await expect(b).toBeVisible()
  const boite = await b.boundingBox()
  expect(boite.height).toBeGreaterThanOrEqual(56)
  await expect(b).toContainText(/À appeler · \d+ contacts?/)
  const n = Number((await b.innerText()).match(/^\d+/)[0])

  // Bouton Appeler : 96 x 56, à droite, 8 px d'écart
  const appeler = page.locator('main').getByText('Appeler', { exact: true }).first()
  const ba = await appeler.boundingBox()
  expect(Math.round(ba.width)).toBe(96)
  expect(Math.round(ba.height)).toBe(56)
  expect(Math.round(ba.x - (boite.x + boite.width))).toBe(8)
  const href = await appeler.getAttribute('href')
  if (href) expect(href).toMatch(/^tel:/)

  // Ouverture
  await b.click()
  const feuille = page.getByRole('dialog')
  await expect(feuille).toBeVisible()
  await expect(feuille).toHaveAttribute('aria-modal', 'true')
  await expect(feuille.getByRole('heading', { name: `À appeler · ${n}` })).toBeVisible()
  const pan = await feuille.boundingBox()
  expect(pan.height).toBeLessThanOrEqual(844 * 0.8 + 1)
  await pasDeDebordement(page)

  // Cibles tactiles ≥ 44 px
  const petits = await feuille.evaluate((el) =>
    [...el.querySelectorAll('button, a')].map((x) => ({ t: x.textContent.trim().slice(0, 20), h: x.getBoundingClientRect().height })).filter((x) => x.h > 0 && x.h < 43.5)
  )
  expect(petits).toEqual([])

  // Une ligne par contact, ≥ 56 px de haut, bouton Appeler 88 x 44
  const lignes = feuille.locator('ul').first().locator('> li')
  await expect(lignes).toHaveCount(n)
  expect((await lignes.first().boundingBox()).height).toBeGreaterThanOrEqual(56)
  const bo = await feuille.getByText('Appeler', { exact: true }).first().boundingBox()
  expect([Math.round(bo.width), Math.round(bo.height)]).toEqual([88, 44])
  await expect(feuille.getByText('Priorité du jour')).toBeVisible()
  // Étiquette de type et ligne de retard sur chaque ligne
  for (let i = 0; i < n; i++) {
    const t = await lignes.nth(i).innerText()
    expect(t).toMatch(/SAV|RAPPEL|TÂCHE|TACHE|DEVIS|RELANCE/i)
    expect(t).toMatch(/En retard de \d+ jours?|À traiter aujourd'hui/)
  }

  // Chaque contact une seule fois, et « Aussi à traiter » ne le répète pas
  const noms = await lignes.locator('button').evaluateAll((bs) =>
    bs.filter((b) => b.querySelector('.font-bold')).map((b) => b.querySelector('.font-bold').lastChild.textContent.trim())
  )
  expect(noms.length).toBe(n)
  expect(new Set(noms).size).toBe(n)
  const aussi = feuille.locator('section ul > li')
  if ((await aussi.count()) > 0) {
    const texte = await feuille.locator('section').innerText()
    for (const nom of noms) expect(texte).not.toContain(nom)
  }

  // Focus piégé : 12 Tab ne sortent jamais de la feuille
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement.closest('[role=dialog]'))).toBe(true)
  }

  // Fermetures : Échap, Fermer, fond
  await page.keyboard.press('Escape')
  await expect(feuille).toBeHidden()
  await b.click()
  await feuille.getByRole('button', { name: 'Fermer' }).click()
  await expect(feuille).toBeHidden()
  await b.click()
  await page.locator('[data-feuille-fond]').click({ position: { x: 10, y: 10 } })
  await expect(feuille).toBeHidden()

  // Tap sur un contact : la fiche s'ouvre, le retour ramène au Board
  await b.click()
  await feuille.locator('ul').first().locator('li button').first().click()
  await expect(page.getByRole('button', { name: /Retour/ })).toBeVisible()
  await expect(feuille).toBeHidden()
  await pasDeDebordement(page)
  await page.goBack()
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  expect(problemes).toEqual([])
})

test('tuile « En attente » : liste filtrée avec pastilles, contact, retour', async ({ page }) => {
  const problemes = surveiller(page)
  await accueil(page)
  const tuile = page.getByRole('button', { name: /^En attente\s*\d+/ })
  const n = Number((await tuile.innerText()).match(/\d+/)[0])
  // bloque_par renseigné et statut non terminal (devis envoyés/relancés exclus)
  const TERMINAUX = ['termine', 'clos', 'solde', 'perdu']
  const enAttenteBase = (await lire('dossiers?bloque_par=not.is.null&select=id,statut,bloque_par')).filter(
    (d) => d.bloque_par.trim() && !TERMINAUX.includes(d.statut)
  )
  expect(n).toBe(enAttenteBase.length)
  expect(n).toBeGreaterThan(0)
  await tuile.click()
  const feuille = page.getByRole('dialog')
  await expect(feuille.getByRole('heading', { name: `En attente · ${n}` })).toBeVisible()
  await expect(feuille.locator('ul > li')).toHaveCount(n)
  const pastilles = feuille.getByText(/⏳ .+ · \d+ j/)
  await expect(pastilles).toHaveCount(n)
  await expect(feuille).toContainText('Kahloun')
  const style = await pastilles.first().evaluate((el) => {
    const c = getComputedStyle(el)
    return { bg: c.backgroundColor, fg: c.color, taille: c.fontSize, poids: c.fontWeight }
  })
  expect(style.bg).toBe('rgb(18, 19, 22)')
  expect(style.fg).toBe('rgb(240, 169, 59)')
  expect(style.taille).toBe('11px')
  expect(Number(style.poids)).toBeGreaterThanOrEqual(700)
  await pasDeDebordement(page)
  await feuille.locator('ul > li button').first().click()
  await expect(page.getByRole('button', { name: /Retour/ })).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  expect(problemes).toEqual([])
})

test('« N devis · M dossiers » : chiffres alignés sur la base', async ({ page }) => {
  const problemes = surveiller(page)
  const fichiers = await lire('fichiers?type_doc=eq.devis&montant_ttc=is.null&dossier_id=not.is.null&select=id,dossier_id,type_doc,montant_ttc,variantes,a_trancher_raison')
  const devis = fichiers.filter(aTrancher)
  const dossiers = new Set(devis.map((f) => f.dossier_id))
  expect(devis.length).toBeGreaterThan(0)
  await accueil(page)
  const ligne = page.getByRole('button', { name: /Devis à trancher/ })
  await expect(ligne).toContainText(`${devis.length} devis · ${dossiers.size} dossier${dossiers.size > 1 ? 's' : ''}`)
  await ligne.click()
  const feuille = page.getByRole('dialog')
  await expect(feuille.locator('ul > li')).toHaveCount(dossiers.size)
  await expect(feuille).toContainText('Dahan')
  await page.keyboard.press('Escape')
  await pasDeDebordement(page)
  expect(problemes).toEqual([])
})

test('Pipeline : pastille « réponse client » restaurée sur les devis, pastilles ⏳ sur bloque_par', async ({ page }) => {
  const problemes = surveiller(page)
  const TERMINAUX = ['termine', 'clos', 'solde', 'perdu']
  const attendus = (await lire('dossiers?bloque_par=not.is.null&select=id,statut,bloque_par')).filter(
    (d) => d.bloque_par.trim() && !TERMINAUX.includes(d.statut)
  )
  await accueil(page)
  // Vue Projet : « ⏳ réponse client — N j » sur Devis envoyé / Relance, comme avant
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click()
  await page.waitForTimeout(800)
  await expect(page.getByText(/⏳ réponse client — \d+ j/).first()).toBeVisible()
  expect(await page.getByText(/⏳ réponse client — \d+ j/).count()).toBe(
    (await lire('dossiers?type=eq.projet&statut=in.(devis_envoye,relance)&select=id')).length
  )
  await page.goBack()
  // Vue SAV : une pastille par dossier dont bloque_par est renseigné (Kahloun compris)
  await page.getByRole('button', { name: /^SAV ouverts/ }).first().click()
  await page.waitForTimeout(800)
  await expect(page.getByText(/⏳ .+ · \d+ j/)).toHaveCount(attendus.length)
  await pasDeDebordement(page)
  expect(problemes).toEqual([])
})

test('« Plus tard » : n\'écarte que l\'élément concerné', async ({ page }) => {
  await accueil(page)
  const b = bande(page)
  const n = Number((await b.innerText()).match(/^\d+/)[0])
  await b.click()
  const feuille = page.getByRole('dialog')
  const lignes = feuille.locator('ul').first().locator('> li')
  const premiere = lignes.first()
  const nom = (await premiere.locator('.font-bold').first().evaluate((e) => e.lastChild.textContent)).trim()
  const aDAutres = /\(\+\d+\)/.test(await premiere.innerText())
  await premiere.getByRole('button', { name: 'Plus tard' }).click()
  if (aDAutres) {
    // Le contact reste, représenté par son élément suivant ; le nombre ne bouge pas
    await expect(lignes).toHaveCount(n)
    await expect(lignes.first().locator('.font-bold').first()).toContainText(nom)
  } else {
    await expect(lignes).toHaveCount(n - 1)
  }
  // L'élément ignoré reste dans « Aussi à traiter » du Board (comportement d'avant)
  await page.keyboard.press('Escape')
  await expect(page.getByText('Aussi à traiter').first()).toBeVisible()
})

test('compteurs du Board : actions = 1 priorité + « Aussi à traiter », contacts = bande', async ({ page }) => {
  await accueil(page)
  const ligne = await page.getByText(/actions? à traiter aujourd'hui/).innerText()
  const [, T, C] = ligne.match(/(\d+) actions? à traiter aujourd'hui · (\d+) contacts? à appeler/)
  const aussi = Number((await page.getByRole('heading', { name: /^Aussi à traiter · \d+/ }).innerText()).match(/(\d+)\s*$/)[1])
  // La priorité du jour (Kahloun ici) est comptée : T = 1 + « Aussi à traiter »
  expect(Number(T)).toBe(1 + aussi)
  expect(Number(C)).toBe(Number((await bande(page).innerText()).match(/^\d+/)[0]))
  expect(Number(C)).toBeLessThanOrEqual(Number(T))
  // Lignes visibles + « Voir les N autres » = « Aussi à traiter »
  const voir = page.getByRole('button', { name: /^Voir les \d+ autres/ })
  const visibles = await page.locator('section', { hasText: 'Aussi à traiter' }).first().locator('ul > li').count()
  const reste = (await voir.count()) ? Number((await voir.innerText()).match(/\d+/)[0]) : 0
  expect(visibles + reste).toBe(aussi)
  if (reste) {
    await voir.click()
    expect(await page.locator('section', { hasText: 'Aussi à traiter' }).first().locator('ul > li').count()).toBe(aussi)
  }
})

for (const [nom, largeur, hauteur] of [['téléphone', 390, 844], ['ordinateur', 1280, 800]]) {
  test(`grille des tuiles équilibrée (${nom})`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: hauteur })
    await accueil(page)
    const tuiles = page.locator('main .grid').first().locator('> button')
    await expect(tuiles).toHaveCount(5)
    const tops = []
    for (let i = 0; i < 5; i++) tops.push(Math.round((await tuiles.nth(i).boundingBox()).y))
    const parLigne = {}
    for (const y of tops) parLigne[y] = (parLigne[y] ?? 0) + 1
    expect(Object.values(parLigne).every((n) => n >= 2)).toBe(true)
    await pasDeDebordement(page)
    // Rien de tronqué dans les tuiles (contenu inchangé, lisible en entier)
    const tronques = await tuiles.evaluateAll((ts) =>
      ts.flatMap((t) => [...t.querySelectorAll('p')]).filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent)
    )
    expect(tronques).toEqual([])
  })
}
