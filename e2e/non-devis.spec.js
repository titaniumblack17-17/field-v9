import { test, expect } from '@playwright/test'

// Les fichiers qui ne sont pas des devis (cahier des charges, plan, autre) ont la
// décision par défaut « a_trancher » en base, mais n'entrent JAMAIS dans « À trancher »
// ni dans un montant. Cas adverse : ils portent ici offres, doute HT/TTC et montant.
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

let client, dossier

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: 'ZZTEST-NONDEVIS', prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: 'ZZTEST-NONDEVIS dossier', montant_estime: 4242 })
})

test.afterAll(async () => {
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST-NONDEVIS dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.ZZTEST-NONDEVIS`)
})

test('cdc / plan / autre « a_trancher » : jamais comptés, ni dans la RPC, ni sur le Board, ni sur le Dashboard, ni dans le montant', async ({ page }) => {
  const avant = await rpc()
  const base = { dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', decision: 'a_trancher', montant_ttc: 9999, a_trancher_raison: 'HT ou TTC ?', variantes: [{ libelle: 'A', montant_ttc: 1 }, { libelle: 'B', montant_ttc: 2 }] }
  await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_CDC_V1.pdf', type_doc: 'cdc', version_doc: 1 })
  await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_PLAN.pdf', type_doc: 'plan' })
  await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_SCAN.pdf', type_doc: 'autre' })

  // RPC : à trancher et reportés inchangés ; le montant manuel du dossier n'est pas touché
  const apres = await rpc()
  expect(apres.a_trancher).toEqual(avant.a_trancher)
  expect(apres.potentiel).toEqual(avant.potentiel) // potentiel ouvert (par offre) inchangé aussi
  expect(apres.reportes).toEqual(avant.reportes)
  expect(apres.signe).toEqual(avant.signe)
  expect(Number((await rest('GET', `dossiers?id=eq.${dossier.id}&select=montant_estime`))[0].montant_estime)).toBe(4242)

  // Board : la ligne « Devis à trancher » est la même
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  const ligne = page.getByRole('button', { name: /Devis à trancher/ })
  const texteBoard = (await ligne.count()) ? await ligne.innerText() : ''
  const pa = avant.potentiel.a_trancher
  if (pa.devis > 0) expect(texteBoard).toContain(`${pa.devis} devis · ${pa.dossiers} dossier`)
  else expect(texteBoard).toBe('')

  // Dashboard : tuile et liste sans le dossier de test
  await expect(page.getByRole('button', { name: /^À trancher/ }).first()).toContainText(`${pa.devis} devis · ${pa.dossiers} dossier`)
  await page.getByRole('button', { name: /^À trancher/ }).first().click()
  const feuille = page.getByRole('dialog')
  await expect(feuille.locator('ul > li')).toHaveCount(pa.offres)
  await expect(feuille).not.toContainText('NONDEVIS')
  await page.keyboard.press('Escape')

  // Fiche du dossier : aucun « à trancher » dans les jalons, aucune décision proposée
  await page.locator('input[type=search]').fill('ZZTEST-NONDEVIS')
  await page.getByText('ZZTEST-NONDEVIS Essai').click()
  await page.getByText('ZZTEST-NONDEVIS dossier').click()
  await page.getByText(/^Documents déposés/).waitFor()
  await page.waitForTimeout(1200)
  if (!(await page.getByLabel('Jalons du dossier').isVisible())) await page.getByText(/^Documents déposés/).click()
  await expect(page.getByLabel('Jalons du dossier')).not.toContainText('à trancher')
  await expect(page.getByRole('group', { name: /Décision pour/ })).toHaveCount(0)
})
