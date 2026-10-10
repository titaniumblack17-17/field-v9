import { test, expect } from '@playwright/test'

// Nettoyage du potentiel ouvert. Dossier jetable ZZTEST-NET uniquement. Pour le geste
// global, la liste lue par le Dashboard est restreinte au dossier de test (interception de
// la lecture) : aucune écriture ne peut partir vers un vrai devis.
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
const num = (v) => (v == null ? null : Number(v))
const euros = (n) => new Intl.NumberFormat('fr-FR').format(n)

let client, dossier, P, Q, R, S
const O = (l, m, etat) => ({ libelle: l, montant_ttc: m, etat })
const OFFRES = {
  P: () => [O('P1', 1000, 'retenue'), O('P2', 2000, 'a_trancher'), O('P3', 500, 'a_trancher')],
  Q: () => [O('Q1', 3000, 'retenue'), O('Q2', 700, 'a_trancher')],
  R: () => [O('R1', 4000, 'a_trancher'), O('R2', 4500, 'a_trancher')],
  S: () => [O('S1', 6000, 'a_trancher'), O('S2', 6500, 'a_trancher')],
}
const ligne = async (f) => (await rest('GET', `fichiers?id=eq.${f.id}&select=*`))[0]
const etats = async (f) => (await ligne(f)).variantes.map((o) => o.etat)
const montantDossier = async () => num((await rest('GET', `dossiers?id=eq.${dossier.id}&select=montant_estime`))[0].montant_estime)
const reinit = async () => {
  const retenu = (m) => ({ montant_ttc: m, decision: 'retenu', variante_retenue: 0, variantes_retenues: [0] })
  const neutre = { montant_ttc: null, decision: 'a_trancher', variante_retenue: null, variantes_retenues: null }
  await rest('PATCH', `fichiers?id=eq.${P.id}`, { variantes: OFFRES.P(), ...retenu(1000) })
  await rest('PATCH', `fichiers?id=eq.${Q.id}`, { variantes: OFFRES.Q(), ...retenu(3000) })
  await rest('PATCH', `fichiers?id=eq.${R.id}`, { variantes: OFFRES.R(), ...neutre })
  // S : montant retenu au niveau du devis, aucune offre marquée retenue → « décision requise »
  await rest('PATCH', `fichiers?id=eq.${S.id}`, { variantes: OFFRES.S(), montant_ttc: 9999, decision: 'retenu', variante_retenue: null, variantes_retenues: null })
}

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: 'ZZTEST-NET', prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: 'ZZTEST-NET dossier' })
  const base = { dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', type_doc: 'devis' }
  ;[P] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_NETP_202699301.pdf', date_devis: '2026-10-01', variantes: OFFRES.P() })
  ;[Q] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_NETQ_202699302.pdf', date_devis: '2026-10-02', variantes: OFFRES.Q() })
  ;[R] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_NETR_202699303.pdf', date_devis: '2026-10-03', variantes: OFFRES.R() })
  ;[S] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_NETS_202699304.pdf', date_devis: '2026-10-04', variantes: OFFRES.S() })
})

test.afterAll(async () => {
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST-NET dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.ZZTEST-NET`)
})

test.beforeEach(async () => { await reinit() })

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
const ouvrirFiche = async (page) => {
  await page.goto('/')
  await page.locator('input[type=search]').fill('ZZTEST-NET')
  await page.getByText('ZZTEST-NET Essai').click()
  await page.getByText('ZZTEST-NET dossier').click()
  await page.getByText(/^Documents déposés/).waitFor()
  await page.waitForTimeout(1200)
  if (!(await page.getByLabel('Jalons du dossier').isVisible())) await page.getByText(/^Documents déposés/).click()
  await expect(page.getByLabel('Jalons du dossier')).toBeVisible()
}
const restreindreAuxFixtures = (page) =>
  page.route(/\/rest\/v1\/fichiers\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const reponse = await route.fetch()
    const lignes = await reponse.json()
    await route.fulfill({ response: reponse, json: lignes.filter((f) => f.dossier_id === dossier.id) })
  })

test('geste unitaire sur la fiche : proposé seulement quand une offre est retenue, annulable, aucun montant ne bouge', async ({ page }) => {
  const problemes = surveiller(page)
  const avant = (await rpc()).potentiel.a_trancher
  expect(await montantDossier()).toBe(1000 + 3000 + 9999)
  await ouvrirFiche(page)
  // Proposé sur P et Q (offre retenue + d'autres à trancher) ; pas sur R (rien de retenu) ni S
  const boutons = page.getByRole('button', { name: /^Écarter les autres offres de ce devis/ })
  await expect(boutons).toHaveCount(2)
  expect((await boutons.first().boundingBox()).height).toBeGreaterThanOrEqual(44)
  // Rien n'est automatique : tant qu'on n'a pas tapé, rien n'a changé
  expect(await etats(P)).toEqual(['retenue', 'a_trancher', 'a_trancher'])

  await boutons.first().click() // P (le plus récent d'abord ? l'ordre suit la liste : on lit le résultat en base)
  await expect.poll(async () => (await etats(P)).join(',') + '|' + (await etats(Q)).join(',')).toMatch(/retenue,ecartee,ecartee\|retenue,a_trancher|retenue,a_trancher,a_trancher\|retenue,ecartee/)
  // Aucun montant ne bouge
  expect(num((await ligne(P)).montant_ttc)).toBe(1000)
  expect(num((await ligne(Q)).montant_ttc)).toBe(3000)
  expect(await montantDossier()).toBe(1000 + 3000 + 9999)
  const pendant = (await rpc()).potentiel.a_trancher
  expect(pendant.offres).toBeLessThan(avant.offres)

  // Annuler (8 s) : tout revient
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click()
  await expect.poll(async () => (await etats(P)).join(',') + '|' + (await etats(Q)).join(',')).toBe('retenue,a_trancher,a_trancher|retenue,a_trancher')
  expect(num((await rpc()).potentiel.a_trancher.offres)).toBe(avant.offres)
  await pasDeDebordement(page)
  expect(problemes).toEqual([])
})

test('Dashboard « Nettoyer » : décision requise en tête, unitaire, global avec confirmation chiffrée, annulation, RPC et signé inchangés', async ({ page }) => {
  const problemes = surveiller(page)
  await restreindreAuxFixtures(page)
  const avant = await rpc()
  const dossiersAvant = await montantDossier()
  // Témoin : les vrais devis à nettoyer (et Ponsart) ne doivent pas bouger d'un octet
  const reels = (await rest('GET', 'fichiers?type_doc=eq.devis&dossier_id=not.is.null&select=id,variantes,montant_ttc,decision')).filter((f) => f.dossier_id !== dossier.id)
  const instantane = JSON.stringify(reels.map((f) => [f.id, f.variantes, f.montant_ttc, f.decision]).sort())

  await page.goto('/')
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  const bloc = page.getByLabel('Potentiel ouvert')
  await expect(bloc.getByRole('button', { name: 'Nettoyer' })).toBeVisible()
  // Aucun effet tant qu'on n'a pas confirmé
  await bloc.getByRole('button', { name: 'Nettoyer' }).click()
  const feuille = page.getByRole('dialog')
  await expect(feuille.getByRole('heading', { name: 'Nettoyer le potentiel · 3 offres' })).toBeVisible()
  await expect(feuille.getByLabel('Décision requise')).toContainText('ZZTEST_NETS_202699304') // S : montant retenu, aucune offre retenue
  await expect(feuille.getByLabel('Décision requise').getByRole('button')).toHaveCount(1) // signalement seulement, pas d'action
  await expect(feuille.getByRole('button', { name: 'Écarter les autres' })).toHaveCount(2) // P et Q
  for (const b of await feuille.getByRole('button', { name: 'Écarter les autres' }).all()) {
    expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44)
  }
  expect(await etats(P)).toEqual(['retenue', 'a_trancher', 'a_trancher'])
  await pasDeDebordement(page)

  // Unitaire (Q) puis annulation
  await feuille.locator('li', { hasText: 'ZZTEST_NETQ_202699302' }).getByRole('button', { name: 'Écarter les autres' }).click()
  await expect.poll(async () => (await etats(Q)).join(',')).toBe('retenue,ecartee')
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click()
  await expect.poll(async () => (await etats(Q)).join(',')).toBe('retenue,a_trancher')

  // Global : la confirmation affiche le nombre d'offres et le montant retiré, rien n'est écrit avant
  await feuille.getByRole('button', { name: /^Tout écarter \(3 offres\)/ }).click()
  const confirmation = feuille.getByRole('alertdialog')
  await expect(confirmation).toContainText('Écarter 3 offres sur 2 devis ?')
  await expect(confirmation).toContainText(`Retiré du potentiel à trancher : ${euros(500 + 700)} €`) // plancher : P → 500, Q → 700
  expect(await etats(P)).toEqual(['retenue', 'a_trancher', 'a_trancher'])
  expect(await etats(Q)).toEqual(['retenue', 'a_trancher'])
  await confirmation.getByRole('button', { name: 'Confirmer' }).click()
  await expect.poll(async () => (await etats(P)).join(',') + '|' + (await etats(Q)).join(',')).toBe('retenue,ecartee,ecartee|retenue,ecartee')

  // Chiffre « À trancher » avant / après : −3 offres, −1 200 € de plancher ; signé et montants inchangés
  const apres = await rpc()
  expect(apres.potentiel.a_trancher.offres).toBe(avant.potentiel.a_trancher.offres - 3)
  expect(num(apres.potentiel.a_trancher.montant_min)).toBe(num(avant.potentiel.a_trancher.montant_min) - 1200)
  expect(apres.signe).toEqual(avant.signe)
  expect(await montantDossier()).toBe(dossiersAvant)
  // La RPC égale un recalcul indépendant à partir des lignes brutes
  const brut = await rest('GET', 'fichiers?type_doc=eq.devis&dossier_id=not.is.null&select=id,dossier_id,montant_ttc,variantes,decision')
  const offres = brut.flatMap((f) => {
    const v = Array.isArray(f.variantes) ? f.variantes : []
    if (v.length >= 1) return v.map((o) => ({ fichier: f.id, dossier: f.dossier_id, etat: ['retenue', 'a_trancher', 'ecartee', 'reportee'].includes(o.etat) ? o.etat : 'a_trancher', montant: Number(o.montant_ttc) }))
    if (f.montant_ttc == null) return []
    return [{ fichier: f.id, dossier: f.dossier_id, etat: { retenu: 'retenue', a_trancher: 'a_trancher', mis_de_cote: 'reportee' }[f.decision] ?? 'ecartee', montant: Number(f.montant_ttc) }]
  })
  const ouvertes = offres.filter((o) => o.etat === 'a_trancher')
  const parFichier = [...ouvertes.reduce((m, o) => m.set(o.fichier, [...(m.get(o.fichier) ?? []), o]), new Map()).values()]
  expect(apres.potentiel.a_trancher.offres).toBe(ouvertes.length)
  expect(apres.potentiel.a_trancher.devis).toBe(parFichier.length)
  expect(num(apres.potentiel.a_trancher.montant_min)).toBe(parFichier.reduce((t, l) => t + Math.min(...l.map((o) => o.montant)), 0))

  // Annulation du global : tout revient
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click()
  await expect.poll(async () => (await etats(P)).join(',') + '|' + (await etats(Q)).join(',')).toBe('retenue,a_trancher,a_trancher|retenue,a_trancher')
  expect((await rpc()).potentiel.a_trancher.offres).toBe(avant.potentiel.a_trancher.offres)

  // Le Board et le Dashboard donnent le même signé
  await page.keyboard.press('Escape')
  const dash = await page.getByLabel('Objectif', { exact: true }).locator('button', { hasText: /^Signé/ }).innerText()
  await page.goto('/')
  const board = await page.getByText(/^Objectif \d{4}$/).first().locator('xpath=ancestor::button[1]').innerText()
  expect(Number(dash.split('\n').filter((l) => /€/.test(l)).pop().replace(/[^\d]/g, ''))).toBe(Number(board.split('\n').pop().replace(/[^\d]/g, '')))

  // Les vrais devis (dont Ponsart) n'ont pas été touchés
  const reelsApres = (await rest('GET', 'fichiers?type_doc=eq.devis&dossier_id=not.is.null&select=id,variantes,montant_ttc,decision')).filter((f) => f.dossier_id !== dossier.id)
  expect(JSON.stringify(reelsApres.map((f) => [f.id, f.variantes, f.montant_ttc, f.decision]).sort())).toBe(instantane)
  expect(problemes).toEqual([])
})
