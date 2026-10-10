import { test, expect } from '@playwright/test'
import { FAMILLES } from '../src/constants/dashboard.js'
import { ETAPES_PROJET_LABELS, ETAPES_SIGNEES, estEnAttente, exerciceDe } from '../src/constants/dossiers.js'
import { aTrancher } from '../src/lib/documents.js'

// Lecture seule : le Dashboard n'écrit rien ; les chiffres affichés sont comparés
// à un recalcul indépendant fait ici depuis les lignes brutes de la base.
const URL_DB = process.env.VITE_SUPABASE_URL
const CLE = process.env.VITE_SUPABASE_ANON_KEY
const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}`, 'content-type': 'application/json' }
const lire = async (chemin) => (await fetch(`${URL_DB}/rest/v1/${chemin}`, { headers: entetes })).json()
const rpc = async () => (await fetch(`${URL_DB}/rest/v1/rpc/dashboard_chiffres`, { method: 'POST', headers: entetes, body: '{}' })).json()
const nombre = (t) => Number(String(t).replace(/[^\d]/g, ''))

const surveiller = (page) => {
  const p = []
  page.on('console', (m) => m.type() === 'error' && p.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => p.push(`pageerror: ${e.message}`))
  page.on('response', (r) => r.status() >= 400 && p.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`))
  return p
}
const pasDeDebordement = async (page) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw).toBeLessThanOrEqual(cw)
}
const ouvrirDashboard = async (page) => {
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByLabel('Pipeline', { exact: true }).first()).toBeVisible()
}
const dashboardVisible = (page) => expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

// Recalcul indépendant depuis la base
const recalcul = async () => {
  const dossiers = await lire('dossiers?select=id,type,statut,montant_estime,closed_at,date_installation,bloque_par')
  const fichiers = await lire('fichiers?select=id,dossier_id,type_doc,montant_ttc,variantes,a_trancher_raison&dossier_id=not.is.null')
  const annee = Number(new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }).slice(0, 4))
  const projets = dossiers.filter((d) => d.type === 'projet')
  const actifs = projets.filter((d) => !['perdu', 'termine'].includes(d.statut))
  const familles = FAMILLES.map((f) => {
    const l = actifs.filter((d) => f.etapes.includes(d.statut))
    return { cle: f.cle, nb: l.length, montant: l.reduce((t, d) => t + (Number(d.montant_estime) || 0), 0), sans: l.filter((d) => d.montant_estime == null).length }
  })
  const signes = projets.filter((d) => d.statut !== 'perdu' && ETAPES_SIGNEES.includes(d.statut) && exerciceDe(d, annee) === annee)
  const devis = fichiers.filter((f) => f.type_doc === 'devis' && f.montant_ttc == null && aTrancher(f))
  return {
    annee, actifs: actifs.length, familles, signes,
    signeMontant: signes.reduce((t, d) => t + (Number(d.montant_estime) || 0), 0),
    devis: devis.length, dossiersATrancher: new Set(devis.map((f) => f.dossier_id)).size,
    attente: dossiers.filter(estEnAttente).length,
  }
}

for (const [nom, largeur, hauteur] of [['iPhone 390', 390, 844], ['ordinateur 1280', 1280, 800]]) {
  test.describe(nom, () => {
    test.use({ viewport: { width: largeur, height: hauteur } })

    test('chiffres affichés = base, aucun débordement, aucune erreur', async ({ page }) => {
      const problemes = surveiller(page)
      const [c, r] = [await rpc(), await recalcul()]
      // La RPC égale le recalcul indépendant
      expect(c.projets_actifs).toBe(r.actifs)
      for (const f of r.familles) {
        const x = c.familles.find((y) => y.cle === f.cle)
        expect([x.nb, Number(x.montant), x.sans_montant]).toEqual([f.nb, f.montant, f.sans])
      // « à chiffrer » : seulement à partir de Devis envoyé (jamais sur un prospect)
      expect(x.a_chiffrer).toBeLessThanOrEqual(x.sans_montant)
        if (f.cle === 'qualification') expect(x.a_chiffrer).toBe(0)
      }
      expect([c.signe.nb, Number(c.signe.montant)]).toEqual([r.signes.length, r.signeMontant])
      expect([c.a_trancher.devis, c.a_trancher.dossiers]).toEqual([r.devis, r.dossiersATrancher])
      expect(c.en_attente.dossiers).toBe(r.attente)

      await ouvrirDashboard(page)
      // L'écran affiche ces mêmes chiffres
      const pipeline = page.getByLabel('Pipeline', { exact: true }).first()
      await expect(pipeline).toContainText(`${r.actifs}`)
      for (const f of FAMILLES) {
        const nb = r.familles.find((x) => x.cle === f.cle).nb
        await expect(pipeline.locator('button', { hasText: new RegExp(`^${f.libelle}`) }).first()).toContainText(String(nb))
      }
      const objectif = page.getByLabel('Objectif', { exact: true })
      await expect(objectif).toContainText(`${Math.round((r.signeMontant / 5_000_000) * 100)} %`)
      await expect(objectif).toContainText(`${r.signes.length} dossiers`)
      await expect(page.getByText(`${r.devis} devis · ${r.dossiersATrancher} dossier`).first()).toBeVisible()
      await expect(page.getByRole('button', { name: /^En attente\s*\d+/ })).toContainText(String(r.attente))
      // Jamais 0 € pour un montant vide
      expect(await page.locator('main').innerText()).not.toMatch(/(^|\s)0 €/)
      await pasDeDebordement(page)
      expect(problemes).toEqual([])
    })

    test('chaque segment et chaque ligne du pipeline mènent à la famille filtrée', async ({ page }) => {
      const problemes = surveiller(page)
      const c = await rpc()
      await ouvrirDashboard(page)
      for (const f of FAMILLES) {
        const nb = c.familles.find((x) => x.cle === f.cle).nb
        // 1) ligne de légende
        await page.getByLabel('Pipeline', { exact: true }).first().locator('button', { hasText: new RegExp(`^${f.libelle}`) }).first().click()
        await expect(page.getByText(`Famille : ${f.libelle}`)).toBeVisible()
        const attendues = (await lire(`dossiers?type=eq.projet&statut=in.(${f.etapes.join(',')})&select=id`)).length
        expect(attendues).toBe(nb)
        // seules les étapes de la famille ont une pastille dans la barre du Pipeline
        const toutes = Object.values(ETAPES_PROJET_LABELS)
        const autorisees = f.etapes.map((e) => ETAPES_PROJET_LABELS[e])
        const pastilles = (await page.locator('button.rounded-full.shadow-sm').allInnerTexts())
          .map((t) => t.split('\n')[0].trim())
          .filter((t) => toutes.includes(t))
        for (const t of pastilles) expect(autorisees).toContain(t)
        await pasDeDebordement(page)
        await page.goBack()
        await dashboardVisible(page)

        // 2) segment de l'anneau : un vrai clic sur l'arc
        const cercle = page.locator(`[data-segment="${f.cle}"]`)
        const boite = await page.locator('svg[role=img]').nth(1).boundingBox()
        const total = c.familles.reduce((t, x) => t + x.nb, 0)
        const avant = c.familles.slice(0, c.familles.findIndex((x) => x.cle === f.cle)).reduce((t, x) => t + x.nb, 0)
        if (nb > 0) {
          const angle = ((avant + nb / 2) / total) * 2 * Math.PI - Math.PI / 2
          const cx = boite.x + boite.width / 2
          const cy = boite.y + boite.height / 2
          await page.mouse.click(cx + 50 * Math.cos(angle), cy + 50 * Math.sin(angle))
          await expect(page.getByText(`Famille : ${f.libelle}`)).toBeVisible()
          await page.goBack()
          await dashboardVisible(page)
        } else {
          await expect(cercle).toHaveCount(0)
        }
      }
      expect(problemes).toEqual([])
    })

    test('tuiles, segments Objectif et légendes : listes filtrées, fiche du dossier, retour', async ({ page }) => {
      const problemes = surveiller(page)
      const [c, r] = [await rpc(), await recalcul()]
      await ouvrirDashboard(page)

      const cas = [
        { ouvrir: () => page.getByRole('button', { name: /^À trancher/ }).first().click(), titre: new RegExp(`À trancher · ${c.a_trancher.devis} devis · ${c.a_trancher.dossiers} dossier`), lignes: c.a_trancher.dossiers },
        { ouvrir: () => page.getByRole('button', { name: /^Incomplets/ }).click(), titre: new RegExp(`Incomplets · ${c.incomplets.dossiers} dossiers`), lignes: c.incomplets.dossiers },
        { ouvrir: () => page.getByRole('button', { name: /^En attente/ }).click(), titre: new RegExp(`En attente · ${c.en_attente.dossiers}`), lignes: c.en_attente.dossiers },
        { ouvrir: () => page.getByRole('button', { name: /^En retard/ }).click(), titre: new RegExp(`En retard · ${c.en_retard.total}`), lignes: c.en_retard.total },
        { ouvrir: () => page.getByLabel('Objectif', { exact: true }).locator('button', { hasText: /^Signé/ }).click(), titre: new RegExp(`Signé · ${r.signes.length} dossiers`), lignes: r.signes.length },
        { ouvrir: () => page.locator('[data-segment="signe"]').dispatchEvent('click'), titre: new RegExp(`Signé · ${r.signes.length} dossiers`), lignes: r.signes.length },
        { ouvrir: () => page.locator('[data-segment="a-trancher"]').dispatchEvent('click'), titre: /À trancher · /, lignes: c.a_trancher.dossiers },
      ]
      for (const cible of cas) {
        await cible.ouvrir()
        const feuille = page.getByRole('dialog')
        await expect(feuille.getByRole('heading', { name: cible.titre })).toBeVisible()
        await expect(feuille.locator('ul > li')).toHaveCount(cible.lignes) // la liste égale le chiffre
        const petits = await feuille.evaluate((el) => [...el.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height).filter((h) => h > 0 && h < 43.5))
        expect(petits).toEqual([])
        await pasDeDebordement(page)
        await page.keyboard.press('Escape')
        await expect(feuille).toBeHidden()
      }

      // Une ligne ouvre la fiche du dossier ; le retour ramène au Dashboard
      await page.getByRole('button', { name: /^En attente/ }).click()
      await page.getByRole('dialog').locator('ul > li button').first().click()
      await expect(page.getByRole('button', { name: /Retour/ })).toBeVisible()
      await page.goBack()
      await dashboardVisible(page)
      expect(problemes).toEqual([])
    })

    test('« En retard » égale « Aussi à traiter » du Board ; évolution honnête', async ({ page }) => {
      const c = await rpc()
      await page.goto('/')
      const ligne = await page.getByText(/actions? à traiter aujourd'hui/).innerText()
      const T = Number(ligne.match(/(\d+) actions?/)[1])
      expect(c.en_retard.total).toBe(T)
      await ouvrirDashboard(page)
      await expect(page.getByRole('button', { name: /^En retard/ })).toContainText(String(T))
      const n = c.serie.length
      if (n < 7) await expect(page.getByText(`Courbe en construction · ${n} jour${n > 1 ? 's' : ''} de données`)).toBeVisible()
      else await expect(page.getByRole('img', { name: /Évolution/ })).toBeVisible()
      // Retour au Board
      await page.getByRole('button', { name: /Brief/ }).click()
      await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
    })

    test('hors-ligne : dernières valeurs connues signalées', async ({ page }) => {
      await ouvrirDashboard(page) // remplit le cache
      await page.route(/supabase\.co/, (route) => route.abort())
      await page.reload()
      await page.getByRole('button', { name: 'Dashboard', exact: true }).click().catch(() => {})
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/Dernières valeurs connues/)).toBeVisible()
      await expect(page.getByLabel('Pipeline', { exact: true }).first()).toContainText('projets actifs')
      await pasDeDebordement(page)
    })
  })
}

test('temps réel : un dossier créé, déplacé puis supprimé met le Dashboard à jour', async ({ page }) => {
  await ouvrirDashboard(page)
  const pipeline = page.getByLabel('Pipeline', { exact: true }).first()
  const nbFamille = async (libelle) =>
    nombre((await pipeline.locator('button', { hasText: new RegExp(`^${libelle}`) }).first().innerText()).split('\n').map((l) => l.trim()).filter((l) => l && l !== '›').pop())
  const q0 = await nbFamille('Qualification')
  const d0 = await nbFamille('Devis')
  const [client] = await (await fetch(`${URL_DB}/rest/v1/clients`, { method: 'POST', headers: { ...entetes, Prefer: 'return=representation' }, body: JSON.stringify({ nom_praticien: 'ZZTEST-DASH' }) })).json()
  let dossier
  try {
    ;[dossier] = await (await fetch(`${URL_DB}/rest/v1/dossiers`, { method: 'POST', headers: { ...entetes, Prefer: 'return=representation' }, body: JSON.stringify({ client_id: client.id, type: 'projet', statut: 'prospect', titre: 'ZZTEST-DASH dossier' }) })).json()
    await expect.poll(() => nbFamille('Qualification'), { timeout: 15_000 }).toBe(q0 + 1) // INSERT
    await fetch(`${URL_DB}/rest/v1/dossiers?id=eq.${dossier.id}`, { method: 'PATCH', headers: entetes, body: JSON.stringify({ statut: 'devis_a_faire' }) })
    await expect.poll(() => nbFamille('Devis'), { timeout: 15_000 }).toBe(d0 + 1) // UPDATE
    await expect.poll(() => nbFamille('Qualification'), { timeout: 15_000 }).toBe(q0)
    await fetch(`${URL_DB}/rest/v1/dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST-DASH dossier`, { method: 'DELETE', headers: entetes })
    dossier = null
    await expect.poll(() => nbFamille('Devis'), { timeout: 15_000 }).toBe(d0) // DELETE
  } finally {
    if (dossier) await fetch(`${URL_DB}/rest/v1/dossiers?id=eq.${dossier.id}&titre=eq.ZZTEST-DASH dossier`, { method: 'DELETE', headers: entetes })
    await fetch(`${URL_DB}/rest/v1/clients?id=eq.${client.id}&nom_praticien=eq.ZZTEST-DASH`, { method: 'DELETE', headers: entetes })
  }
})
