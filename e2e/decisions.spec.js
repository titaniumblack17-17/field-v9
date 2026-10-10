import { test, expect } from '@playwright/test'

// Décision par devis. Dossier jetable ZZTEST-DEC uniquement (jamais un vrai dossier),
// supprimé à la fin avec ses rappels et ses notes. Les appels Todoist sont coupés :
// ces tests ne créent aucune tâche dans Todoist.
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

let client, dossier, A, B, C, E

const ligne = async (id) => (await rest('GET', `fichiers?id=eq.${id}&select=*`))[0]
const montant = async () => (await rest('GET', `dossiers?id=eq.${dossier.id}&select=montant_estime`))[0].montant_estime
const num = (v) => (v == null ? null : Number(v))
const reinit = async () => {
  for (const f of [A, B, C, E]) {
    await rest('PATCH', `fichiers?id=eq.${f.id}`, { decision: 'a_trancher', remplace_par: null, mis_de_cote_le: null, date_reprise: null, decision_le: null })
  }
  await rest('PATCH', `fichiers?id=eq.${E.id}`, { montant_ttc: null, variante_retenue: null, variantes_retenues: null })
  await rest('DELETE', `rappels?dossier_id=eq.${dossier.id}`)
}

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: 'ZZTEST-DEC', prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: 'ZZTEST-DEC dossier' })
  const base = { dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', type_doc: 'devis' }
  ;[A] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_PROD_202699101.pdf', montant_ttc: 10000, date_devis: '2026-10-01' })
  ;[B] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_PROD_202699102.pdf', montant_ttc: 12000, date_devis: '2026-10-05' })
  ;[C] = await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_AUTRE_202699103.pdf', montant_ttc: 5000, date_devis: '2026-10-03' })
  ;[E] = await rest('POST', 'fichiers', {
    ...base, nom: 'ZZTEST_OFFRES_202699104.pdf', date_devis: '2026-10-04',
    variantes: [{ libelle: 'Fauteuils', montant_ttc: 1000 }, { libelle: 'Local', montant_ttc: 2000 }],
  })
})

test.afterAll(async () => {
  await rest('DELETE', `rappels?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST-DEC dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.ZZTEST-DEC`)
})

const surveiller = (page) => {
  const p = []
  // Les appels Todoist sont coupés exprès (ERR_FAILED attendu), pas les autres erreurs.
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_FAILED') && p.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => p.push(`pageerror: ${e.message}`))
  page.on('response', (r) => r.status() >= 400 && p.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`))
  return p
}
const ouvrir = async (page) => {
  await page.route(/todoist-rappel|todoist-tache/, (route) => route.abort())
  await page.goto('/')
  await page.locator('input[type=search]').fill('ZZTEST-DEC')
  await page.getByText('ZZTEST-DEC Essai').click()
  await page.getByText('ZZTEST-DEC dossier').click()
  const jalons = page.getByLabel('Jalons du dossier')
  await page.getByText(/^Documents déposés/).waitFor()
  await page.waitForTimeout(1200) // la rubrique s'ouvre seule dès qu'un devis est à trancher
  if (!(await jalons.isVisible())) await page.getByText(/^Documents déposés/).click()
  await expect(jalons).toBeVisible()
}
const carte = (page, nom) => page.locator('li', { hasText: nom }).filter({ has: page.getByRole('group', { name: new RegExp(`Décision pour ${nom}`) }) }).first()
const bouton = (page, nom, libelle) => page.getByRole('group', { name: new RegExp(`Décision pour ${nom}`) }).getByRole('button', { name: libelle, exact: true })

test.beforeEach(async () => { await reinit() })

test('défaut « à trancher » : aucun devis ne compte, montant NULL « À chiffrer », ligne de temps', async ({ page }) => {
  const problemes = surveiller(page)
  expect(await montant()).toBeNull()
  await ouvrir(page)
  const temps = page.getByLabel('Ligne de temps des devis')
  await expect(temps).toBeVisible()
  await expect(temps).toContainText('n° 202699101')
  await expect(temps).toContainText('n° 202699102')
  await expect(temps.getByText('À trancher')).toHaveCount(4)
  await expect(page.getByLabel('Jalons du dossier')).toContainText('4 à trancher')
  for (const nom of ['ZZTEST_PROD_202699101', 'ZZTEST_AUTRE_202699103']) {
    await expect(bouton(page, nom, 'Retenu')).toHaveAttribute('aria-pressed', 'false')
    for (const b of ['Retenu', 'Alternative', 'Remplacé', 'Mis de côté']) {
      expect((await bouton(page, nom, b).boundingBox()).height).toBeGreaterThanOrEqual(44)
    }
  }
  expect(problemes).toEqual([])
})

test('les 4 décisions, cumul entre devis, annulation', async ({ page }) => {
  await ouvrir(page)
  const NA = 'ZZTEST_PROD_202699101'
  const NC = 'ZZTEST_AUTRE_202699103'

  // Retenu : le devis compte
  await bouton(page, NA, 'Retenu').click()
  await expect.poll(async () => (await ligne(A.id)).decision).toBe('retenu')
  await expect.poll(async () => num(await montant())).toBe(10000)

  // Cumul entre devis : un second devis retenu s'ajoute
  await bouton(page, NC, 'Retenu').click()
  await expect.poll(async () => num(await montant())).toBe(15000)

  // Alternative : ne compte pas ; Annuler rétablit
  await bouton(page, NC, 'Alternative').click()
  await expect.poll(async () => num(await montant())).toBe(10000)
  expect((await ligne(C.id)).decision).toBe('alternative')
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click()
  await expect.poll(async () => (await ligne(C.id)).decision).toBe('retenu')
  await expect.poll(async () => num(await montant())).toBe(15000)

  // Remplacé : ne compte pas, lié au devis retenu le plus récent, grisé avec sa date
  await bouton(page, NA, 'Remplacé').click()
  await expect.poll(async () => (await ligne(A.id)).decision).toBe('remplace')
  expect((await ligne(A.id)).remplace_par).toBe(C.id)
  await expect.poll(async () => num(await montant())).toBe(5000)
  await expect(carte(page, NA)).toHaveClass(/opacity-60/)
  await expect(carte(page, NA)).toContainText(/Remplacé le \d+\/\d+\/\d+/)

  // Aucun retenu : montant NULL (« À chiffrer »), jamais 0
  await bouton(page, NC, 'Alternative').click()
  await expect.poll(async () => await montant()).toBeNull()
})

test('proposition de remplacement par numéro : Oui / Non alternative / Non cumul, annulable', async ({ page }) => {
  await ouvrir(page)
  const NA = 'ZZTEST_PROD_202699101'
  const NB = 'ZZTEST_PROD_202699102'
  await bouton(page, NA, 'Retenu').click()
  await expect.poll(async () => num(await montant())).toBe(10000)

  // Jamais d'automatisme : la proposition ne s'affiche que sur le devis suivant, même racine
  const prop = carte(page, NB).getByRole('group', { name: 'Remplacement ?' })
  await expect(prop).toBeVisible()
  await expect(prop).toContainText('Ce devis remplace-t-il le précédent')
  await expect(carte(page, 'ZZTEST_AUTRE_202699103').getByRole('group', { name: 'Remplacement ?' })).toHaveCount(0)
  expect((await ligne(B.id)).decision).toBe('a_trancher') // rien décidé sans réponse

  // Oui : B retenu, A remplacé par B ; Annuler remet tout
  await prop.getByRole('button', { name: 'Oui', exact: true }).click()
  await expect.poll(async () => (await ligne(A.id)).decision).toBe('remplace')
  expect((await ligne(A.id)).remplace_par).toBe(B.id)
  expect((await ligne(B.id)).decision).toBe('retenu')
  await expect.poll(async () => num(await montant())).toBe(12000)
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click()
  await expect.poll(async () => (await ligne(B.id)).decision).toBe('a_trancher')
  await expect.poll(async () => (await ligne(A.id)).decision).toBe('retenu')
  await expect.poll(async () => num(await montant())).toBe(10000)

  // Non, alternative : B alternative, A reste retenu
  await carte(page, NB).getByRole('group', { name: 'Remplacement ?' }).getByRole('button', { name: 'Non, alternative' }).click()
  await expect.poll(async () => (await ligne(B.id)).decision).toBe('alternative')
  expect((await ligne(A.id)).decision).toBe('retenu')
  await expect.poll(async () => num(await montant())).toBe(10000)

  // Non, cumul : les deux comptent
  await rest('PATCH', `fichiers?id=eq.${B.id}`, { decision: 'a_trancher' })
  await ouvrir(page)
  await carte(page, NB).getByRole('group', { name: 'Remplacement ?' }).getByRole('button', { name: 'Non, cumul' }).click()
  await expect.poll(async () => num(await montant())).toBe(22000)
})

test('mis de côté : date de reprise → rappel, groupe « Reportés », exposé dans la RPC', async ({ page }) => {
  await ouvrir(page)
  const NC = 'ZZTEST_AUTRE_202699103'
  const avant = (await rpc()).reportes
  await bouton(page, NC, 'Mis de côté').click()
  await expect(page.getByLabel('Date de reprise')).toBeVisible()
  await page.getByLabel('Date de reprise').fill('2026-11-03') // un mardi
  await page.getByRole('button', { name: 'Mettre de côté' }).click()
  await expect.poll(async () => (await ligne(C.id)).decision).toBe('mis_de_cote')
  const c = await ligne(C.id)
  expect(c.date_reprise).toBe('2026-11-03')
  expect(c.mis_de_cote_le).not.toBeNull()
  await expect.poll(async () => (await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=date,note`)).length).toBe(1)
  const [rappel] = await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=date,note`)
  expect(rappel.date).toBe('2026-11-03')
  expect(rappel.note).toContain('Reprendre le devis')
  // Groupe « Reportés »
  await expect(page.getByText(/^Reportés · 1/)).toBeVisible()
  await expect(carte(page, NC)).toContainText('reprise le 03/11/2026')
  // Un dossier dont le seul devis décidé est mis de côté (aucun retenu) est « reporté » dans la RPC
  const apres = (await rpc()).reportes
  expect(apres.dossiers).toBe(avant.dossiers + 1)
  expect(apres.devis).toBe(avant.devis + 1)
  expect(Number(apres.montant)).toBe(Number(avant.montant) + 5000)
  // Sans date : pas de rappel
  await bouton(page, 'ZZTEST_PROD_202699101', 'Mis de côté').click()
  await page.getByRole('button', { name: 'Mettre de côté' }).click()
  await expect.poll(async () => (await ligne(A.id)).decision).toBe('mis_de_cote')
  expect((await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=id`)).length).toBe(1)
})

test('cumul entre offres d\'un même devis + autre devis retenu ; hors-ligne rejoué sans doublon', async ({ page, context }) => {
  await ouvrir(page)
  const NE = 'ZZTEST_OFFRES_202699104'
  const NA = 'ZZTEST_PROD_202699101'
  await bouton(page, NA, 'Retenu').click()
  await expect.poll(async () => num(await montant())).toBe(10000)
  // « Retenu » sur un devis à plusieurs offres sans choix : on oriente vers les offres
  await bouton(page, NE, 'Retenu').click()
  await expect(page.getByText(/plusieurs offres/)).toBeVisible()
  const e = carte(page, NE)
  await e.getByRole('button', { name: 'Cumuler', exact: true }).click()
  await e.getByRole('checkbox', { name: /Fauteuils/ }).click()
  await e.getByRole('checkbox', { name: /Local/ }).click()
  await e.getByRole('button', { name: /^Valider le cumul/ }).click()
  await expect.poll(async () => (await ligne(E.id)).decision).toBe('retenu')
  await expect.poll(async () => num(await montant())).toBe(13000) // 10 000 + (1 000 + 2 000)

  // Hors-ligne : « Alternative » sur A, puis la même écriture rejouée deux fois
  await context.setOffline(true)
  await bouton(page, NA, 'Alternative').click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length)).toBeGreaterThan(0)
  expect((await ligne(A.id)).decision).toBe('retenu') // rien n'est parti
  await page.evaluate(() => {
    const file = JSON.parse(localStorage.getItem('fv9:file-attente'))
    file.push({ ...file[0], id: crypto.randomUUID() })
    localStorage.setItem('fv9:file-attente', JSON.stringify(file))
  })
  await context.setOffline(false)
  await page.reload()
  await expect.poll(async () => (await ligne(A.id)).decision, { timeout: 30_000 }).toBe('alternative')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length), { timeout: 30_000 }).toBe(0)
  await expect.poll(async () => num(await montant())).toBe(3000)
  expect((await rest('GET', `rappels?dossier_id=eq.${dossier.id}&select=id`)).length).toBe(0)
})
