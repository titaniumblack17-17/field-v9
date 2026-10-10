import { test, expect } from '@playwright/test'

// Historique des étapes : dossier jetable (ZZTEST-HISTO), supprimé à la fin.
// Étape de test « négociation » : elle ne crée ni rappel ni tâche Todoist.
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}
const historique = (id) => rest('GET', `dossier_etapes_historique?dossier_id=eq.${id}&select=statut_avant,statut_apres,source,avant_inconnu&order=id`)

let client, dossier

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: 'ZZTEST-HISTO', prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'prospect', titre: 'ZZTEST-HISTO dossier' })
})

test.afterAll(async () => {
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST-HISTO dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.ZZTEST-HISTO`)
})

test('création = 1 ligne ; rejeu hors-ligne d\'un même changement ne duplique rien ; suppression en cascade', async ({ page }) => {
  expect(await historique(dossier.id)).toEqual([{ statut_avant: null, statut_apres: 'prospect', source: 'trigger', avant_inconnu: false }])

  // Deux entrées identiques dans la file (le même geste rejoué), posées pendant une coupure
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await page.context().setOffline(true)
  await page.evaluate((id) => {
    const entree = () => ({ type: 'etape', dossierId: id, statut: 'negociation', id: crypto.randomUUID(), horodatage: new Date().toISOString() })
    localStorage.setItem('fv9:file-attente', JSON.stringify([entree(), entree()]))
  }, dossier.id)
  expect((await historique(dossier.id)).length).toBe(1) // rien n'est parti
  await page.context().setOffline(false)
  await page.reload()

  await expect.poll(async () => (await rest('GET', `dossiers?id=eq.${dossier.id}&select=statut`))[0].statut, { timeout: 30_000 }).toBe('negociation')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length), { timeout: 30_000 }).toBe(0)
  const h = await historique(dossier.id)
  expect(h).toHaveLength(2)
  expect(h[1]).toEqual({ statut_avant: 'prospect', statut_apres: 'negociation', source: 'trigger', avant_inconnu: false })

  // Suppression du dossier : son historique part avec lui
  const [jetable] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'prospect', titre: 'ZZTEST-HISTO cascade' })
  expect((await historique(jetable.id)).length).toBe(1)
  await rest('DELETE', `dossiers?id=eq.${jetable.id}&titre=eq.ZZTEST-HISTO cascade`)
  expect((await historique(jetable.id)).length).toBe(0)
})
