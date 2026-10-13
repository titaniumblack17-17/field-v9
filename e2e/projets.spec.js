import { test, expect } from '@playwright/test'
import { FAMILLES } from '../src/constants/dashboard.js'
import { ETAPES_PROJET_LABELS } from '../src/constants/dossiers.js'
import { rendu } from './aides.js'

// Phase 4 — liste des projets et fiche projet. Lecture seule sur la base réelle pour la liste ;
// la fiche utilise un dossier jetable ZZTEST (nom unique par passage).
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}
const rpc = async () => (await fetch(`${URL_DB}/rest/v1/rpc/dashboard_chiffres`, { method: 'POST', headers: entetes, body: '{}' })).json()

const surveiller = (page) => {
  const p = []
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_FAILED') && p.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => p.push(`pageerror: ${e.message}`))
  page.on('response', (r) => r.status() >= 400 && p.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`))
  return p
}
const pasDeDebordement = async (page) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw).toBeLessThanOrEqual(cw)
}

const ouvrirListe = async (page) => {
  await page.evaluate(() => sessionStorage.clear()).catch(() => {})
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projets' })).toBeVisible()
  await expect(page.getByLabel('Projets', { exact: true })).toBeVisible()
}
const lignes = (page) => page.getByLabel('Projets', { exact: true }).locator('> li')
const filtres = (page) => page.getByRole('group', { name: 'Filtres' })
const compteur = async (bouton) => Number((await bouton.getAttribute('aria-label')).match(/(\d+)\s*$/)[1])
const chip = (page, libelle) => filtres(page).getByRole('button', { name: new RegExp(`^${libelle} : \\d+`) })
const total = async (page) => Number((await page.getByText(/^\d+ (projets|sur)/).first().innerText()).match(/^(\d+)/)[1])

test('liste : une ligne par projet actif ; compteurs des filtres = base = RPC ; aucun débordement, aucune erreur', async ({ page }) => {
  const problemes = surveiller(page)
  await ouvrirListe(page)
  await expect(async () => {
    const c = await rpc()
    const brut = await rest('GET', 'dossiers?select=id,statut&type=eq.projet&statut=not.in.(perdu,termine)')
    expect(await lignes(page).count()).toBe(c.projets.actifs)
    expect(brut.length).toBe(c.projets.actifs)
    expect(c.projets.actifs).toBe(c.projets_actifs)
    for (const f of FAMILLES) {
      const nb = c.familles.find((x) => x.cle === f.cle).nb
      expect(await compteur(chip(page, `Famille ${f.libelle}`))).toBe(nb)
      expect(brut.filter((d) => f.etapes.includes(d.statut)).length).toBe(nb)
    }
    expect(await compteur(chip(page, 'Dossiers à trancher'))).toBe(c.projets.a_trancher)
    expect(await compteur(chip(page, 'Dossiers reportés'))).toBe(c.projets.reportes)
    expect(await compteur(chip(page, 'Projets en attente'))).toBe(c.projets.en_attente)
    expect(await compteur(chip(page, 'Projets incomplets'))).toBe(c.projets.incomplets)
    // …et les compteurs égalent ceux du Pilotage (portée projets)
    expect(c.projets.incomplets).toBe(c.incomplets.dossiers)
    expect(c.projets.a_trancher).toBe(c.potentiel.a_trancher.dossiers) // « À trancher » : même nombre dans le Pilotage
    expect(c.projets.reportes).toBe(c.potentiel.reportees.dossiers) // « Offres reportées · dossiers »
  }).toPass({ timeout: 30_000 })
  // Cibles tactiles ≥ 44 px
  for (const b of await page.getByRole('group', { name: 'Tri' }).getByRole('button').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44)
  for (const b of await filtres(page).getByRole('button').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44)
  expect((await lignes(page).first().boundingBox()).height).toBeGreaterThanOrEqual(44)
  await pasDeDebordement(page)
  expect(problemes).toEqual([])
})

test('chaque filtre : le nombre de lignes égale son compteur', async ({ page }) => {
  await ouvrirListe(page)
  const intitules = [...FAMILLES.map((f) => `Famille ${f.libelle}`), 'Dossiers à trancher', 'Dossiers reportés', 'Projets en attente', 'Projets incomplets']
  for (const intitule of intitules) {
    const b = chip(page, intitule)
    const n = await compteur(b)
    await b.click()
    await expect(b).toHaveAttribute('aria-pressed', 'true')
    if (n === 0) await expect(page.getByText('Aucun projet pour ces filtres.')).toBeVisible()
    else await expect(lignes(page)).toHaveCount(n)
    await b.click() // second tap : le filtre se retire
    await expect(b).toHaveAttribute('aria-pressed', 'false')
  }
  await pasDeDebordement(page)
})

test('chaque tri : l\'ordre affiché suit le critère', async ({ page }) => {
  await ouvrirListe(page)
  const lire = async () => {
    const items = await lignes(page).all()
    const out = []
    for (const li of items) {
      const t = await li.innerText()
      const montant = t.match(/([\d\u00a0\u202f ]+) €/)?.[1]?.replace(/\D/g, '')
      const etape = Object.values(ETAPES_PROJET_LABELS).find((e) => t.includes(`\n${e}\n`) || t.includes(`${e}\nil y a`) || t.includes(`${e}\naujourd`)) ?? null
      const jours = t.split('\n').includes("aujourd'hui") ? 0 : Number(t.match(/il y a (\d+) j/)?.[1] ?? NaN)
      const rang = /(Rappel|Tâche|Relance devis|Devis) · .*(retard|sans réponse|jour)/i.test(t) ? 3 : /Devis à trancher|manquant/.test(t) ? 2 : /En attente/.test(t) ? 1 : 0
      out.push({ montant: montant == null ? null : Number(montant), etape, jours, rang })
    }
    return out
  }
  const tri = (nom) => page.getByRole('group', { name: 'Tri' }).getByRole('button', { name: `Trier : ${nom}` })

  await expect(tri('Action à faire')).toHaveAttribute('aria-pressed', 'true') // tri par défaut
  const parAction = await lire()
  for (let i = 1; i < parAction.length; i++) expect(parAction[i].rang).toBeLessThanOrEqual(parAction[i - 1].rang)

  await tri('Montant').click()
  await expect(tri('Montant')).toHaveAttribute('aria-pressed', 'true')
  const parMontant = (await lire()).map((l) => l.montant ?? -1)
  for (let i = 1; i < parMontant.length; i++) expect(parMontant[i]).toBeLessThanOrEqual(parMontant[i - 1])

  await tri('Étape').click()
  const ordre = Object.values(ETAPES_PROJET_LABELS)
  const parEtape = (await lire()).map((l) => ordre.indexOf(l.etape))
  expect(parEtape.every((x) => x >= 0)).toBe(true)
  for (let i = 1; i < parEtape.length; i++) expect(parEtape[i]).toBeGreaterThanOrEqual(parEtape[i - 1])

  await tri('Ancienneté').click()
  const parAnc = (await lire()).map((l) => l.jours)
  for (let i = 1; i < parAnc.length; i++) expect(parAnc[i]).toBeLessThanOrEqual(parAnc[i - 1])
  // Sens confirmé sur la base : la dernière action de chaque projet, recalculée ici à part, va de la plus
  // ancienne (en haut : sans action depuis le plus longtemps) à la plus récente.
  const [dossiers, notes, etapes, fichiersDocs] = await Promise.all([
    rest('GET', 'dossiers?select=id,created_at,statut_changed_at&type=eq.projet'),
    rest('GET', 'dossier_notes?select=dossier_id,created_at'),
    rest('GET', 'dossier_etapes_historique?select=dossier_id,changed_at'),
    rest('GET', 'fichiers?select=dossier_id,created_at&dossier_id=not.is.null'),
  ])
  const derniere = new Map(dossiers.map((d) => [d.id, Math.max(Date.parse(d.created_at), Date.parse(d.statut_changed_at ?? 0) || 0)]))
  const noter = (id, t) => derniere.has(id) && t > derniere.get(id) && derniere.set(id, t)
  notes.forEach((n) => noter(n.dossier_id, Date.parse(n.created_at)))
  etapes.forEach((e) => noter(e.dossier_id, Date.parse(e.changed_at)))
  fichiersDocs.forEach((f) => noter(f.dossier_id, Date.parse(f.created_at)))
  const ids = await lignes(page).evaluateAll((lis) => lis.map((li) => li.getAttribute('data-dossier-id')))
  const instants = ids.map((id) => derniere.get(id))
  for (let i = 1; i < instants.length; i++) expect(instants[i]).toBeGreaterThanOrEqual(instants[i - 1] - 86_400_000) // à un jour près (arrondi affiché)
  await pasDeDebordement(page)
})

test('recherche texte : client, titre ; vider rétablit la liste', async ({ page }) => {
  await ouvrirListe(page)
  const n0 = await lignes(page).count()
  const cible = (await lignes(page).first().locator('span.font-semibold').first().innerText()).split(/[ /]/)[0]
  await page.getByRole('searchbox', { name: 'Rechercher un projet' }).fill(cible)
  await expect(async () => {
    const t = await lignes(page).allInnerTexts()
    expect(t.length).toBeGreaterThan(0)
    for (const x of t) expect(x.toLowerCase()).toContain(cible.toLowerCase())
  }).toPass()
  await page.getByRole('searchbox', { name: 'Rechercher un projet' }).fill('zzzz-introuvable')
  await expect(page.getByText('Aucun projet pour ces filtres.')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Rechercher un projet' }).fill('')
  await expect(lignes(page)).toHaveCount(n0)
})

test('ouverture d\'une fiche et retour : filtres, tri, recherche et position conservés', async ({ page }) => {
  const problemes = surveiller(page)
  await ouvrirListe(page)
  await chip(page, 'Famille Devis').click()
  await page.getByRole('group', { name: 'Tri' }).getByRole('button', { name: 'Trier : Montant' }).click()
  const n = await lignes(page).count()
  expect(n).toBeGreaterThan(5)
  // On défile, puis on ouvre une ligne du bas
  await lignes(page).nth(n - 1).scrollIntoViewIfNeeded()
  const y0 = await page.evaluate(() => window.scrollY)
  expect(y0).toBeGreaterThan(100)
  const nom = await lignes(page).nth(n - 1).locator('span.font-semibold').first().innerText()
  await lignes(page).nth(n - 1).click()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await expect(page.getByLabel('Synthèse du projet')).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Projets' })).toBeVisible()
  await expect(chip(page, 'Famille Devis')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: 'Tri' }).getByRole('button', { name: 'Trier : Montant' })).toHaveAttribute('aria-pressed', 'true')
  await expect(lignes(page)).toHaveCount(n)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0 - 150)
  await expect(lignes(page).filter({ hasText: nom }).first()).toBeInViewport()
  await pasDeDebordement(page)
  expect(problemes).toEqual([])
})

test('points d\'entrée : pastille « Projets » (accueil et ancien accueil), famille du Pilotage, « Tous les projets »', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  const pastille = page.getByRole('button', { name: 'Projets', exact: true })
  expect((await pastille.boundingBox()).height).toBeGreaterThanOrEqual(44)
  // à côté de Clients / Pipeline / Capture
  for (const nom of ['Clients', 'Pipeline', 'Capture']) await expect(page.getByRole('button', { name: nom, exact: true }).first()).toBeVisible()
  // depuis une famille du Pilotage : la liste arrive filtrée sur cette famille
  await page.evaluate(() => sessionStorage.clear())
  await page.getByRole('button', { name: 'Liste des projets : Devis' }).click()
  await expect(page.getByRole('heading', { name: 'Projets' })).toBeVisible()
  await expect(chip(page, 'Famille Devis')).toHaveAttribute('aria-pressed', 'true')
  await page.goBack()
  await page.getByRole('button', { name: 'Tous les projets ›' }).click()
  await expect(page.getByRole('heading', { name: 'Projets' })).toBeVisible()
  await expect(chip(page, 'Famille Devis')).toHaveAttribute('aria-pressed', 'false')
  await page.goBack()
  // ancien accueil
  await page.getByRole('button', { name: 'Ancien accueil' }).click()
  await page.getByRole('button', { name: 'Projets', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projets' })).toBeVisible()
})

test('hors-ligne : la liste vient de la dernière version connue, signalée', async ({ page }) => {
  await ouvrirListe(page)
  const n = await lignes(page).count()
  await page.route(/supabase\.co/, (route) => route.abort())
  await page.reload()
  await page.getByRole('button', { name: 'Projets', exact: true }).click({ timeout: 30_000 })
  await expect(page.getByText(/Version hors ligne/)).toBeVisible({ timeout: 40_000 })
  await expect(lignes(page)).toHaveCount(n)
  await pasDeDebordement(page)
})

// ─── Fiche projet ─────────────────────────────────────────────────────────────────────────

test.describe('fiche projet', () => {
  const NOM = `ZZTEST-P4-${Math.random().toString(36).slice(2, 8)}`
  let client, projet, sav
  test.beforeAll(async () => {
    ;[client] = await rest('POST', 'clients', { nom_praticien: NOM, prenom_praticien: 'Essai' })
    ;[projet] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: `${NOM} projet`, plan_statut: 'a_faire' })
    ;[sav] = await rest('POST', 'dossiers', { client_id: client.id, type: 'sav', statut: 'en_attente', titre: `${NOM} sav`, bloque_par: 'fournisseur' })
    await rest('POST', 'fichiers', {
      dossier_id: projet.id, chemin: 'zztest/aucun.pdf', taille: 1, type_mime: 'application/pdf', type_doc: 'devis', nom: 'ZZTEST_P4_202699702.pdf',
      date_devis: '2026-10-02', variantes: [{ libelle: 'Option', montant_ttc: 700, etat: 'reportee', date_reprise: '2027-01-15' }],
    })
    await rest('POST', 'fichiers', {
      dossier_id: projet.id, chemin: 'zztest/aucun.pdf', taille: 1, type_mime: 'application/pdf', type_doc: 'devis', nom: 'ZZTEST_P4_202699701.pdf',
      date_devis: '2026-10-01', variantes: [{ libelle: 'Fauteuils', montant_ttc: 1000, etat: 'a_trancher' }, { libelle: 'Local', montant_ttc: 2000, etat: 'a_trancher' }],
    })
  })
  test.afterAll(async () => {
    // Nettoyage par nom unique : même si beforeAll a échoué à mi-chemin, rien ne reste.
    await rest('DELETE', `fichiers?chemin=eq.zztest/aucun.pdf&nom=like.ZZTEST_P4_2026997*`)
    await rest('DELETE', `dossiers?titre=like.${NOM}*`)
    await rest('DELETE', `clients?nom_praticien=eq.${NOM}`)
  })

  const ouvrir = async (page, titre) => {
    await page.route(/todoist-rappel|todoist-tache/, (route) => route.abort())
    await page.evaluate(() => sessionStorage.clear()).catch(() => {})
    await page.goto('/')
    await page.locator('input[type=search]').fill(NOM)
    await page.getByText(`${NOM} Essai`).click()
    await page.getByText(titre).click()
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(titre)
  }

  test('synthèse : étape, montant, objectif, devis — chaque zone mène au bon écran', async ({ page }) => {
    const problemes = surveiller(page)
    await ouvrir(page, `${NOM} projet`)
    const synthese = page.getByLabel('Synthèse du projet')
    await expect(synthese).toBeVisible()
    await expect(synthese).toContainText('Devis envoyé')
    await expect(synthese).toContainText('à chiffrer') // jamais 0 €
    await expect(synthese).toContainText('Non signé')
    await expect(synthese).toContainText('2 devis · 3 offres')
    await expect(synthese).toContainText('2 à trancher')
    for (const b of await synthese.getByRole('button').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44)

    // Étape → Pipeline filtré sur la famille
    await synthese.getByRole('button', { name: /^Étape : Devis envoyé/ }).click()
    await expect(page.getByText('Famille : Devis')).toBeVisible({ timeout: 45_000 })
    await page.goBack()
    // Objectif → accueil (Pilotage)
    await page.getByLabel('Synthèse du projet').getByRole('button', { name: /^Objectif/ }).click()
    await expect(page.getByRole('heading', { name: 'Pilotage' })).toBeVisible()
    await page.goBack()
    // Montant et devis → zone Documents ouverte, décisions par offre visibles
    await page.getByLabel('Synthèse du projet').getByRole('button', { name: /^Montant/ }).click()
    await expect(page.getByLabel('Jalons du dossier')).toBeVisible()
    await expect(page.getByRole('group', { name: /État de l'offre Fauteuils/ })).toBeVisible()
    await expect(page.getByLabel('Ligne de temps des devis')).toBeVisible()
    await pasDeDebordement(page)
    expect(problemes).toEqual([])
  })

  test('avec des projets à trancher et à offre reportée : le N de chaque tuile du Pilotage = N de la liste (valeurs non nulles)', async ({ page }) => {
    const lus = await tuilesEgalesListe(page)
    expect(lus['Dossiers à trancher']).toBeGreaterThanOrEqual(1)
    expect(lus['Dossiers reportés']).toBeGreaterThanOrEqual(1)
    expect(lus['Projets incomplets']).toBeGreaterThanOrEqual(1) // le projet de test n'a pas de cahier des charges
    // Le projet de test figure dans la liste filtrée « à trancher »
    await page.evaluate(() => sessionStorage.clear())
    await page.goto('/')
    await page.getByRole('button', { name: 'Projets', exact: true }).click()
    await chip(page, 'Dossiers à trancher').click()
    await page.getByRole('searchbox', { name: 'Rechercher un projet' }).fill(NOM)
    await expect(lignes(page).filter({ hasText: `${NOM} Essai`.replace(' Essai', '') })).toHaveCount(1)
  })

  test('documents typés : le cahier des charges manquant est signalé et mène à la zone Documents', async ({ page }) => {
    await ouvrir(page, `${NOM} projet`)
    const docs = page.getByLabel('Documents typés')
    await expect(docs.getByRole('button', { name: 'Devis : 2' })).toBeVisible()
    await expect(docs.getByRole('button', { name: 'Cahier des charges : manquant' })).toBeVisible()
    await expect(docs.getByRole('button', { name: 'Plans : 0' })).toBeVisible()
    for (const b of await docs.getByRole('button').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44)
    await docs.getByRole('button', { name: 'Cahier des charges : manquant' }).click()
    await expect(page.getByLabel('Jalons du dossier')).toBeVisible()
  })

  test('historique des étapes : création listée, chaque ligne mène au Pipeline filtré', async ({ page }) => {
    await ouvrir(page, `${NOM} projet`)
    const historique = page.getByRole('button', { name: /^Historique des étapes/ })
    await historique.scrollIntoViewIfNeeded()
    await historique.click()
    const liste = page.getByRole('list', { name: 'Historique des étapes' })
    await expect(liste.locator('li')).toHaveCount(1)
    await expect(liste).toContainText('Création')
    await liste.getByRole('button').first().click()
    await expect(page.getByText('Famille : Devis')).toBeVisible({ timeout: 45_000 })
  })

  test('SAV en attente de qui : pastille dans l\'en-tête, mène au champ', async ({ page }) => {
    await ouvrir(page, `${NOM} sav`)
    const pastille = page.getByRole('button', { name: 'En attente — voir le motif' })
    await expect(pastille).toContainText('Devis fournisseur')
    expect((await pastille.boundingBox()).height).toBeGreaterThanOrEqual(44)
    await pastille.click()
    await rendu(page)
    await expect(page.getByText('En attente de qui')).toBeInViewport()
    // Un SAV n'a ni synthèse projet ni historique de projet
    await expect(page.getByLabel('Synthèse du projet')).toHaveCount(0)
  })
})

// ─── Chaque tuile du Pilotage qui mène à la liste : N de la tuile = N de la liste ──────────────────

// N de chaque tuile du Pilotage qui mène à la liste = N de la liste filtrée ; renvoie les N lus.
async function tuilesEgalesListe(page) {
  const lus = {}
  const nombre = (t, motif) => Number((t.match(motif) ?? [0, 0])[1])
  const vers = async (lireTuile, ouvrirFeuille) => {
    await page.evaluate(() => sessionStorage.clear()).catch(() => {})
    await page.goto('/')
    await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
    const n = await lireTuile() // le N de la tuile, lu AVANT de quitter l'accueil
    await ouvrirFeuille()
    await page.getByRole('dialog').getByRole('button', { name: /dans la liste/ }).click()
    await expect(page.getByRole('heading', { name: 'Projets' })).toBeVisible()
    return n
  }
  const pilotage = page.getByLabel('Pilotage', { exact: true })
  const cas = [
    {
      nom: 'À trancher (dossiers)',
      tuile: async () => nombre(await pilotage.getByRole('button', { name: /^À trancher/ }).first().innerText(), /(\d+) dossiers?/),
      ouvrir: () => pilotage.getByRole('button', { name: /^À trancher/ }).first().click(),
      chip: 'Dossiers à trancher',
    },
    {
      nom: 'Offres reportées (dossiers)',
      tuile: async () => nombre(await pilotage.getByLabel('Potentiel ouvert').getByRole('button', { name: /^Offres reportées/ }).innerText(), /(\d+) dossiers?/),
      ouvrir: () => pilotage.getByLabel('Potentiel ouvert').getByRole('button', { name: /^Offres reportées/ }).click(),
      chip: 'Dossiers reportés',
    },
    {
      nom: 'Incomplets',
      tuile: async () => nombre(await pilotage.getByRole('button', { name: /^Incomplets/ }).innerText(), /Incomplets\s*(\d+)/),
      ouvrir: () => pilotage.getByRole('button', { name: /^Incomplets/ }).click(),
      chip: 'Projets incomplets',
    },
    {
      nom: 'En attente (part des projets)',
      tuile: async () => nombre(await page.locator('main').first().locator('button', { has: page.locator('p', { hasText: /^En attente$/ }) }).first().innerText(), /(\d+) projets?/),
      ouvrir: () => page.locator('main').first().locator('button', { has: page.locator('p', { hasText: /^En attente$/ }) }).first().click(),
      chip: 'Projets en attente',
    },
  ]
  for (const c of cas) {
    await expect(async () => {
      const n = await vers(c.tuile, c.ouvrir)
      lus[c.chip] = n
      // On a atterri sur la liste filtrée : le filtre est actif, son compteur et ses lignes égalent le N de la tuile
      await expect(chip(page, c.chip)).toHaveAttribute('aria-pressed', 'true')
      expect(await compteur(chip(page, c.chip))).toBe(n)
      if (n === 0) await expect(page.getByText('Aucun projet pour ces filtres.')).toBeVisible()
      else await expect(lignes(page)).toHaveCount(n)
    }, `${c.nom}`).toPass({ timeout: 40_000 })
  }
  // Les familles : la ligne du Pipeline du Pilotage égale la pastille de la liste
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  for (const f of FAMILLES) {
    const legende = pilotage.getByLabel('Pipeline', { exact: true }).locator('button', { hasText: new RegExp(`^${f.libelle}`) }).first()
    const nL = Number((await legende.innerText()).split('\n').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).pop())
    await page.evaluate(() => sessionStorage.clear())
    await page.getByRole('button', { name: `Liste des projets : ${f.libelle}` }).click()
    await expect(chip(page, `Famille ${f.libelle}`)).toHaveAttribute('aria-pressed', 'true')
    expect(await compteur(chip(page, `Famille ${f.libelle}`))).toBe(nL)
    await page.goBack()
  }
  await pasDeDebordement(page)
  return lus
}

test('tuile du Pilotage → liste : le N de la tuile est celui de la liste, pour chaque filtre', async ({ page }) => {
  const problemes = surveiller(page)
  await tuilesEgalesListe(page)
  expect(problemes).toEqual([])
})
