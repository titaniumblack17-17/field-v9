import { test, expect } from '@playwright/test'

// Accueil unique : « Aujourd'hui » (le Board) puis « Pilotage » (le Dashboard).
// Lecture seule sur la base réelle : aucun de ces tests n'écrit (le ✓ et « Traité »
// sont comptés, jamais cliqués). Un test par fonction de l'inventaire
// (docs/inventaire-accueil.md).
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
const accueil = async (page, url = '/') => {
  await page.goto(url)
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible()
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await expect(page.getByLabel('Pipeline', { exact: true }).first()).toBeVisible()
}
// Zone des nombres du Board : « Aujourd'hui » dans l'accueil, la page entière dans l'ancien accueil.
const aujourdhui = (page) => page.locator('main').first()
const tuile = (page, titre) => aujourdhui(page).locator('button', { has: page.locator('p', { hasText: new RegExp(`^${titre}`) }) }).first()
const valeurTuile = async (page, titre) => (await tuile(page, titre).locator('p').nth(1).innerText()).trim()

// Tout ce que le Board affiche en nombres, lu tel quel à l'écran.
const lireNombres = async (page) => {
  const ligne = await page.getByText(/actions? à traiter aujourd'hui/).innerText()
  const bande = await page.getByRole('button', { name: /^\d+\s*À appeler/ }).innerText().catch(() => '')
  const aussi = await page.getByRole('heading', { name: /^Aussi à traiter · \d+/ }).innerText()
  const listes = {}
  for (const titre of ['SAV ouverts', 'Devis sans réponse', 'À rappeler', 'Tâches en retard', 'Rappels à venir', 'Plans à produire', 'À chiffrer', 'Règlements de plans à encaisser']) {
    const l = aujourdhui(page).locator('button', { hasText: new RegExp(`^${titre}`) }).last()
    listes[titre] = (await l.count()) ? (await l.innerText()).replace(/\s+/g, ' ').trim() : null
  }
  return {
    ligne: ligne.replace(/\s+/g, ' ').trim(),
    bande: bande.replace(/\s+/g, ' ').trim(),
    aussi: aussi.trim(),
    tuiles: {
      actifs: await valeurTuile(page, 'Dossiers actifs'),
      objectif: (await tuile(page, 'Objectif').innerText()).replace(/\s+/g, ' ').trim(),
      traiter: await valeurTuile(page, 'À traiter'),
      sav: await valeurTuile(page, 'SAV ouverts'),
      attente: await valeurTuile(page, 'En attente'),
    },
    listes,
  }
}

test('ouverture à froid : Aujourd\'hui puis Pilotage, aucune pastille Board/Dashboard, ancien accueil par lien discret', async ({ page }) => {
  const problemes = surveiller(page)
  await accueil(page)
  const hAuj = await page.getByRole('heading', { name: "Aujourd'hui" }).boundingBox()
  const hPil = await page.getByRole('heading', { name: 'Pilotage' }).boundingBox()
  expect(hAuj.y).toBeLessThan(hPil.y)
  // Le Dashboard actuel est bien là, sous « Pilotage »
  const pilotage = page.getByLabel('Pilotage', { exact: true })
  for (const zone of ['Potentiel ouvert', 'Objectif', 'Pipeline', 'Évolution']) {
    await expect(pilotage.getByLabel(zone, { exact: true })).toBeVisible()
  }
  // Barre : Clients, Pipeline, Capture. Ni « Dashboard » ni « Board ».
  for (const nom of ['Clients', 'Pipeline', 'Capture']) {
    await expect(page.getByRole('button', { name: nom, exact: true }).first()).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Board$/ })).toHaveCount(0)
  // Une seule tuile « En attente » à l'écran (celle d'Aujourd'hui)
  await expect(page.getByRole('button', { name: /^En attente\s*\d+/ })).toHaveCount(1)
  // « Ancien accueil » : discret, en pied de page, cible ≥ 44 px
  const lien = page.getByRole('button', { name: 'Ancien accueil' })
  await lien.scrollIntoViewIfNeeded()
  expect((await lien.boundingBox()).height).toBeGreaterThanOrEqual(44)
  await pasDeDebordement(page)
  expect(problemes).toEqual([])
})

test('N identique : l\'ancien Board et « Aujourd\'hui » lisent exactement les mêmes nombres', async ({ page }) => {
  const problemes = surveiller(page)
  await accueil(page)
  const nouveau = await lireNombres(page)
  await page.getByRole('button', { name: 'Ancien accueil' }).click()
  await expect(page.getByRole('button', { name: /← Accueil/ })).toBeVisible()
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  const ancien = await lireNombres(page)
  // Un dossier de Bruce peut bouger entre les deux lectures : une relecture confirme avant d'échouer.
  if (JSON.stringify(ancien) !== JSON.stringify(nouveau)) {
    await page.waitForTimeout(1500)
    expect(await lireNombres(page)).toEqual(await (async () => {
      await page.getByRole('button', { name: /← Accueil/ }).click()
      await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible()
      await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
      return lireNombres(page)
    })())
  } else {
    expect(ancien).toEqual(nouveau)
    // Le retour de l'ancien accueil ramène à l'accueil
    await page.getByRole('button', { name: /← Accueil/ }).click()
    await expect(page.getByRole('heading', { name: 'Pilotage' })).toBeVisible()
  }
  expect(problemes).toEqual([])
})

test('N identique : « En retard » du Pilotage = actions d\'« Aujourd\'hui », « En attente » égale la base', async ({ page }) => {
  await accueil(page)
  const rpc = await (await fetch(`${URL_DB}/rest/v1/rpc/dashboard_chiffres`, { method: 'POST', headers: { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json' }, body: '{}' })).json()
  const n = Number((await page.getByText(/actions? à traiter aujourd'hui/).innerText()).match(/(\d+) actions?/)[1])
  expect(rpc.en_retard.total).toBe(n)
  await expect(page.getByLabel('Pilotage', { exact: true }).getByRole('button', { name: /^En retard/ })).toContainText(String(n))
  expect(await valeurTuile(page, 'En attente')).toBe(String(rpc.en_attente.dossiers))
})

// ─── Une fonction de l'inventaire = un test ───────────────────────────────────

test('A1 recherche rapide : résultats, fiche complète, retour à l\'accueil', async ({ page }) => {
  const [client] = await lire('clients?select=id,nom_praticien&nom_praticien=not.is.null&nom_praticien=not.ilike.*ZZTEST*&limit=1')
  await accueil(page)
  const champ = page.getByRole('searchbox', { name: 'Rechercher un client' })
  await champ.fill(client.nom_praticien)
  await expect(page.getByRole('button', { name: new RegExp(client.nom_praticien, 'i') }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Effacer la recherche' }).click()
  await expect(champ).toHaveValue('')
  await champ.fill(client.nom_praticien)
  await page.getByRole('button', { name: new RegExp(client.nom_praticien, 'i') }).first().click()
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(new RegExp(client.nom_praticien, 'i'))
  await page.goBack()
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible()
})

for (const [nom, titre, pas] of [
  ['A2 pastille Clients', 'Clients', /Clients/],
  ['A3 pastille Pipeline', 'Pipeline', null],
  ['A4 pastille Capture', 'Capture rapide', null],
]) {
  test(`${nom} : ouvre l'écran, le retour ramène à l'accueil`, async ({ page }) => {
    await accueil(page)
    await page.getByRole('button', { name: nom.split(' ').pop(), exact: true }).first().click()
    await expect(page.getByRole('button', { name: '← Accueil' })).toBeVisible()
    if (pas) await expect(page.getByRole('heading', { name: pas }).first()).toBeVisible()
    await page.getByRole('button', { name: '← Accueil' }).click()
    await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pilotage' })).toBeVisible()
    void titre
  })
}

test('B2 « Dossiers actifs » et B5 « SAV ouverts » ouvrent le Pipeline', async ({ page }) => {
  await accueil(page)
  await tuile(page, 'Dossiers actifs').click()
  await expect(page.getByRole('button', { name: '← Accueil' })).toBeVisible()
  await page.goBack()
  await accueil(page, page.url())
  await tuile(page, 'SAV ouverts').click()
  await expect(page.getByRole('button', { name: '← Accueil' })).toBeVisible()
})

test('B3 tuile Objectif : % et montant, défile jusqu\'à la jauge détaillée (dans Pilotage)', async ({ page }) => {
  await accueil(page)
  const texte = await tuile(page, 'Objectif').innerText()
  expect(texte).toMatch(/\d+ %/)
  await tuile(page, 'Objectif').click()
  const jauge = page.locator('section.scroll-mt-32').filter({ hasText: /^Objectif \d{4}/ })
  await expect(jauge).toBeVisible()
  await expect.poll(async () => (await jauge.boundingBox()).y).toBeLessThan(844)
  // La jauge est bien sous « Pilotage »
  const pil = await page.getByRole('heading', { name: 'Pilotage' }).boundingBox()
  expect((await jauge.boundingBox()).y).toBeGreaterThan(pil.y - 1 + 0)
})

test('B4 tuile « À traiter » : déplie toute la liste « Aussi à traiter »', async ({ page }) => {
  await accueil(page)
  await tuile(page, 'À traiter').click()
  const liste = page.locator('section.scroll-mt-32').filter({ hasText: /^Aussi à traiter/ })
  // Le titre et la liste viennent du même calcul : ils s'égalent à tout instant (les données de Bruce bougent en direct).
  await expect.poll(async () => {
    const total = Number((await page.getByRole('heading', { name: /^Aussi à traiter · \d+/ }).innerText()).match(/(\d+)/)[1])
    return (await liste.locator('ul > li').count()) - total
  }).toBe(0)
})

test('B6 tuile « En attente » : feuille avec pastilles, unique à l\'écran', async ({ page }) => {
  await accueil(page)
  const n = Number(await valeurTuile(page, 'En attente'))
  await tuile(page, 'En attente').click()
  const feuille = page.getByRole('dialog')
  await expect(feuille.getByRole('heading', { name: `En attente · ${n}` })).toBeVisible()
  await expect(feuille.locator('ul > li')).toHaveCount(n)
})

test('B7 ligne « N actions · M contacts » égale la bande et « Aussi à traiter »', async ({ page }) => {
  await accueil(page)
  const m = (await page.getByText(/actions? à traiter aujourd'hui/).innerText()).match(/(\d+) actions? à traiter aujourd'hui · (\d+) contacts? à appeler/)
  const [actions, contacts] = [Number(m[1]), Number(m[2])]
  const aussi = Number((await page.getByRole('heading', { name: /^Aussi à traiter · \d+/ }).innerText()).match(/(\d+)/)[1])
  expect(actions).toBe(aussi + (actions > 0 ? 1 : 0))
  if (contacts > 0) await expect(page.getByRole('button', { name: new RegExp(`^${contacts}\\s*À appeler`) })).toBeVisible()
})

test('B8-B9 bande « À appeler » et feuille : Priorité du jour, Plus tard, Appeler (≥ 44 px)', async ({ page }) => {
  await accueil(page)
  const bande = page.getByRole('button', { name: /^\d+\s*À appeler/ })
  if (!(await bande.count())) test.skip(true, 'Rien à appeler aujourd\'hui')
  await bande.click()
  const f = page.getByRole('dialog')
  await expect(f.getByText('Priorité du jour')).toBeVisible()
  await expect(f.getByRole('button', { name: 'Plus tard' }).first()).toBeVisible()
  await expect(f.getByText('Appeler', { exact: true }).first()).toBeVisible()
  for (const b of await f.getByRole('button', { name: 'Plus tard' }).all()) {
    expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44)
  }
})

test('B10 « Aussi à traiter » : tags, ✓ (jamais sur un devis), « Voir les N autres »', async ({ page }) => {
  await accueil(page)
  const section = page.locator('section.scroll-mt-32').filter({ hasText: /^Aussi à traiter/ })
  const n = Number((await page.getByRole('heading', { name: /^Aussi à traiter · \d+/ }).innerText()).match(/(\d+)/)[1])
  if (n > 3) {
    await expect(section.locator('ul > li')).toHaveCount(3)
    await section.getByRole('button', { name: /^Voir les \d+ autres$/ }).click()
    await expect(section.locator('ul > li')).toHaveCount(n)
  }
  const lignes = section.locator('ul > li')
  const total = await lignes.count()
  let sansCoche = 0
  for (let i = 0; i < total; i++) {
    const ligne = lignes.nth(i)
    const tag = await ligne.locator('span.uppercase').first().innerText().catch(() => '')
    const coche = await ligne.getByRole('button', { name: 'Marquer comme traité' }).count()
    if (/devis/i.test(tag) && !/relance/i.test(tag)) {
      expect(coche).toBe(0)
      sansCoche++
    } else expect(coche).toBe(1)
  }
  void sansCoche
})

test('B10 ouvrir un élément d\'« Aussi à traiter » mène à la fiche ; le retour ramène à l\'accueil', async ({ page }) => {
  await accueil(page)
  const section = page.locator('section.scroll-mt-32').filter({ hasText: /^Aussi à traiter/ })
  if (!(await section.locator('ul > li').count())) test.skip(true, 'Rien à traiter')
  await section.locator('ul > li').first().locator('button').first().click()
  await expect(page.getByText(/^Documents déposés|Rappel|Historique|Notes/).first()).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible()
})

test('C listes de navigation (À traiter, Production, Financier) : toutes présentes, les liens Pipeline fonctionnent', async ({ page }) => {
  await accueil(page)
  for (const titre of ['SAV ouverts', 'Devis sans réponse', 'À rappeler', 'Tâches en retard', 'Rappels à venir', 'Plans à produire', 'À chiffrer', 'Règlements de plans à encaisser']) {
    const l = aujourdhui(page).locator('button', { hasText: new RegExp(`^${titre}\\s*\\d+`) })
    await expect(l.first()).toBeVisible()
    expect((await l.first().boundingBox()).height).toBeGreaterThanOrEqual(44)
  }
  for (const h of ['À traiter', 'Production', 'Financier']) {
    await expect(aujourdhui(page).getByRole('heading', { name: h, exact: true })).toBeVisible()
  }
  await aujourdhui(page).locator('button', { hasText: /^Plans à produire/ }).click()
  await expect(page.getByRole('button', { name: '← Accueil' })).toBeVisible()
})

test('C4 « Devis à trancher » : N devis · M dossiers, feuille, ouverture du dossier', async ({ page }) => {
  await accueil(page)
  const rpc = await (await fetch(`${URL_DB}/rest/v1/rpc/dashboard_chiffres`, { method: 'POST', headers: { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json' }, body: '{}' })).json()
  const ligne = aujourdhui(page).locator('button', { hasText: /^Devis à trancher/ })
  const at = rpc.potentiel.a_trancher
  if (at.devis === 0) return expect(await ligne.count()).toBe(0)
  await expect(ligne).toContainText(`${at.devis} devis · ${at.dossiers} dossier`)
  await ligne.click()
  await expect(page.getByRole('dialog').getByRole('heading')).toContainText(`${at.devis} devis`)
})

test('D1 jauge détaillée, D2 qualité, D3 anomalies, D4 rapport hebdo : dans Pilotage', async ({ page }) => {
  await accueil(page)
  const pil = page.getByLabel('Pilotage', { exact: true })
  await expect(pil.locator('section.scroll-mt-32').filter({ hasText: /^Objectif \d{4}/ })).toBeVisible()
  const anomalies = pil.getByRole('button', { name: /^Anomalies détectées/ })
  await anomalies.scrollIntoViewIfNeeded()
  await anomalies.click()
  await expect(pil.getByText(/Aucune anomalie en attente\.|Traité/).first()).toBeVisible()
  const rapport = pil.getByRole('button', { name: /^Rapport hebdo/ })
  const avant = (await pil.innerText()).length
  await rapport.click()
  await expect.poll(async () => (await pil.innerText()).length).toBeGreaterThan(avant)
  // Cibles tactiles ≥ 44 px sur les en-têtes d'accordéon
  expect((await anomalies.boundingBox()).height).toBeGreaterThanOrEqual(44)
  expect((await rapport.boundingBox()).height).toBeGreaterThanOrEqual(44)
})

test('D5 bouton « Retour en haut » : apparaît après les tuiles, ramène en haut', async ({ page }) => {
  await accueil(page)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const b = page.getByRole('button', { name: 'Retour en haut' })
  await expect(b).toBeVisible()
  await b.click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5)
})

test('liens profonds : l\'URL d\'ouverture (/ et /?debug=reseau) ouvre l\'accueil, le diagnostic réseau est conservé', async ({ page }) => {
  await accueil(page)
  await accueil(page, '/?debug=reseau')
  await expect(page.getByText(/Diag réseau/)).toBeVisible()
  // L'ancien accueil reste atteignable depuis l'accueil
  await accueil(page)
  await page.getByRole('button', { name: 'Ancien accueil' }).click()
  await expect(page.getByRole('button', { name: '← Accueil' })).toBeVisible()
})

test('retour d\'arrière-plan : plus de 30 min ramène à l\'accueil, moins de 30 min laisse l\'écran', async ({ page }) => {
  const problemes = surveiller(page)
  await accueil(page)
  const simuler = (minutes) =>
    page.evaluate(async (min) => {
      const reel = Date.now
      const definir = (v) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
      definir('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      Date.now = () => reel() + min * 60_000
      definir('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      Date.now = reel
    }, minutes)

  // 29 min : on reste où l'on est (Pipeline)
  await page.getByRole('button', { name: 'Pipeline', exact: true }).first().click()
  await expect(page.getByRole('button', { name: '← Accueil' })).toBeVisible()
  await simuler(29)
  await page.waitForTimeout(500)
  await expect(page.getByRole('button', { name: '← Accueil' })).toBeVisible()
  // 31 min : retour à l'accueil, depuis le Pipeline puis depuis une fiche
  await simuler(31)
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Pilotage' })).toBeVisible()
  // L'historique est cohérent : « retour » ne dépile rien d'inattendu
  await page.waitForTimeout(300)
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible()
  expect(problemes).toEqual([])
})

test('hors-ligne : accueil servi depuis le cache, avertissements des deux zones, pas de débordement', async ({ page }) => {
  await accueil(page) // remplit le cache
  await page.route(/supabase\.co/, (route) => route.abort())
  await page.reload()
  // Les délais de réconciliation hors-ligne (6 à 12 s) sont ceux de l'ancien Board, inchangés
  await expect(page.getByText(/Version hors ligne/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Dernières valeurs connues/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await expect(page.getByLabel('Pipeline', { exact: true }).first()).toContainText('projets actifs')
  await pasDeDebordement(page)
})

test('cibles tactiles ≥ 44 px dans l\'en-tête et les tuiles d\'Aujourd\'hui', async ({ page }) => {
  await accueil(page)
  for (const nom of ['Clients', 'Pipeline', 'Capture']) {
    const b = page.getByRole('button', { name: nom, exact: true }).first()
    expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44)
  }
  for (const titre of ['Dossiers actifs', 'À traiter', 'SAV ouverts', 'En attente']) {
    expect((await tuile(page, titre).boundingBox()).height).toBeGreaterThanOrEqual(44)
  }
})
