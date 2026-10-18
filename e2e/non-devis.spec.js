import { test, expect } from './base.js'
import { ouvrirDocuments, versAccueil, versDashboard } from './aides.js'
import { aTrancher, potentiel } from '../src/lib/documents.js'

// Fixtures propres à ce passage : jamais de doublon avec une autre session ou un reste d'un passage interrompu.
const NOM = `ZZTEST-NONDEVIS-${Math.random().toString(36).slice(2, 8)}`

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
  ;[client] = await rest('POST', 'clients', { nom_praticien: NOM, prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: `${NOM} dossier`, montant_estime: 4242 })
})

test.afterAll(async () => {
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.${NOM} dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.${NOM}`)
})

test('cdc / plan / autre « a_trancher » : jamais comptés, ni dans le potentiel, ni sur le Board, ni sur le Dashboard, ni dans le montant', async ({ page }) => {
  const base = { dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', decision: 'a_trancher', montant_ttc: 9999, a_trancher_raison: 'HT ou TTC ?', variantes: [{ libelle: 'A', montant_ttc: 1 }, { libelle: 'B', montant_ttc: 2 }] }
  await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_CDC_V1.pdf', type_doc: 'cdc', version_doc: 1 })
  await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_PLAN.pdf', type_doc: 'plan' })
  await rest('POST', 'fichiers', { ...base, nom: 'ZZTEST_SCAN.pdf', type_doc: 'autre' })

  // Ces fixtures seules (aucun compteur global de la base) : rien « à trancher », aucune offre, montant manuel intact
  const siennes = await rest('GET', `fichiers?dossier_id=eq.${dossier.id}&select=id,dossier_id,type_doc,montant_ttc,variantes,a_trancher_raison,decision,date_reprise`)
  expect(siennes).toHaveLength(3)
  expect(siennes.some((f) => aTrancher(f))).toBe(false)
  expect(potentiel(siennes).aTrancher).toEqual({ offres: 0, devis: 0, dossiers: 0, montantMin: 0 })
  await expect.poll(async () => Number((await rest('GET', `dossiers?id=eq.${dossier.id}&select=montant_estime`))[0].montant_estime)).toBe(4242)

  // Board : le dossier de test n'est dans aucune feuille « Devis à trancher »
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  const ligne = page.getByRole('button', { name: /Devis à trancher/ })
  if (await ligne.count()) {
    await ligne.click()
    await expect(page.getByRole('dialog')).not.toContainText(NOM)
    await page.keyboard.press('Escape')
  }

  // Dashboard : la liste « À trancher » n'a pas non plus le dossier de test
  await versDashboard(page)
  await page.getByRole('button', { name: /^À trancher/ }).first().click()
  const feuille = page.getByRole('dialog')
  await expect(feuille).toBeVisible()
  await expect(feuille).not.toContainText(NOM)
  await page.keyboard.press('Escape')

  await versAccueil(page)
  // Fiche du dossier : aucun « à trancher » dans les jalons, aucune décision proposée
  await page.locator('input[type=search]').fill(NOM)
  await page.getByText(`${NOM} Essai`).click()
  await page.getByText(`${NOM} dossier`).click()
  await ouvrirDocuments(page)
  await expect(page.getByLabel('Jalons du dossier')).not.toContainText('à trancher')
  await expect(page.getByRole('group', { name: /Décision pour/ })).toHaveCount(0)
})
