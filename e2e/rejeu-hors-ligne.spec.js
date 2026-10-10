import { test, expect } from '@playwright/test'
import { journaliser, noter } from './diag.js'
import { ouvrirDocuments, rendu } from './aides.js'

// Rejeu hors-ligne de deux gestes sur des offres d'un MÊME devis, dans les deux ordres possibles.
// Les écritures sont coupées (PATCH sur `fichiers` abandonné) pendant que l'application reste
// connectée au temps réel : un changement extérieur renvoie alors un écho qui ne contient pas les
// gestes en attente. Il ne doit pas faire reculer l'écran, même longtemps après (l'horloge de la
// page est avancée de 10 s : ancienne règle à délai de grâce) ; au rejeu, la base doit porter
// les DEUX états. Dossier jetable, nom unique par passage.
const NOM = `ZZTEST-REJ-${Math.random().toString(36).slice(2, 8)}`
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = async (methode, chemin, corps) => {
  const r = await fetch(`${URL_DB}/rest/v1/${chemin}`, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  noter(`TEST ${methode} ${chemin.slice(0, 90)} ${corps ? JSON.stringify(corps).slice(0, 160) : ''} → ${r.status} ${texte.slice(0, 220)}`)
  if (!r.ok) throw new Error(`${methode} ${chemin} → ${r.status} ${texte}`)
  return texte ? JSON.parse(texte) : null
}

let client, dossier, X
const OFFRES = () => [
  { libelle: 'Fauteuils', montant_ttc: 1000, etat: 'a_trancher' },
  { libelle: 'Local', montant_ttc: 2000, etat: 'a_trancher' },
  { libelle: 'Option', montant_ttc: 500, etat: 'a_trancher' },
]
const ligne = async () => (await rest('GET', `fichiers?id=eq.${X.id}&select=*`))[0]
const etats = async () => (await ligne()).variantes.map((o) => o.etat)

test.beforeAll(async () => {
  ;[client] = await rest('POST', 'clients', { nom_praticien: NOM, prenom_praticien: 'Essai' })
  ;[dossier] = await rest('POST', 'dossiers', { client_id: client.id, type: 'projet', statut: 'devis_envoye', titre: `${NOM} dossier` })
  ;[X] = await rest('POST', 'fichiers', {
    dossier_id: dossier.id, chemin: 'zztest/aucun.pdf', taille: 1000, type_mime: 'application/pdf', type_doc: 'devis',
    nom: 'ZZTEST_REJEU_202699501.pdf', date_devis: '2026-10-01', variantes: OFFRES(),
  })
})
test.afterAll(async () => {
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
  await rest('DELETE', `fichiers?dossier_id=eq.${dossier.id}&chemin=eq.zztest/aucun.pdf`)
  await rest('DELETE', `dossiers?id=eq.${dossier.id}&titre=eq.${NOM} dossier`)
  await rest('DELETE', `clients?id=eq.${client.id}&nom_praticien=eq.${NOM}`)
})
test.beforeEach(async ({ page }, testInfo) => {
  journaliser(page, testInfo)
  await rest('PATCH', `fichiers?id=eq.${X.id}`, { variantes: OFFRES(), montant_ttc: null, montant_ht: null, variante_retenue: null, variantes_retenues: null, decision: 'a_trancher', taille: 1000, nom: 'ZZTEST_REJEU_202699501.pdf' })
  await rest('DELETE', `dossier_notes?dossier_id=eq.${dossier.id}`)
})

const geste = (page, libelle, nom) => page.getByRole('group', { name: new RegExp(`État de l'offre ${libelle}`) }).getByRole('button', { name: nom, exact: true })
const longueurFile = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length)

const ordres = [
  ['« Local écartée » puis « Option retenue »', [['Local', 'Écartée'], ['Option', 'Retenue']]],
  ['« Option retenue » puis « Local écartée »', [['Option', 'Retenue'], ['Local', 'Écartée']]],
]
for (const [titre, gestes] of ordres) {
  test(`hors-ligne : ${titre}, écho extérieur tardif, rejeu — les deux états en base`, async ({ page }) => {
    await page.clock.install()
    let abonne = false
    let echos = 0
    await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
      const serveur = ws.connectToServer()
      ws.onMessage((m) => serveur.send(m))
      serveur.onMessage((m) => {
        const texte = typeof m === 'string' ? m : ''
        if (texte.includes(`fichiers-dossier_id-${dossier.id}`) && texte.includes('phx_reply') && texte.includes('"status":"ok"')) abonne = true
        if (texte.includes('"table":"fichiers"') && texte.includes('"type":"UPDATE"')) echos += 1
        ws.send(m)
      })
    })
    let coupe = false
    await page.route(/\/rest\/v1\/fichiers/, (route) => (coupe && route.request().method() === 'PATCH' ? route.abort() : route.continue()))
    await page.route(/todoist-rappel|todoist-tache/, (route) => route.abort())
    await page.goto('/')
    await page.locator('input[type=search]').fill(NOM)
    await page.getByText(`${NOM} Essai`).click()
    await page.getByText(`${NOM} dossier`).click()
    await ouvrirDocuments(page)
    await expect.poll(() => abonne, { timeout: 30_000 }).toBe(true)

    // Hors-ligne : premier geste, mis en file ; la base n'a rien reçu
    coupe = true
    const [[libelle1, bouton1], [libelle2, bouton2]] = gestes
    await geste(page, libelle1, bouton1).click()
    await expect.poll(() => longueurFile(page)).toBe(1)
    expect(await etats()).toEqual(['a_trancher', 'a_trancher', 'a_trancher'])

    // Le temps passe (ancienne règle : le délai de grâce expirerait), puis un changement extérieur
    // renvoie un écho SANS le geste en attente.
    await page.clock.fastForward(10_000)
    const avantEcho = echos
    await rest('PATCH', `fichiers?id=eq.${X.id}`, { taille: 2468 })
    await expect.poll(() => echos, { timeout: 30_000 }).toBeGreaterThan(avantEcho)
    await rendu(page)
    await expect(geste(page, libelle1, bouton1)).toHaveAttribute('aria-pressed', 'true') // l'écran n'a pas reculé

    // Second geste, calculé sur l'état courant (celui qui contient le premier)
    await geste(page, libelle2, bouton2).click()
    await expect.poll(() => longueurFile(page)).toBe(2)
    await expect(geste(page, libelle1, bouton1)).toHaveAttribute('aria-pressed', 'true')
    await expect(geste(page, libelle2, bouton2)).toHaveAttribute('aria-pressed', 'true')

    // Retour du réseau : rejeu dans l'ordre de la file
    coupe = false
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect.poll(() => longueurFile(page), { timeout: 30_000 }).toBe(0)
    await expect.poll(etats, { timeout: 30_000 }).toEqual(['a_trancher', 'ecartee', 'retenue'])
    const l = await ligne()
    expect(Number(l.montant_ttc)).toBe(500)
    expect(l.decision).toBe('retenu')
    await expect(geste(page, 'Local', 'Écartée')).toHaveAttribute('aria-pressed', 'true')
    await expect(geste(page, 'Option', 'Retenue')).toHaveAttribute('aria-pressed', 'true')

    // File vide : le fichier est rendu aux mises à jour extérieures (aucun délai à attendre)
    const nouveauNom = 'ZZTEST_REJEU_RENOMME.pdf'
    await rest('PATCH', `fichiers?id=eq.${X.id}`, { nom: nouveauNom })
    await expect(page.getByText(/ZZTEST_REJEU_RENOMME/).first()).toBeVisible()
  })
}

test('premier rejeu raté (réseau pas encore prêt) : la file se revide seule, sans nouveau déclencheur', async ({ page }) => {
  let coupe = true
  let tentatives = 0
  await page.route(/\/rest\/v1\/fichiers/, (route) => {
    if (route.request().method() === 'PATCH' && coupe) {
      tentatives += 1
      return route.abort()
    }
    return route.continue()
  })
  await page.route(/todoist-rappel|todoist-tache/, (route) => route.abort())
  await page.goto('/')
  await page.locator('input[type=search]').fill(NOM)
  await page.getByText(`${NOM} Essai`).click()
  await page.getByText(`${NOM} dossier`).click()
  await ouvrirDocuments(page)

  await geste(page, 'Local', 'Écartée').click()
  await expect.poll(() => longueurFile(page)).toBe(1)
  const avant = tentatives // l'écriture d'origine

  // « Retour du réseau » : un rejeu part, mais le réseau n'est pas prêt — il échoue
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => tentatives, { timeout: 15_000 }).toBeGreaterThan(avant)
  expect(await longueurFile(page)).toBe(1)

  // Le réseau devient réellement disponible, SANS nouvel événement : la file doit se vider seule
  coupe = false
  await expect.poll(() => longueurFile(page), { timeout: 60_000 }).toBe(0)
  await expect.poll(etats, { timeout: 30_000 }).toEqual(['a_trancher', 'ecartee', 'a_trancher'])
})
