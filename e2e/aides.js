import { expect } from '@playwright/test'

// Attentes sur un ÉTAT, jamais sur un délai fixe.

/** Deux images affichées : le rendu déclenché par l'action précédente est terminé. */
export const rendu = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

/**
 * Rubrique « Documents déposés » d'une fiche, jalons visibles. La rubrique s'ouvre seule dès qu'un
 * devis est à trancher, dans le rendu qui affiche le compte : on attend ce compte (liste chargée),
 * puis l'état ouvert ; l'ouvrir à la main n'est qu'un repli quand elle ne s'ouvre pas seule.
 */
export async function ouvrirDocuments(page) {
  const entete = page.getByText(/^Documents déposés/)
  await entete.waitFor()
  await expect(entete).toHaveText(/Documents déposés · \d+/)
  const jalons = page.getByLabel('Jalons du dossier')
  const ouvert = await expect.poll(() => jalons.isVisible(), { timeout: 4000 }).toBe(true).then(() => true, () => false)
  if (!ouvert) await entete.click()
  await expect(jalons).toBeVisible()
}

/**
 * Affiche le Dashboard depuis l'écran d'ouverture. Accueil unique : il est déjà là, zone « Pilotage ».
 * Board seul : on passe par la pastille « Dashboard ». Même test, les deux états de l'application.
 */
export async function versDashboard(page, delai = 15_000) {
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible({ timeout: delai })
  const pilotage = page.getByRole('heading', { name: 'Pilotage' })
  const pastille = page.getByRole('button', { name: 'Dashboard', exact: true })
  const titre = page.getByRole('heading', { name: 'Dashboard' })
  await expect.poll(async () => (await pilotage.count()) + (await pastille.count()), { timeout: 15_000 }).toBeGreaterThan(0)
  if (await pastille.count()) await pastille.click()
  await expect(pilotage.or(titre)).toBeVisible({ timeout: delai })
}

/** Retour à l'écran d'ouverture (Board : « ← Brief » ; accueil unique : rien à faire, le Dashboard en fait partie). */
export async function versAccueil(page) {
  const retour = page.getByRole('button', { name: /← (Brief|Accueil)/ })
  if (await retour.count()) await retour.click()
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
}

/**
 * Touche « Annuler » de la décision en cours. Le bandeau d'annulation ne passe à la nouvelle décision qu'une
 * fois son écriture terminée côté application : la base peut déjà la montrer alors que le bandeau porte encore
 * la décision précédente. On attend donc que le bandeau nomme la bonne décision avant de l'annuler.
 */
export async function annuler(page, motif) {
  const bandeau = page.getByRole('status')
  await expect(bandeau).toContainText(motif)
  await bandeau.getByRole('button', { name: 'Annuler' }).click()
}

/**
 * Attend `min` échos temps réel. Si Supabase Realtime n'en renvoie aucun dans le délai (panne du service, pas de
 * l'application : constaté trois fois d'affilée sur un passage), le scénario, qui en dépend, est SAUTÉ avec
 * cette raison — jamais compté comme réussi ni comme défaillance de l'application.
 */
export async function attendreEchos(test, compter, min, delai = 30_000) {
  const ok = await expect.poll(compter, { timeout: delai }).toBeGreaterThanOrEqual(min).then(() => true, () => false)
  test.skip(!ok, 'Supabase Realtime n\'a renvoyé aucun écho dans le délai (service indisponible)')
}
