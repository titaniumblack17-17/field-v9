import { test, expect } from './base.js'
import { versDashboard } from './aides.js'

// Financement d'un projet (V1). Fixtures ZZTEST propres à ce passage ; tout est supprimé en fin (le financement
// et son journal partent avec le dossier, en cascade). Todoist n'est jamais appelé : l'appel est intercepté.
const NOM = `ZZTEST-FIN-${Math.random().toString(36).slice(2, 8)}`
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

const D = {} // A : devis_envoye 10 000 € · B : commande (signé) 20 000 € · C : devis_envoye (hors-ligne)
const clients = []
const ligneFin = async (id) => (await rest('GET', `dossier_financement?dossier_id=eq.${id}&select=*`))[0]
// Remet un financement dans un état connu, indépendamment des autres scénarios (un échec relance le fichier
// dans un nouveau processus, qui recrée ses fixtures : aucun scénario ne doit dépendre d'un autre).
const poser = async (id, champs) => {
  await rest('DELETE', `dossier_financement?dossier_id=eq.${id}`)
  await rest('POST', 'dossier_financement', { dossier_id: id, ...champs })
}
const journal = (id) => rest('GET', `dossier_financement_historique?dossier_id=eq.${id}&select=statut_avant,statut_apres&order=id`)

test.beforeAll(async () => {
  for (const [cle, statut, montant] of [['A', 'devis_envoye', 10000], ['B', 'commande', 20000], ['C', 'devis_envoye', 5000]]) {
    const [c] = await rest('POST', 'clients', { nom_praticien: `${NOM}-${cle}`, prenom_praticien: 'Essai' })
    clients.push(c)
    ;[D[cle]] = await rest('POST', 'dossiers', { client_id: c.id, type: 'projet', statut, titre: `${NOM}-${cle} dossier`, montant_estime: montant })
  }
})

test.afterAll(async () => {
  for (const d of Object.values(D)) {
    await rest('DELETE', `rappels?dossier_id=eq.${d.id}`)
    await rest('DELETE', `dossiers?id=eq.${d.id}&titre=like.${NOM}*`)
  }
  for (const c of clients) await rest('DELETE', `clients?id=eq.${c.id}&nom_praticien=like.${NOM}*`)
})

const surveillerConsole = (page) => {
  const erreurs = []
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()))
  page.on('pageerror', (e) => erreurs.push(String(e)))
  return erreurs
}
const sansDebordement = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

async function ouvrirFiche(page, cle) {
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await page.locator('input[type=search]').fill(`${NOM}-${cle}`)
  await page.getByText(`${NOM}-${cle} Essai`).click()
  await page.getByText(`${NOM}-${cle} dossier`).click()
  await expect(page.getByRole('region', { name: 'Financement' })).toBeVisible()
}
const bloc = (page) => page.getByRole('region', { name: 'Financement' })

test('chaque mode et chaque statut : un tap, base, résumé, journal, pré-remplissage, organismes, montant qui change', async ({ page }) => {
  const erreurs = surveillerConsole(page)
  // Un organisme déjà saisi ailleurs doit être proposé.
  const organisme = `${NOM}-Credit`
  await rest('POST', 'dossier_financement', { dossier_id: D.B.id, mode: 'banque', organisme, statut: 'a_proposer' })

  await ouvrirFiche(page, 'A')
  const b = bloc(page)
  // Aucun financement : aucune pastille active, aucun statut proposé.
  await expect(b.getByRole('button', { pressed: true })).toHaveCount(0)
  await expect(b.getByRole('group', { name: 'Statut du financement' })).toHaveCount(0)

  // Chaque mode, un tap.
  for (const [cle, libelle] of [['comptant', 'Comptant'], ['banque', 'Banque'], ['leasing', 'Leasing'], ['echelonne', 'En plusieurs fois'], ['mixte', 'Mixte'], ['banque', 'Banque']]) {
    await b.getByRole('button', { name: `Mode : ${libelle}` }).click()
    await expect(b.getByRole('button', { name: `Mode : ${libelle}` })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await ligneFin(D.A.id))?.mode).toBe(cle)
  }
  // Comptant : pas de statut ; montant financé pré-rempli depuis le dossier à la première bascule hors comptant.
  const apresBanque = await ligneFin(D.A.id)
  expect(Number(apresBanque.montant_finance)).toBe(10000)
  expect(Number(apresBanque.montant_ref)).toBe(10000)

  // Organismes : celui de l'autre dossier est proposé ; le nôtre est enregistré.
  await expect(page.locator(`#fin-organismes option[value="${organisme}"]`)).toHaveCount(1)
  await b.getByLabel('Organisme').fill(`${NOM}-Banque`)
  await b.getByLabel('Organisme').blur()
  await expect.poll(async () => (await ligneFin(D.A.id)).organisme).toBe(`${NOM}-Banque`)

  // Montants facultatifs.
  await b.getByLabel('Apport').fill('1500')
  await b.getByLabel('Durée').fill('60')
  await b.getByLabel('Mensualité').fill('185,5')
  await b.getByLabel('Mensualité').blur()
  await expect.poll(async () => Number((await ligneFin(D.A.id)).mensualite)).toBe(185.5)
  expect(Number((await ligneFin(D.A.id)).duree_mois)).toBe(60)
  expect(Number((await ligneFin(D.A.id)).apport)).toBe(1500)

  // Chaque statut, un tap ; le journal reçoit une ligne par changement (+ la création).
  for (const [cle, libelle] of [['depose', 'Déposé'], ['accord', 'Accord'], ['refus', 'Refus'], ['debloque', 'Débloqué'], ['a_proposer', 'À proposer']]) {
    await b.getByRole('button', { name: `Statut : ${libelle}` }).click()
    await expect(b.getByRole('button', { name: `Statut : ${libelle}` })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await ligneFin(D.A.id)).statut).toBe(cle)
  }
  await expect.poll(async () => (await journal(D.A.id)).length).toBe(6)
  await expect(b.getByRole('list', { name: 'Historique du financement' }).getByRole('listitem')).toHaveCount(6)

  // Résumé d'en-tête.
  await b.getByRole('button', { name: 'Statut : Accord' }).click()
  await expect(page.getByRole('button', { name: /^Financement : Banque · Accord/ })).toBeVisible()
  expect(await sansDebordement(page)).toBe(true)

  // Le montant du dossier change : avertissement, puis mise à jour.
  await rest('PATCH', `dossiers?id=eq.${D.A.id}&titre=like.${NOM}*`, { montant_estime: 12000 })
  await ouvrirFiche(page, 'A')
  await expect(bloc(page).getByRole('alert')).toContainText('10 000 € → 12 000 €')
  await bloc(page).getByRole('button', { name: 'Mettre à jour' }).click()
  await expect.poll(async () => Number((await ligneFin(D.A.id)).montant_finance)).toBe(12000)
  await expect(bloc(page).getByRole('alert')).toHaveCount(0)

  expect(erreurs, erreurs.join('\n')).toEqual([])
})

test('hors ligne : le premier geste crée le financement en file, rejoué au retour du réseau', async ({ page, context }) => {
  // Le rejeu retente avec un délai croissant (4 s, 8 s, 16 s, 30 s) si le réseau n'est pas encore réellement revenu.
  test.setTimeout(110_000)
  await ouvrirFiche(page, 'C')
  const b = bloc(page)
  await context.setOffline(true)
  await b.getByRole('button', { name: 'Mode : Leasing' }).click()
  await b.getByRole('button', { name: 'Statut : Déposé' }).click()
  await expect(b.getByRole('button', { name: 'Statut : Déposé' })).toHaveAttribute('aria-pressed', 'true')
  await expect(b).toContainText('Enregistré hors ligne')
  await expect(page.getByRole('button', { name: /^Financement : Leasing · Déposé/ })).toBeVisible()
  expect(await ligneFin(D.C.id)).toBeUndefined()
  await context.setOffline(false)
  await expect.poll(async () => (await ligneFin(D.C.id))?.statut, { timeout: 80_000 }).toBe('depose')
  expect((await ligneFin(D.C.id)).mode).toBe('leasing')
  await expect(b).not.toContainText('Enregistré hors ligne')
})

test('Pilotage, liste et base donnent les mêmes nombres ; l’objectif signé ne bouge pas', async ({ page }) => {
  const erreurs = surveillerConsole(page)
  const avant = await rpc()
  // A déposé ; B (signé) non confirmé ; C déposé aussi (hors-ligne ci-dessus) ; un dossier comptant ne compte pas.
  await poser(D.A.id, { mode: 'banque', statut: 'depose', montant_finance: 10000 })
  await poser(D.B.id, { mode: 'banque', statut: 'a_proposer', montant_finance: 20000 })
  await poser(D.C.id, { mode: 'leasing', statut: 'depose' })
  const apres = await rpc()
  for (const cle of ['signe', 'projets_actifs', 'familles', 'potentiel']) expect(apres[cle], cle).toEqual(avant[cle])

  // Vérité indépendante : tous les financements et dossiers lus bruts.
  const fins = await rest('GET', 'dossier_financement?select=dossier_id,mode,statut')
  const dossiers = await rest('GET', 'dossiers?type=eq.projet&select=id,statut')
  const actif = new Map(dossiers.filter((d) => !['perdu', 'termine'].includes(d.statut)).map((d) => [d.id, d]))
  const SIGNES = ['commande', 'reunion_chantier', 'installation', 'finition', 'financement']
  const attendu = fins.filter((f) => f.mode !== 'comptant' && f.statut === 'depose' && actif.has(f.dossier_id)).length
  const attenduSigne = fins.filter((f) => f.mode !== 'comptant' && ['a_proposer', 'depose', 'refus'].includes(f.statut) && actif.has(f.dossier_id) && SIGNES.includes(actif.get(f.dossier_id).statut)).length
  expect(attendu).toBeGreaterThanOrEqual(2)
  expect(attenduSigne).toBeGreaterThanOrEqual(1)
  expect(apres.financement.en_attente_accord.dossiers).toBe(attendu)
  expect(apres.financement.signe_non_confirme.dossiers).toBe(attenduSigne)

  await page.goto('/')
  await versDashboard(page)
  const tuile = page.getByRole('button', { name: /^Financement en attente d'accord/ })
  await expect(tuile.locator('p').nth(1)).toHaveText(String(attendu))
  expect(await sansDebordement(page)).toBe(true)
  const signal = page.getByRole('button', { name: /^Signé, financement non confirmé/ })
  await expect(signal).toContainText(`${attenduSigne} dossier`)

  // Tuile → feuille : autant de lignes que de dossiers.
  await tuile.click()
  const feuille = page.getByRole('dialog')
  await expect(feuille.getByRole('heading')).toContainText(`${attendu} dossier`)
  await expect(feuille.locator('ul li')).toHaveCount(attendu)
  // Feuille → liste des projets filtrée : pastille et lignes = base.
  await feuille.getByRole('button', { name: /Voir ces projets dans la liste/ }).click()
  await expect(page.getByRole('button', { name: `Financement en attente d'accord : ${attendu}` })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(`${attendu} sur `)).toBeVisible()
  await expect(page.locator('main ul > li')).toHaveCount(attendu)
  expect(await sansDebordement(page)).toBe(true)

  // Signal → feuille → liste filtrée.
  await page.goto('/')
  await versDashboard(page)
  await page.getByRole('button', { name: /^Signé, financement non confirmé/ }).click()
  const feuille2 = page.getByRole('dialog')
  await expect(feuille2.locator('ul li')).toHaveCount(attenduSigne)
  await feuille2.getByRole('button', { name: /Voir ces projets dans la liste/ }).click()
  await expect(page.getByRole('button', { name: `Signés, financement non confirmé : ${attenduSigne}` })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('main ul > li')).toHaveCount(attenduSigne)

  expect(erreurs, erreurs.join('\n')).toEqual([])
})

test('relance d’un dossier déposé depuis plus de 10 jours : rappel ouvré, Todoist jamais appelé', async ({ page }) => {
  const appelsTodoist = []
  await page.route('**/functions/v1/todoist-rappel', (route) => {
    appelsTodoist.push(route.request().method())
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  })
  const il = new Date()
  il.setDate(il.getDate() - 12)
  await poser(D.A.id, { mode: 'banque', statut: 'depose', date_statut: il.toISOString().slice(0, 10) })
  await ouvrirFiche(page, 'A')
  const b = bloc(page)
  await expect(b).toContainText('Déposé depuis 12 jours')
  await b.getByRole('button', { name: /Programmer une relance/ }).click()
  await expect(b).toContainText('Relance programmée le')
  await expect.poll(() => appelsTodoist.length).toBeGreaterThan(0) // l'appel part bien… vers l'interception, jamais vers Todoist
  const [r] = await rest('GET', `rappels?dossier_id=eq.${D.A.id}&select=date,note`)
  expect(r.note).toContain('Relancer le financement')
  const jour = new Date(`${r.date}T12:00:00`).getDay()
  expect([0, 6]).not.toContain(jour)
  expect(r.date >= new Date().toISOString().slice(0, 10)).toBe(true)
})
