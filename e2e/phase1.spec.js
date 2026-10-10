import { test, expect } from '@playwright/test'

const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }

const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}

let client, dossier, devisHt, devisTtc

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: 'ZZTEST-E2E', prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: 'ZZTEST e2e dossier' })
  const base = { dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', type_doc: 'devis' }
  ;[devisHt] = await rest('POST', 'fichiers', {
    ...base, nom: 'ZZTEST_VISO_202699001.pdf',
    a_trancher_raison: 'Deux montants contradictoires, HT ou TTC non précisé.',
    variantes: [{ libelle: 'Offre p.2', montant_ttc: 50805 }, { libelle: 'Étude p.3', montant_ttc: 50360 }],
  })
  ;[devisTtc] = await rest('POST', 'fichiers', {
    ...base, nom: 'ZZTEST_PCI_202699002.pdf',
    variantes: [{ libelle: 'Étude 1', montant_ttc: 68485 }, { libelle: 'Étude 2', montant_ttc: 65385 }, { libelle: 'Étude 3', montant_ttc: 71975 }],
  })
})

test.afterAll(async () => {
  if (!dossier) return
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST e2e dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.ZZTEST-E2E`)
})

const surveiller = (page) => {
  const problemes = []
  page.on('console', (m) => m.type() === 'error' && problemes.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => problemes.push(`pageerror: ${e.message}`))
  page.on('response', (r) => r.status() >= 400 && problemes.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`))
  return problemes
}

const pasDeDebordement = async (page) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw).toBeLessThanOrEqual(cw)
}

const ouvrirDossierTest = async (page) => {
  await page.goto('/')
  await page.locator('input[type=search]').fill('ZZTEST-E2E')
  await page.getByText('ZZTEST-E2E Essai').click()
  await page.getByText('ZZTEST e2e dossier').click()
  const rubrique = page.getByText(/^Documents déposés/)
  await expect(rubrique).toBeVisible()
  // La rubrique s'ouvre seule tant qu'un devis reste à trancher ; sinon on l'ouvre.
  if (!(await page.getByLabel('Jalons du dossier').isVisible())) await rubrique.click()
  await expect(page.getByLabel('Jalons du dossier')).toBeVisible()
}

const ligne = async (id) => (await rest('GET', `fichiers?id=eq.${id}&select=*`))[0]

test('parcours général : écrans, retour, pas de débordement, pas d\'erreur', async ({ page }) => {
  const problemes = surveiller(page)
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await pasDeDebordement(page)

  for (const nom of ['Pipeline', 'Capture', 'Clients']) {
    await page.getByRole('button', { name: nom, exact: true }).click()
    await page.waitForTimeout(900)
    await pasDeDebordement(page)
    await page.goBack()
    await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  }

  for (const zone of ['SAV ouverts', 'Devis sans réponse', 'Rappels à venir', 'Plans à produire', 'À chiffrer']) {
    await page.getByRole('button', { name: new RegExp(`^${zone}`) }).first().click()
    await page.waitForTimeout(700)
    await pasDeDebordement(page)
    await page.goBack()
    await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  }
  expect(problemes).toEqual([])
})

test('documents : à trancher, question HT/TTC, calcul TVA, cibles ≥ 44 px', async ({ page }) => {
  const problemes = surveiller(page)
  await ouvrirDossierTest(page)
  await expect(page.getByText('2 à trancher')).toBeVisible()
  await expect(page.getByText('À trancher · 50 360 – 50 805 € TTC')).toBeVisible()
  await expect(page.getByText('À trancher · 65 385 – 71 975 € TTC')).toBeVisible()
  await pasDeDebordement(page)

  // Cibles tactiles de la section
  const petits = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => /Retenir|Étude|Offre|Type de|Lire|Relire|Renommer|Changer/.test(b.textContent + (b.getAttribute('aria-label') ?? '')))
      .map((b) => ({ t: b.textContent.trim().slice(0, 30), h: b.getBoundingClientRect().height }))
      .filter((x) => x.h > 0 && x.h < 43.5)
  )
  expect(petits).toEqual([])

  // Offre au HT/TTC douteux : la question puis le calcul
  await page.getByRole('button', { name: /Étude p\.3/ }).click()
  await expect(page.getByText(/Ce montant est HT ou TTC/)).toBeVisible()
  await page.getByRole('button', { name: 'HT', exact: true }).click()
  await expect(page.getByText('50 360 € HT × 1,20 = 60 432 € TTC')).toBeVisible()
  expect((await ligne(devisHt.id)).montant_ttc).toBeNull() // rien d'écrit avant confirmation
  await page.getByRole('button', { name: /Confirmer 60 432 € TTC/ }).click()
  await expect.poll(async () => (await ligne(devisHt.id)).montant_ttc).toBe(60432)
  const l = await ligne(devisHt.id)
  expect(l.montant_ht).toBe(50360)
  expect(l.variante_retenue).toBe(1)

  // Offre sans doute HT/TTC : un seul tap
  await page.getByRole('button', { name: /Étude 2/ }).click()
  await expect.poll(async () => (await ligne(devisTtc.id)).montant_ttc).toBe(65385)
  expect(problemes).toEqual([])
})

test('documents : changement de type et file hors-ligne rejouée', async ({ page, context }) => {
  await ouvrirDossierTest(page)
  await expect(page.getByText('Offre retenue : Étude 2')).toBeVisible()

  // Hors-ligne : « Changer » puis retenir une autre offre
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Changer', exact: true }).first().click()
  await page.getByRole('button', { name: /Étude 3/ }).click()
  await page.waitForTimeout(600)
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length))).toBeGreaterThan(0)
  expect((await ligne(devisTtc.id)).montant_ttc).toBe(65385) // la base n'a rien reçu

  await context.setOffline(false)
  await expect.poll(async () => (await ligne(devisTtc.id)).montant_ttc, { timeout: 20_000 }).toBe(71975)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length)).toBe(0)

  // Changement de type : confirmation qui nomme le montant, variantes conservées
  await page.getByRole('button', { name: /^Type de ZZTEST_PCI_202699002\.pdf/ }).click()
  await page.getByRole('button', { name: 'Cahier des charges', exact: true }).click()
  await expect(page.getByText(/71.975.€ TTC, qui ne compteront plus/)).toBeVisible()
  await page.getByRole('button', { name: 'Changer le type', exact: true }).click()
  await expect.poll(async () => (await ligne(devisTtc.id)).type_doc).toBe('cdc')
  const l = await ligne(devisTtc.id)
  expect(l.montant_ttc).toBeNull()
  expect(l.variantes).toHaveLength(3)
})
