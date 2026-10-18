import { test, expect } from './base.js'
import { ouvrirDocuments, versDashboard } from './aides.js'

// Décision « Écarté » au niveau d'un devis. Fixtures ZZTEST propres à ce passage (un dossier par scénario), supprimées en
// fin. Aucun rappel n'est créé, donc aucun appel Todoist.
const NOM = `ZZTEST-ECA-${Math.random().toString(36).slice(2, 8)}`
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

const D = {} // A montant · B tuile · C offres · D urgence · E hors ligne
const F = {}
const clients = []
const base = (cle) => ({ dossier_id: D[cle].id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', type_doc: 'devis' })
const ligne = async (id) => (await rest('GET', `fichiers?id=eq.${id}&select=*`))[0]
const dossier = async (cle) => (await rest('GET', `dossiers?id=eq.${D[cle].id}&select=statut,montant_estime`))[0]

test.beforeAll(async () => {
  for (const [cle, statut] of [['A', 'devis_envoye'], ['B', 'devis_envoye'], ['C', 'devis_envoye'], ['D', 'devis_envoye'], ['E', 'devis_envoye']]) {
    const [c] = await rest('POST', 'clients', { nom_praticien: `${NOM}-${cle}`, prenom_praticien: 'Essai' })
    clients.push(c)
    ;[D[cle]] = await rest('POST', 'dossiers', { client_id: c.id, type: 'projet', statut, titre: `${NOM}-${cle} dossier` })
  }
  // A : deux devis retenus (cumul 7 000 €) · B : un devis à trancher · C : un devis à deux offres à trancher
  ;[F.A1] = await rest('POST', 'fichiers', { ...base('A'), nom: 'ZZTEST_ECA_202699001.pdf', montant_ttc: 5000, decision: 'retenu', date_devis: '2026-10-01' })
  ;[F.A2] = await rest('POST', 'fichiers', { ...base('A'), nom: 'ZZTEST_ECA_202699002.pdf', montant_ttc: 2000, decision: 'retenu', date_devis: '2026-10-02' })
  ;[F.B1] = await rest('POST', 'fichiers', { ...base('B'), nom: 'ZZTEST_ECA_202699003.pdf', montant_ttc: 3000, decision: 'a_trancher', date_devis: '2026-10-01' })
  ;[F.C1] = await rest('POST', 'fichiers', {
    ...base('C'), nom: 'ZZTEST_ECA_202699004.pdf', decision: 'a_trancher', date_devis: '2026-10-01',
    variantes: [{ libelle: 'Offre X', montant_ttc: 8000, etat: 'a_trancher' }, { libelle: 'Offre Y', montant_ttc: 9000, etat: 'a_trancher' }],
  })
  ;[F.D1] = await rest('POST', 'fichiers', { ...base('D'), nom: 'ZZTEST_ECA_202699005.pdf', montant_ttc: 1500, decision: 'a_trancher', date_devis: '2026-08-01' })
  ;[F.E1] = await rest('POST', 'fichiers', { ...base('E'), nom: 'ZZTEST_ECA_202699006.pdf', montant_ttc: 4000, decision: 'retenu', date_devis: '2026-10-01' })
  ;[F.E2] = await rest('POST', 'fichiers', { ...base('E'), nom: 'ZZTEST_ECA_202699007.pdf', montant_ttc: 1000, decision: 'retenu', date_devis: '2026-10-02' })
  // D : « devis envoyé » depuis plus de 30 jours (seuil du signal « devis sans réponse »)
  await rest('PATCH', `dossiers?id=eq.${D.D.id}&titre=like.${NOM}*`, { statut_changed_at: new Date(Date.now() - 40 * 86_400_000).toISOString() })
})

test.afterAll(async () => {
  for (const d of Object.values(D)) {
    await rest('DELETE', `fichiers?dossier_id=eq.${d.id}&nom=like.ZZTEST*`)
    await rest('DELETE', `dossiers?id=eq.${d.id}&titre=like.${NOM}*`)
  }
  for (const c of clients) await rest('DELETE', `clients?id=eq.${c.id}&nom_praticien=like.${NOM}*`)
})

async function ouvrirFiche(page, cle) {
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await page.locator('input[type=search]').fill(`${NOM}-${cle}`)
  await page.getByText(`${NOM}-${cle} Essai`).click()
  await page.getByText(`${NOM}-${cle} dossier`).click()
  await ouvrirDocuments(page)
}
const carte = (page, nom) => page.locator('li[data-decision]', { hasText: nom })
const groupeDecision = (page, nom) => page.getByRole('group', { name: `Décision pour ${nom}` })
const montantAffiche = (page) => page.getByRole('button', { name: /^Montant/ })
const sansDebordement = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('écarter un devis : motif, grisé, étiquette ; le montant du dossier se recalcule tout de suite ; remettre en jeu', async ({ page }) => {
  const erreurs = []
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()))
  page.on('pageerror', (e) => erreurs.push(String(e)))
  await ouvrirFiche(page, 'A')
  await expect(montantAffiche(page)).toContainText(/7[\s  ]000/)

  const nom = 'ZZTEST_ECA_202699002.pdf'
  await groupeDecision(page, nom).getByRole('button', { name: 'Écarté' }).click()
  // Panneau du motif : puces rapides + saisie libre, rien n'est encore écrit.
  const motif = page.getByRole('group', { name: "Motif d'écartement" })
  for (const m of ['Matériel non choisi', 'Trop cher', 'Concurrent', 'Autre']) await expect(motif.getByRole('button', { name: m })).toBeVisible()
  expect((await ligne(F.A2.id)).decision).toBe('retenu')
  await motif.getByRole('button', { name: 'Trop cher' }).click()
  await motif.getByLabel('Motif libre').fill('Trop cher — a pris chez un concurrent')
  await motif.getByRole('button', { name: 'Écarter ce devis' }).click()

  // L'écran suit sans attendre : étiquette, motif, grisé, nouveau montant (5 000 €).
  const c = carte(page, nom)
  await expect(c.getByTestId('devis-ecarte')).toContainText('Écarté')
  await expect(c.getByTestId('devis-ecarte')).toContainText('Motif : Trop cher — a pris chez un concurrent')
  await expect(c).toHaveClass(/opacity-60/)
  await expect(montantAffiche(page)).toContainText(/5[\s  ]000/)
  await expect.poll(async () => (await ligne(F.A2.id)).decision).toBe('ecarte')
  const l = await ligne(F.A2.id)
  expect(l.motif_ecart).toBe('Trop cher — a pris chez un concurrent')
  expect(l.ecarte_le).not.toBeNull()
  // La base a recalculé le même montant ; ni l'étape ni le statut n'ont bougé.
  await expect.poll(async () => num((await dossier('A')).montant_estime)).toBe(5000)
  expect((await dossier('A')).statut).toBe('devis_envoye')
  expect(await sansDebordement(page)).toBe(true)

  // Remettre en jeu : « à trancher », motif et date effacés ; le montant reste 5 000 € (un devis à trancher n'y entre pas).
  await c.getByRole('button', { name: 'Remettre en jeu' }).click()
  await expect(c.getByTestId('devis-ecarte')).toHaveCount(0)
  await expect.poll(async () => (await ligne(F.A2.id)).decision).toBe('a_trancher')
  const r = await ligne(F.A2.id)
  expect(r.motif_ecart).toBeNull()
  expect(r.ecarte_le).toBeNull()
  expect(erreurs, erreurs.join('\n')).toEqual([])
})

test('devis à deux offres : « Écarter ce devis » ; ses offres sont ignorées du potentiel (RPC = recalcul)', async ({ page }) => {
  const avant = (await rpc()).potentiel.a_trancher
  await ouvrirFiche(page, 'C')
  const nom = 'ZZTEST_ECA_202699004.pdf'
  await carte(page, nom).getByRole('button', { name: 'Écarter ce devis' }).click()
  await page.getByRole('group', { name: "Motif d'écartement" }).getByRole('button', { name: 'Concurrent' }).click()
  await page.getByRole('group', { name: "Motif d'écartement" }).getByRole('button', { name: 'Écarter ce devis' }).click()
  await expect(carte(page, nom).getByTestId('devis-ecarte')).toContainText('Motif : Concurrent')
  await expect.poll(async () => (await ligne(F.C1.id)).decision).toBe('ecarte')
  const apres = (await rpc()).potentiel.a_trancher
  expect(apres.offres).toBe(avant.offres - 2)
  expect(apres.devis).toBe(avant.devis - 1)
  expect(apres.dossiers).toBe(avant.dossiers - 1)
  await expect(carte(page, nom).getByText('Offres : décidez chacune')).toHaveCount(0) // plus proposées à la décision
  // Les offres gardent leur état dans le jsonb (rien n'est réécrit) : remettre en jeu les rend à nouveau à trancher.
  expect((await ligne(F.C1.id)).variantes.map((v) => v.etat)).toEqual(['a_trancher', 'a_trancher'])
  await carte(page, nom).getByRole('button', { name: 'Remettre en jeu' }).click()
  await expect.poll(async () => (await rpc()).potentiel.a_trancher.offres).toBe(avant.offres)
})

test('tuile « À trancher » = liste du Pilotage = liste Projets = base, devis écarté exclu ; relance « sans réponse » retirée', async ({ page }) => {
  const avant = await rpc()
  // B (à trancher) et D (devis envoyé depuis 40 jours) comptent d'abord ; on les écarte par la base.
  expect(avant.potentiel.a_trancher.dossiers).toBeGreaterThanOrEqual(2)
  await rest('PATCH', `fichiers?id=eq.${F.B1.id}`, { decision: 'ecarte', ecarte_le: new Date().toISOString(), motif_ecart: 'Autre' })
  await rest('PATCH', `fichiers?id=eq.${F.D1.id}`, { decision: 'ecarte', ecarte_le: new Date().toISOString() })
  const apres = await rpc()
  expect(apres.potentiel.a_trancher.devis).toBe(avant.potentiel.a_trancher.devis - 2)
  expect(apres.potentiel.a_trancher.dossiers).toBe(avant.potentiel.a_trancher.dossiers - 2)
  expect(apres.projets.a_trancher).toBe(avant.projets.a_trancher - 2)
  expect(apres.a_trancher.devis).toBe(avant.a_trancher.devis - 2) // « Dossiers à trancher »
  // Le devis de D est écarté : plus de « devis sans réponse » pour ce dossier (les autres dossiers restent comptés).
  expect(apres.en_retard.devis).toBe(avant.en_retard.devis - 1)
  // Ni l'objectif signé, ni l'étape, ni les reportées ne bougent.
  expect(apres.signe).toEqual(avant.signe)
  expect(apres.potentiel.reportees).toEqual(avant.potentiel.reportees)
  expect((await dossier('B')).statut).toBe('devis_envoye')

  const at = apres.potentiel.a_trancher
  await page.goto('/')
  await versDashboard(page)
  const tuile = page.getByRole('button', { name: /^À trancher/ }).first()
  await expect(tuile).toContainText(`${at.devis} devis · ${at.dossiers} dossier`)
  await tuile.click()
  const feuille = page.getByRole('dialog')
  await expect(feuille.getByRole('heading')).toContainText(`${at.devis} devis`)
  await expect(feuille.locator('ul li')).toHaveCount(at.offres)
  await expect(feuille).not.toContainText(`${NOM}-B`) // devis écarté : hors de la liste
  await expect(feuille).not.toContainText(`${NOM}-D`)
  await feuille.getByRole('button', { name: /Voir ces projets dans la liste/ }).click()
  await expect(page.getByRole('button', { name: `Dossiers à trancher : ${apres.projets.a_trancher}` })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('main ul > li')).toHaveCount(apres.projets.a_trancher)
  await expect(page.locator('main')).not.toContainText(`${NOM}-B`)
  expect(await sansDebordement(page)).toBe(true)

  // « En retard » du Pilotage ne liste plus le dossier D.
  await page.goto('/')
  await versDashboard(page)
  await page.getByRole('button', { name: /^En retard/ }).first().click()
  await expect(page.getByRole('dialog')).not.toContainText(`${NOM}-D`)
})

test('hors ligne : le montant se recalcule sur place, l’écriture est rejouée au retour du réseau', async ({ page, context }) => {
  test.setTimeout(110_000)
  await ouvrirFiche(page, 'E')
  await expect(montantAffiche(page)).toContainText(/5[\s  ]000/)
  await context.setOffline(true)
  const nom = 'ZZTEST_ECA_202699007.pdf'
  await groupeDecision(page, nom).getByRole('button', { name: 'Écarté' }).click()
  await page.getByRole('group', { name: "Motif d'écartement" }).getByRole('button', { name: 'Matériel non choisi' }).click()
  await page.getByRole('group', { name: "Motif d'écartement" }).getByRole('button', { name: 'Écarter ce devis' }).click()
  await expect(carte(page, nom).getByTestId('devis-ecarte')).toContainText('Matériel non choisi')
  await expect(montantAffiche(page)).toContainText(/4[\s  ]000/) // sans réseau
  expect((await ligne(F.E2.id)).decision).toBe('retenu') // pas encore en base
  await context.setOffline(false)
  await expect.poll(async () => (await ligne(F.E2.id)).decision, { timeout: 80_000 }).toBe('ecarte')
  expect((await ligne(F.E2.id)).motif_ecart).toBe('Matériel non choisi')
  await expect.poll(async () => num((await dossier('E')).montant_estime)).toBe(4000)
})
