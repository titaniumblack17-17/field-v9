import { test, expect } from '@playwright/test'
import { ouvrirDocuments, annuler } from './aides.js'

// La base peut déjà porter une décision alors que le bandeau « Annuler » montre encore la précédente (il ne
// change qu'une fois l'écriture terminée côté application). Reproduit de façon déterministe : la réponse de
// l'écriture est retenue jusqu'à ce que le test la libère. Un « Annuler » pressé trop tôt annule alors l'ANCIENNE
// décision ; `annuler(page, motif)` attend le bon bandeau.
const NOM = `ZZTEST-ANN-${Math.random().toString(36).slice(2, 8)}`
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}
let client, dossier, A
const decision = async () => (await rest('GET', `fichiers?id=eq.${A.id}&select=decision`))[0].decision

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: NOM, prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: `${NOM} dossier` })
  ;[A] = await rest('POST', 'fichiers', { dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1, type_mime: 'application/pdf', type_doc: 'devis', nom: 'ZZTEST_ANN_202699601.pdf', montant_ttc: 10000, date_devis: '2026-10-01' })
})
test.afterAll(async () => {
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.${NOM} dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.${NOM}`)
})
test.beforeEach(async () => { await rest('PATCH', `fichiers?id=eq.${A.id}`, { decision: 'a_trancher', remplace_par: null, mis_de_cote_le: null, date_reprise: null, decision_le: null }) })

const preparer = async (page) => {
  let retenir = false
  let liberer = () => {}
  await page.route(/\/rest\/v1\/fichiers\?id=eq/, async (route) => {
    if (route.request().method() !== 'PATCH' || !retenir) return route.continue()
    const reponse = await route.fetch() // la base reçoit l'écriture tout de suite…
    await new Promise((r) => (liberer = r)) // …l'application n'en est informée que plus tard
    return route.fulfill({ response: reponse })
  })
  await page.route(/todoist-rappel|todoist-tache/, (route) => route.abort())
  await page.goto('/')
  await page.locator('input[type=search]').fill(NOM)
  await page.getByText(`${NOM} Essai`).click()
  await page.getByText(`${NOM} dossier`).click()
  await ouvrirDocuments(page)
  const groupe = page.getByRole('group', { name: /Décision pour ZZTEST_ANN_202699601/ })
  await groupe.getByRole('button', { name: 'Retenu', exact: true }).click()
  await expect.poll(decision).toBe('retenu')
  await expect(page.getByRole('status')).toContainText(/retenu/)
  return { groupe, retenir: () => (retenir = true), liberer: () => liberer() }
}

test('« Annuler » attend le bandeau de la bonne décision, même quand la base est en avance', async ({ page }) => {
  const { groupe, retenir, liberer } = await preparer(page)
  retenir()
  await groupe.getByRole('button', { name: 'Alternative', exact: true }).click()
  await expect.poll(decision).toBe('alternative') // la base l'a, le bandeau montre encore « retenu »
  await expect(page.getByRole('status')).toContainText(/retenu/)
  await expect(page.getByRole('status')).not.toContainText(/alternative/)
  liberer()
  await annuler(page, /alternative/)
  await expect.poll(decision).toBe('retenu') // c'est bien l'alternative qui a été annulée
})

test('sans attendre le bon bandeau, « Annuler » défait l\'ancienne décision (le défaut de test que le garde corrige)', async ({ page }) => {
  const { groupe, retenir, liberer } = await preparer(page)
  retenir()
  await groupe.getByRole('button', { name: 'Alternative', exact: true }).click()
  await expect.poll(decision).toBe('alternative')
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click() // trop tôt : bandeau « retenu »
  liberer()
  await expect.poll(decision).toBe('a_trancher') // l'ancienne décision (retenu) a été défaite, pas l'alternative
})
