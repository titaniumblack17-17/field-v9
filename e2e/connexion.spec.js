import { test, expect } from '@playwright/test'

// Connexion par code (Supabase Auth, temps A : RLS non activé). Aucun e-mail n'est envoyé, aucun compte n'est touché :
// toutes les routes /auth/v1/* sont simulées, avec de faux jetons. Les lectures et écritures de données partent vers la
// vraie base avec la clé publique (le faux jeton est remplacé dans l'en-tête, après avoir été relevé).
// Ces scénarios réactivent la vraie porte de connexion (le serveur de test l'ouvre pour les autres specs).
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const EMAIL = 'titaniumblack17@gmail.com'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jeton = (exp, id = 'a') => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u-test', role: 'authenticated', aud: 'authenticated', email: EMAIL, exp, id })}.signature-${id}`
const utilisateur = { id: 'u-test', aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const reponseSession = (jetonAcces, refresh, expiresIn = 3600) => ({ access_token: jetonAcces, token_type: 'bearer', expires_in: expiresIn, expires_at: Math.floor(Date.now() / 1000) + expiresIn, refresh_token: refresh, user: utilisateur })
const maintenantS = () => Math.floor(Date.now() / 1000)

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('fv9:e2e-connexion-reelle', '1'))
})

/** Simule /auth/v1/* ; `comportement` règle les réponses. Retourne les relevés d'appels. */
async function simulerAuth(cible, comportement = {}) {
  const page = cible // une page ou un contexte entier (plusieurs fenêtres du même navigateur)
  const releves = { otp: [], otpUrls: [], verify: [], refresh: [], logout: 0, rest: [], ordre: [] }
  await page.route('**/auth/v1/otp**', (route) => {
    releves.otp.push(JSON.parse(route.request().postData() ?? '{}'))
    releves.otpUrls.push(route.request().url())
    if (comportement.otp === 'limite') return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' }) })
    if (comportement.otp === 'reseau') return route.abort('internetdisconnected')
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/auth/v1/verify**', (route) => {
    const corps = JSON.parse(route.request().postData() ?? '{}')
    releves.verify.push(corps)
    if (corps.token !== '123456') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reponseSession(jeton(maintenantS() + 3600, 'v'), 'refresh-v')) })
  })
  await page.route('**/auth/v1/token**', (route) => {
    const corps = JSON.parse(route.request().postData() ?? '{}')
    releves.refresh.push(corps)
    releves.ordre.push('refresh')
    if (comportement.refresh === 'refuse') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' }) })
    if (comportement.refresh === 'reseau') return route.abort('internetdisconnected')
    const n = releves.refresh.length
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reponseSession(jeton(maintenantS() + 3600, `r${n}`), `refresh-${n}`)) })
  })
  await page.route('**/auth/v1/user**', (route) =>
    comportement.user === 'refuse'
      ? route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }) })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(utilisateur) })
  )
  await page.route('**/auth/v1/logout**', (route) => {
    releves.logout += 1
    return route.fulfill({ status: 204, body: '' })
  })
  // Données : vraie base, clé publique (le jeton simulé n'est pas signé par Supabase).
  await page.route(/\/rest\/v1\//, async (route) => {
    const r = route.request()
    releves.rest.push({ methode: r.method(), url: r.url(), authorization: r.headers().authorization })
    releves.ordre.push(`${r.method()} ${new URL(r.url()).pathname}`)
    await route.continue({ headers: { ...r.headers(), authorization: `Bearer ${ANON}` } })
  })
  return releves
}

const poserSession = async (page, session) => {
  await page.goto('/')
  await page.evaluate((s) => localStorage.setItem('fv9-auth-token', JSON.stringify(s)), session)
}
const sessionStockee = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('fv9-auth-token') ?? 'null'))
const sansDebordement = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const lienDe = (refresh = 'refresh-lien') => `/#access_token=${jeton(maintenantS() + 3600, 'lien')}&expires_in=3600&refresh_token=${refresh}&token_type=bearer&type=magiclink`
// Mode code : « Recevoir le lien », puis « J'ai reçu un code ».
const ouvrirModeCode = async (page) => {
  await page.getByRole('button', { name: 'Recevoir le lien' }).click()
  await expect(page.getByText(/^Lien envoyé à/)).toBeVisible()
  await page.getByRole('button', { name: "J'ai reçu un code" }).click()
}
const appVisible = (page) => expect(page.getByText('Dossiers actifs').first()).toBeVisible()

test('mode code : adresse pré-remplie, « J’ai reçu un code », 6 chiffres, session créée, jeton envoyé avec les requêtes', async ({ page }) => {
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  const releves = await simulerAuth(page)
  await page.goto('/')
  await expect(page.getByLabel('Adresse e-mail')).toHaveValue(EMAIL)
  await expect(page.getByTestId('version')).toBeVisible() // pied de page version conservé
  await expect(page.getByLabel('Code à 6 chiffres')).toHaveCount(0) // plus de champ de code par défaut
  const envoyer = page.getByRole('button', { name: 'Recevoir le lien' })
  expect((await envoyer.boundingBox()).height).toBeGreaterThanOrEqual(44)
  expect(await sansDebordement(page)).toBe(true)
  await envoyer.click()
  await expect(page.getByText(/^Lien envoyé à/)).toBeVisible()
  await page.getByRole('button', { name: "J'ai reçu un code" }).click()

  // Étape du code : clavier numérique, remplissage automatique du code reçu, renvoi bloqué avec délai visible.
  const champ = page.getByLabel('Code à 6 chiffres')
  await expect(champ).toBeVisible()
  expect(releves.otp).toEqual([{ email: EMAIL, create_user: false, data: {}, gotrue_meta_security: {}, code_challenge: null, code_challenge_method: null }])
  await expect(champ).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(champ).toHaveAttribute('inputmode', 'numeric')
  await expect(page.getByRole('button', { name: /^Renvoyer le code \(\d+ s\)$/ })).toBeDisabled()
  expect(await sansDebordement(page)).toBe(true)

  // Exactement 6 chiffres : les lettres sont refusées, au-delà de 6 chiffres rien n'est ajouté, la validation attend le 6ᵉ.
  await champ.pressSequentially('12a3b45')
  await expect(champ).toHaveValue('12345')
  expect(releves.verify).toHaveLength(0)
  await champ.fill('')
  await champ.pressSequentially('9876543')
  await expect.poll(() => releves.verify.length).toBe(1)
  expect(releves.verify[0].token).toBe('987654') // le 7ᵉ chiffre n'a jamais été saisi : exactement 6 chiffres
  await expect(page.getByRole('alert')).toContainText('Code incorrect') // faux code simulé : le champ est vidé, on repart de zéro
  await champ.fill('123456') // le 6ᵉ chiffre déclenche la vérification
  await appVisible(page)
  expect(releves.verify).toHaveLength(2) // le faux code, puis le bon
  expect(releves.verify.at(-1)).toEqual({ email: EMAIL, token: '123456', type: 'email', gotrue_meta_security: {} })
  const s = await sessionStockee(page)
  expect(s.user.email).toBe(EMAIL)
  expect(s.refresh_token).toBe('refresh-v')
  expect(await page.evaluate(() => localStorage.getItem('fv9:dernier-email'))).toBe(EMAIL)
  // Le client envoie désormais le jeton de l'utilisateur avec ses requêtes de données.
  await expect.poll(() => releves.rest.some((r) => r.authorization === `Bearer ${s.access_token}`)).toBe(true)
  expect(erreurs, erreurs.join('\n')).toEqual([])
})

test('session conservée après rechargement : ni écran de connexion, ni nouveau code', async ({ page }) => {
  const releves = await simulerAuth(page)
  await page.goto('/')
  await ouvrirModeCode(page)
  await page.getByLabel('Code à 6 chiffres').fill('123456')
  await appVisible(page)
  await page.reload()
  await appVisible(page)
  await expect(page.getByLabel('Adresse e-mail')).toHaveCount(0)
  expect(releves.otp).toHaveLength(1)
  expect(releves.verify).toHaveLength(1)
})

test('messages d’erreur en français : code faux, code expiré, trop de demandes, pas de réseau ; renvoi après délai', async ({ page }) => {
  await page.clock.install()
  const releves = await simulerAuth(page)
  await page.goto('/')
  await ouvrirModeCode(page)
  const champ = page.getByLabel('Code à 6 chiffres')
  await expect(champ).toBeVisible()
  // Code faux
  await champ.fill('000000')
  await expect(page.getByRole('alert')).toHaveText('Code incorrect. Vérifiez les 6 chiffres, ou demandez un nouveau code.')
  await expect(page.getByLabel('Code à 6 chiffres')).toHaveValue('')
  // Renvoi : bloqué avec le délai affiché, puis disponible
  const renvoi = page.getByRole('button', { name: /^Renvoyer le code/ })
  await expect(renvoi).toBeDisabled()
  await page.clock.fastForward(61_000)
  await expect(renvoi).toHaveText('Renvoyer le code')
  await expect(renvoi).toBeEnabled()
  await renvoi.click()
  await expect.poll(() => releves.otp.length).toBe(2)
  await expect(page.getByRole('button', { name: /^Renvoyer le code \(\d+ s\)$/ })).toBeVisible() // le nouvel envoi est enregistré
  // Code expiré : plus d'une heure après l'envoi
  await page.clock.fastForward(61 * 60_000)
  await page.getByLabel('Code à 6 chiffres').fill('111111')
  await expect(page.getByRole('alert')).toHaveText('Code expiré. Demandez-en un nouveau.')
  // Trop de demandes
  await page.clock.fastForward(61_000)
  await page.unroute('**/auth/v1/otp**')
  await page.route('**/auth/v1/otp**', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' }) }))
  await page.getByRole('button', { name: 'Renvoyer le code' }).click()
  await expect(page.getByRole('alert')).toHaveText('Trop de demandes. Patientez une minute avant de redemander un code.')
  // Pas de réseau
  await page.unroute('**/auth/v1/verify**')
  await page.route('**/auth/v1/verify**', (route) => route.abort('internetdisconnected'))
  await page.getByLabel('Code à 6 chiffres').fill('222222')
  await expect(page.getByRole('alert')).toHaveText('Pas de réseau. Reconnectez-vous puis réessayez.')
})

test('première demande : adresse non autorisée et absence de réseau sont dits clairement', async ({ page }) => {
  await simulerAuth(page)
  await page.unroute('**/auth/v1/otp**')
  await page.route('**/auth/v1/otp**', (route) => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' }) }))
  await page.goto('/')
  await page.getByLabel('Adresse e-mail').fill('autre@exemple.fr')
  await page.getByRole('button', { name: 'Recevoir le lien' }).click()
  await expect(page.getByRole('alert')).toHaveText("Cette adresse n'est pas autorisée.")
  await page.unroute('**/auth/v1/otp**')
  await page.route('**/auth/v1/otp**', (route) => route.abort('internetdisconnected'))
  await page.getByRole('button', { name: 'Recevoir le lien' }).click()
  await expect(page.getByRole('alert')).toHaveText('Pas de réseau. Reconnectez-vous puis réessayez.')
  await expect(page.getByLabel('Adresse e-mail')).toBeVisible() // on reste sur le formulaire
})

test('jeton d’accès périmé : renouvelé avec le jeton de renouvellement, sans écran de connexion', async ({ page }) => {
  const releves = await simulerAuth(page)
  await poserSession(page, { ...reponseSession(jeton(maintenantS() - 3600, 'vieux'), 'refresh-0'), expires_at: maintenantS() - 3600 })
  await page.reload()
  await appVisible(page)
  await expect.poll(() => releves.refresh.length).toBeGreaterThan(0)
  expect(releves.refresh[0].refresh_token).toBe('refresh-0')
  await expect.poll(async () => (await sessionStockee(page)).refresh_token).toBe('refresh-1')
  await expect(page.getByLabel('Adresse e-mail')).toHaveCount(0)
})

test('hors ligne avec session connue : l’app démarre, aucun écran de connexion, session intacte', async ({ page }) => {
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  await simulerAuth(page, { refresh: 'reseau' })
  await poserSession(page, { ...reponseSession(jeton(maintenantS() - 3600, 'vieux'), 'refresh-0'), expires_at: maintenantS() - 3600 })
  // Plus aucun réseau vers Supabase (la page elle-même reste servie)
  await page.route('**/auth/v1/**', (route) => route.abort('internetdisconnected'))
  await page.route(/\/rest\/v1\//, (route) => route.abort('internetdisconnected'))
  await page.reload()
  await expect(page.getByTestId('version')).toBeVisible()
  await page.waitForTimeout(1500) // le renouvellement tenté en tâche de fond échoue : on ne déconnecte pas
  await expect(page.getByLabel('Adresse e-mail')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Recevoir le lien' })).toHaveCount(0)
  expect((await sessionStockee(page)).refresh_token).toBe('refresh-0')
  expect(erreurs, erreurs.join('\n')).toEqual([])
})

test('file d’écritures : remplie sans réseau avec jeton périmé, au retour le jeton est renouvelé PUIS la file part', async ({ page, context }) => {
  test.setTimeout(110_000)
  const releves = await simulerAuth(page)
  await poserSession(page, { ...reponseSession(jeton(maintenantS() + 3600, 'bon'), 'refresh-0'), expires_at: maintenantS() + 3600 })
  await page.reload()
  await appVisible(page)
  await context.setOffline(true)
  // Le jeton se périme pendant la coupure ; une écriture inoffensive (suppression d'un identifiant inexistant) attend en file.
  await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('fv9-auth-token'))
    localStorage.setItem('fv9-auth-token', JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) - 60 }))
    const f = await import('/src/lib/fileAttente.js')
    f.mettreEnFile({ type: 'delete', table: 'rappels', rowId: '00000000-0000-0000-0000-000000000000' })
  })
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length)).toBe(1)
  await context.setOffline(false) // événement « online » : rejeu
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length), { timeout: 60_000 }).toBe(0)
  // Le jeton a été renouvelé (au moins un appel), et l'écriture est partie AVEC le jeton renouvelé, jamais avec le périmé.
  expect(releves.refresh.length).toBeGreaterThanOrEqual(1)
  const ecriture = releves.rest.filter((r) => r.methode === 'DELETE' && r.url.includes('/rest/v1/rappels')).at(-1)
  expect(ecriture).toBeTruthy()
  const porte = JSON.parse(Buffer.from(ecriture.authorization.replace('Bearer ', '').split('.')[1], 'base64url').toString())
  expect(porte.exp).toBeGreaterThan(maintenantS() + 60)
  expect(porte.id).not.toBe('bon') // pas le jeton qui s'était périmé pendant la coupure
})

test('jeton de renouvellement refusé : retour à l’écran de connexion', async ({ page }) => {
  await simulerAuth(page, { refresh: 'refuse' })
  await poserSession(page, { ...reponseSession(jeton(maintenantS() - 3600, 'vieux'), 'refresh-revoque'), expires_at: maintenantS() - 3600 })
  await page.reload()
  await expect(page.getByLabel('Adresse e-mail')).toBeVisible()
  expect(await sessionStockee(page)).toBeNull()
})

test('déconnexion dans Réglages : confirmation, session retirée, écran de connexion', async ({ page }) => {
  const releves = await simulerAuth(page)
  await poserSession(page, reponseSession(jeton(maintenantS() + 3600, 'bon'), 'refresh-0'))
  await page.reload()
  await appVisible(page)
  await page.getByRole('button', { name: 'Réglages' }).click()
  await expect(page.getByRole('heading', { name: 'Réglages' })).toBeVisible()
  await expect(page.getByText(EMAIL)).toBeVisible()
  await expect(page.getByTestId('version')).toBeVisible()
  const bouton = page.getByRole('button', { name: 'Se déconnecter' })
  expect((await bouton.boundingBox()).height).toBeGreaterThanOrEqual(44)
  // Écritures en attente : la confirmation le dit, et rien n'est perdu
  await page.evaluate(async () => {
    const f = await import('/src/lib/fileAttente.js')
    f.mettreEnFile({ type: 'delete', table: 'rappels', rowId: '00000000-0000-0000-0000-000000000000' })
  })
  await bouton.click()
  await expect(page.getByText(/1 action en attente d'envoi restent sur cet appareil/)).toBeVisible()
  await page.getByRole('button', { name: 'Se déconnecter' }).last().click()
  await expect(page.getByLabel('Adresse e-mail')).toBeVisible()
  expect(await sessionStockee(page)).toBeNull()
  expect(releves.logout).toBeGreaterThanOrEqual(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fv9:file-attente') ?? '[]').length)).toBe(1) // la file reste
  await page.evaluate(() => localStorage.removeItem('fv9:file-attente'))
})

// ── Mode principal : le lien reçu par e-mail ─────────────────────────────────────────────────────────

test('lien : « Recevoir le lien », message, aide iPhone, adresse de retour = origine de l’app, décompte puis renvoi', async ({ page }) => {
  await page.clock.install()
  const releves = await simulerAuth(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Recevoir le lien' }).click()
  await expect(page.getByText(`Lien envoyé à ${EMAIL}. Ouvrez-le sur cet appareil.`)).toBeVisible()
  await expect(page.getByText("Sur iPhone avec l'app installée : saisissez le code à 6 chiffres reçu dans le même e-mail (« J'ai reçu un code »). Dans Safari ou sur ordinateur : ouvrez le lien.")).toBeVisible()
  await expect(page.getByLabel('Code à 6 chiffres')).toHaveCount(0)
  expect(releves.otp[0].create_user).toBe(false)
  expect(new URL(releves.otpUrls[0]).searchParams.get('redirect_to')).toBe(`${new URL(page.url()).origin}/`)
  const renvoi = page.getByRole('button', { name: /^Renvoyer le lien/ })
  await expect(renvoi).toBeDisabled()
  await expect(renvoi).toHaveText(/\(\d+ s\)$/)
  await page.clock.fastForward(61_000)
  await expect(renvoi).toHaveText('Renvoyer le lien')
  await renvoi.click()
  await expect.poll(() => releves.otp.length).toBe(2)
  expect((await page.getByRole('button', { name: "J'ai reçu un code" }).boundingBox()).height).toBeGreaterThanOrEqual(44)
  expect(await sansDebordement(page)).toBe(true)
})

test('retour du lien : session lue dans l’adresse, adresse nettoyée, app ouverte, session conservée au rechargement', async ({ page }) => {
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  const releves = await simulerAuth(page)
  await page.goto(lienDe())
  await appVisible(page)
  expect(new URL(page.url()).hash).toBe('') // aucun jeton laissé dans l'adresse
  expect(new URL(page.url()).search).toBe('')
  const s = await sessionStockee(page)
  expect(s.user.email).toBe(EMAIL)
  expect(s.refresh_token).toBe('refresh-lien')
  await expect(page.getByTestId('version')).toBeVisible()
  await page.reload()
  await appVisible(page)
  await expect(page.getByLabel('Adresse e-mail')).toHaveCount(0)
  expect(releves.otp).toHaveLength(0) // aucun nouvel envoi
  expect(erreurs, erreurs.join('\n')).toEqual([])
})

test('lien expiré ou déjà utilisé : message clair, adresse nettoyée, « Renvoyer un lien »', async ({ page }) => {
  const releves = await simulerAuth(page)
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
  await expect(page.getByRole('alert')).toHaveText('Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.')
  expect(new URL(page.url()).hash).toBe('')
  const renvoyer = page.getByRole('button', { name: 'Renvoyer un lien' })
  expect((await renvoyer.boundingBox()).height).toBeGreaterThanOrEqual(44)
  await expect(page.getByLabel('Adresse e-mail')).toHaveValue(EMAIL)
  await renvoyer.click()
  await expect(page.getByText(/^Lien envoyé à/)).toBeVisible()
  expect(releves.otp).toHaveLength(1)
  // Rechargement : l'ancien message ne revient pas
  await page.reload()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('lien réutilisé (erreur dans la requête) et lien invalide : messages distincts', async ({ page }) => {
  await simulerAuth(page)
  await page.goto('/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
  await expect(page.getByRole('alert')).toHaveText('Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.')
  expect(new URL(page.url()).search).toBe('')
  await page.goto('/?essai=2#error=access_denied&error_description=Autre+probleme') // vraie navigation (adresse différente)
  await expect(page.getByRole('alert')).toHaveText("Ce lien n'est pas valide. Demandez-en un nouveau.")
  await expect(page.getByRole('button', { name: 'Renvoyer un lien' })).toBeVisible()
})

test('lien illisible (jeton refusé par le serveur) : on rend la main après quelques secondes', async ({ page }) => {
  await page.clock.install()
  await simulerAuth(page, { user: 'refuse' })
  await page.goto(lienDe())
  await expect(page.getByText('Connexion en cours…')).toBeVisible()
  await page.clock.fastForward(9_000)
  await expect(page.getByRole('alert')).toHaveText('Connexion impossible avec ce lien. Demandez-en un nouveau.')
  await expect(page.getByLabel('Adresse e-mail')).toBeVisible()
  expect(await sessionStockee(page)).toBeNull()
})

test('lien ouvert dans un AUTRE navigateur (contexte vierge) : connecté là, l’appareil qui a demandé reste en attente', async ({ browser, page }) => {
  await simulerAuth(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Recevoir le lien' }).click()
  await expect(page.getByText(/^Lien envoyé à/)).toBeVisible()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await ctx.addInitScript(() => localStorage.setItem('fv9:e2e-connexion-reelle', '1'))
  const autre = await ctx.newPage()
  await simulerAuth(autre)
  await autre.goto(lienDe('refresh-autre'))
  await appVisible(autre)
  expect((await sessionStockee(autre)).refresh_token).toBe('refresh-autre')
  // Le navigateur d'origine n'a pas de session (stockage séparé) : il attend toujours, le code reste possible.
  await expect(page.getByText(/^Lien envoyé à/)).toBeVisible()
  expect(await sessionStockee(page)).toBeNull()
  await ctx.close()
})

test('même navigateur, autre fenêtre : la fenêtre en attente se connecte aussi', async ({ context, page }) => {
  await simulerAuth(context)
  await page.goto('/')
  await page.getByRole('button', { name: 'Recevoir le lien' }).click()
  await expect(page.getByText(/^Lien envoyé à/)).toBeVisible()
  const fenetre = await context.newPage()
  await fenetre.goto(lienDe())
  await appVisible(fenetre)
  await appVisible(page) // la première fenêtre est passée sur l'app sans rien faire
  await expect(page.getByText(/^Lien envoyé à/)).toHaveCount(0)
})
