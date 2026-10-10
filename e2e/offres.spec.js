import { test, expect } from '@playwright/test'

// Décision par offre. Dossier jetable ZZTEST-OFF uniquement (jamais un vrai dossier),
// supprimé à la fin avec ses rappels et ses notes. Les appels Todoist sont coupés.
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

let client, dossier, X, Y, Z
const OFFRES_X = () => [
  { libelle: 'Fauteuils', montant_ttc: 1000, etat: 'a_trancher' },
  { libelle: 'Local', montant_ttc: 2000, etat: 'a_trancher' },
  { libelle: 'Option', montant_ttc: 500, etat: 'a_trancher' },
]
const OFFRES_Y = () => [
  { libelle: 'Offre A', montant_ttc: 50360, etat: 'a_trancher' },
  { libelle: 'Offre B', montant_ttc: 47150, etat: 'a_trancher' },
]
const ligne = async (id) => (await rest('GET', `fichiers?id=eq.${id}&select=*`))[0]
const montant = async () => (await rest('GET', `dossiers?id=eq.${dossier.id}&select=montant_estime`))[0].montant_estime
const num = (v) => (v == null ? null : Number(v))
const etats = async (f) => (await ligne(f.id)).variantes.map((o) => o.etat)
const reinit = async () => {
  await rest('DELETE', `rappels?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  const remise = { montant_ttc: null, montant_ht: null, variante_retenue: null, variantes_retenues: null, decision: 'a_trancher', remplace_par: null, mis_de_cote_le: null, date_reprise: null, decision_le: null }
  await rest('PATCH', `fichiers?id=eq.${X.id}`, { ...remise, variantes: OFFRES_X() })
  await rest('PATCH', `fichiers?id=eq.${Y.id}`, { ...remise, variantes: OFFRES_Y() })
  await rest('PATCH', `fichiers?id=eq.${Z.id}`, { ...remise, montant_ttc: 5000 })
}

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: 'ZZTEST-OFF', prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: 'ZZTEST-OFF dossier' })
  const base = { dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', type_doc: 'devis' }
  ;[X] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_OFFRES_202699201.pdf', date_devis: '2026-10-01', variantes: OFFRES_X() })
  ;[Y] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_DOUTE_202699202.pdf', date_devis: '2026-10-02', a_trancher_raison: 'HT ou TTC non précisé.', variantes: OFFRES_Y() })
  ;[Z] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_SEUL_202699203.pdf', date_devis: '2026-10-03', montant_ttc: 5000 })
})

test.afterAll(async () => {
  await rest('DELETE', `rappels?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST-OFF dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.ZZTEST-OFF`)
})

test.beforeEach(async () => { await reinit() })

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
const ouvrir = async (page) => {
  await page.route(/todoist-rappel|todoist-tache/, (route) => route.abort())
  await page.goto('/')
  await page.locator('input[type=search]').fill('ZZTEST-OFF')
  await page.getByText('ZZTEST-OFF Essai').click()
  await page.getByText('ZZTEST-OFF dossier').click()
  await page.getByText(/^Documents déposés/).waitFor()
  await page.waitForTimeout(1200)
  if (!(await page.getByLabel('Jalons du dossier').isVisible())) await page.getByText(/^Documents déposés/).click()
  await expect(page.getByLabel('Jalons du dossier')).toBeVisible()
}
const offre = (page, libelle) => page.getByRole('group', { name: new RegExp(`État de l'offre ${libelle}`) })
const etat = (page, libelle, nom) => offre(page, libelle).getByRole('button', { name: nom, exact: true })

test('états par offre (retenue / à trancher / écartée / reportée) et annulation', async ({ page }) => {
  const problemes = surveiller(page)
  await ouvrir(page)
  // Défaut : toutes à trancher, rien ne compte
  expect(await etats(X)).toEqual(['a_trancher', 'a_trancher', 'a_trancher'])
  expect(num(await montant())).toBeNull()
  for (const nom of ['Retenue', 'À trancher', 'Écartée', 'Reportée']) {
    expect((await etat(page, 'Fauteuils', nom).boundingBox()).height).toBeGreaterThanOrEqual(44)
  }

  await etat(page, 'Fauteuils', 'Retenue').click()
  await expect.poll(async () => num((await ligne(X.id)).montant_ttc)).toBe(1000)
  expect((await etats(X))[0]).toBe('retenue')
  expect((await ligne(X.id)).decision).toBe('retenu')
  await expect.poll(async () => num(await montant())).toBe(1000)

  await etat(page, 'Local', 'Écartée').click()
  await expect.poll(async () => (await etats(X))[1]).toBe('ecartee')
  expect(num(await montant())).toBe(1000) // écartée : ne compte pas

  // Annulation d'un tap (8 s) : l'offre redevient à trancher
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click()
  await expect.poll(async () => (await etats(X))[1]).toBe('a_trancher')

  // Retenue → À trancher : le montant disparaît
  await etat(page, 'Fauteuils', 'À trancher').click()
  await expect.poll(async () => num(await montant())).toBeNull()
  expect(await etats(X)).toEqual(['a_trancher', 'a_trancher', 'a_trancher'])
  await pasDeDebordement(page)
  expect(problemes).toEqual([])
})

test('cumul entre offres ET entre devis ; dossier partiellement retenu = potentiel ouvert', async ({ page }) => {
  await ouvrir(page)
  const avant = (await rpc()).potentiel.a_trancher
  await etat(page, 'Fauteuils', 'Retenue').click()
  await etat(page, 'Local', 'Retenue').click()
  await expect.poll(async () => num((await ligne(X.id)).montant_ttc)).toBe(3000) // 1 000 + 2 000
  expect((await ligne(X.id)).variantes_retenues).toEqual([0, 1])
  expect((await ligne(X.id)).variante_retenue).toBe(0)
  await expect.poll(async () => num(await montant())).toBe(3000)

  // Entre devis : le devis sans offres retenu s'ajoute
  await page.getByRole('group', { name: /Décision pour ZZTEST_SEUL_202699203/ }).getByRole('button', { name: 'Retenu', exact: true }).click()
  await expect.poll(async () => num(await montant())).toBe(8000)

  // « Option » reste à trancher : potentiel ouvert (RPC), sans toucher au montant
  const apres = (await rpc()).potentiel.a_trancher
  expect(apres.offres - avant.offres).toBe(-3) // X : 3 offres → 1 (−2) ; Z retenu : sort (−1) ; Y inchangé
  expect(num(await montant())).toBe(8000)
})

test('HT/TTC offre par offre : question, calcul de TVA, total, HT conservé seulement si tout est HT', async ({ page }) => {
  await ouvrir(page)
  await etat(page, 'Offre A', 'Retenue').click()
  await expect(page.getByText(/Ce montant est HT ou TTC/)).toBeVisible()
  await page.getByRole('button', { name: 'HT', exact: true }).click()
  await expect(page.getByText('50 360 € HT × 1,20 = 60 432 € TTC')).toBeVisible()
  expect(num((await ligne(Y.id)).montant_ttc)).toBeNull() // rien d'écrit avant confirmation
  await page.getByRole('button', { name: /Confirmer 60 432 € TTC/ }).click()
  await expect.poll(async () => num((await ligne(Y.id)).montant_ttc)).toBe(60432)
  expect(num((await ligne(Y.id)).montant_ht)).toBe(50360) // tout est HT pour l'instant

  await etat(page, 'Offre B', 'Retenue').click()
  await page.getByRole('button', { name: 'TTC', exact: true }).click()
  await expect.poll(async () => num((await ligne(Y.id)).montant_ttc)).toBe(107582) // 60 432 + 47 150
  expect((await ligne(Y.id)).montant_ht).toBeNull() // bases mélangées : pas de montant HT unique
})

test('projets : étiquette par offre, sous-totaux, montants inchangés', async ({ page }) => {
  await ouvrir(page)
  await expect(page.getByLabel('Sous-totaux par projet')).toHaveCount(0) // aucune étiquette : pas de sous-totaux
  await etat(page, 'Fauteuils', 'Retenue').click()
  await expect.poll(async () => num(await montant())).toBe(1000)
  for (const [libelle, projet] of [['Fauteuils', 'Projet A'], ['Local', 'Projet A'], ['Option', 'Projet B']]) {
    const champ = page.getByLabel(new RegExp(`Projet de l'offre ${libelle}`))
    await champ.fill(projet)
    await champ.blur()
    // une écriture à la fois : attendre qu'elle soit en base avant la suivante
    const i = ['Fauteuils', 'Local', 'Option'].indexOf(libelle)
    await expect.poll(async () => (await ligne(X.id)).variantes[i].projet).toBe(projet)
  }
  await expect.poll(async () => (await ligne(X.id)).variantes.map((o) => o.projet)).toEqual(['Projet A', 'Projet A', 'Projet B'])
  expect(num(await montant())).toBe(1000) // étiqueter ne change aucun montant
  const sous = page.getByLabel('Sous-totaux par projet')
  await expect(sous).toContainText('Projet A')
  await expect(sous).toContainText(/Projet A[\s\S]*Retenu 1.000 € · À trancher 2.000 €/)
  await expect(sous).toContainText(/Projet B[\s\S]*Retenu 0 € · À trancher 500 €/)
})

test('reportée avec date de reprise : rappel, Dashboard (Potentiel ouvert, anneau à 4 segments), annulation', async ({ page }) => {
  const problemes = surveiller(page)
  const avant = (await rpc()).potentiel.reportees
  await ouvrir(page)
  await etat(page, 'Option', 'Reportée').click()
  await expect(page.getByLabel("Date de reprise de l'offre")).toBeVisible()
  await page.getByLabel("Date de reprise de l'offre").fill('2026-11-03') // un mardi
  await page.getByRole('button', { name: "Reporter l'offre" }).click()
  await expect.poll(async () => (await etats(X))[2]).toBe('reportee')
  expect((await ligne(X.id)).variantes[2].date_reprise).toBe('2026-11-03')
  await expect.poll(async () => (await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=date,note`)).length).toBe(1)
  expect((await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=date,note`))[0].note).toContain('Reprendre l\'offre')
  const apres = (await rpc()).potentiel.reportees
  expect(apres.offres).toBe(avant.offres + 1)
  expect(Number(apres.montant)).toBe(Number(avant.montant) + 500)

  // Dashboard : bloc « Potentiel ouvert », anneau à 4 segments, liste des reportées avec motif
  await page.goto('/')
  const potentiel = page.getByLabel('Potentiel ouvert')
  await expect(potentiel).toContainText('À trancher')
  await expect(potentiel).toContainText('Reportées')
  for (const seg of ['signe', 'a-trancher', 'reporte', 'reste']) {
    expect(await page.locator(`[data-segment="${seg}"]`).count()).toBeGreaterThanOrEqual(seg === 'reste' ? 0 : 1)
  }
  await potentiel.getByRole('button', { name: /^Reportées/ }).click()
  const feuille = page.getByRole('dialog')
  await expect(feuille.getByRole('heading', { name: new RegExp(`Reportées · ${apres.offres} offres?`) })).toBeVisible()
  await expect(feuille.locator('ul > li')).toHaveCount(apres.offres)
  await expect(feuille).toContainText('reprise le 03/11/2026')
  await pasDeDebordement(page)
  await page.keyboard.press('Escape')

  // Annulation : l'offre redevient à trancher ET le rappel créé est retiré
  await ouvrir(page)
  await etat(page, 'Local', 'Écartée').click() // nouvelle décision annulable
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click()
  await expect.poll(async () => (await etats(X))[1]).toBe('a_trancher')
  expect(problemes).toEqual([])
})

test('annuler un report supprime son rappel', async ({ page }) => {
  await ouvrir(page)
  await etat(page, 'Option', 'Reportée').click()
  await page.getByLabel("Date de reprise de l'offre").fill('2026-11-04')
  await page.getByRole('button', { name: "Reporter l'offre" }).click()
  await expect.poll(async () => (await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=id`)).length).toBe(1)
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click()
  await expect.poll(async () => (await etats(X))[2]).toBe('a_trancher')
  await expect.poll(async () => (await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=id`)).length).toBe(0)
})

test('hors-ligne : décisions d\'offre mises en file et rejouées sans doublon', async ({ page, context }) => {
  await ouvrir(page)
  await context.setOffline(true)
  await etat(page, 'Fauteuils', 'Retenue').click()
  await etat(page, 'Local', 'Écartée').click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length)).toBeGreaterThan(1)
  expect(await etats(X)).toEqual(['a_trancher', 'a_trancher', 'a_trancher']) // rien n'est parti
  // Le même geste rejoué deux fois : écritures absolues, aucun cumul
  await page.evaluate(() => {
    const file = JSON.parse(localStorage.getItem('fv9:file-attente'))
    localStorage.setItem('fv9:file-attente', JSON.stringify([...file, ...file.map((a) => ({ ...a, id: crypto.randomUUID() }))]))
  })
  await context.setOffline(false)
  await ouvrir(page)
  await expect.poll(async () => (await etats(X)).join(','), { timeout: 30_000 }).toBe('retenue,ecartee,a_trancher')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length), { timeout: 30_000 }).toBe(0)
  expect(num((await ligne(X.id)).montant_ttc)).toBe(1000) // pas 2 000 : aucune addition au rejeu
  await expect.poll(async () => num(await montant())).toBe(1000)
  expect((await rest('GET', `dossier_notes?dossier_id=eq.${dossier.id}&select=id`)).length).toBeLessThanOrEqual(2)
})
