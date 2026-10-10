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
const pl = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`
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
  const fichiers = await lire('fichiers?select=id,dossier_id,type_doc,montant_ttc,variantes,a_trancher_raison,decision&dossier_id=not.is.null')
  const annee = Number(new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }).slice(0, 4))
  const projets = dossiers.filter((d) => d.type === 'projet')
  const actifs = projets.filter((d) => !['perdu', 'termine'].includes(d.statut))
  const familles = FAMILLES.map((f) => {
    const l = actifs.filter((d) => f.etapes.includes(d.statut))
    return { cle: f.cle, nb: l.length, montant: l.reduce((t, d) => t + (Number(d.montant_estime) || 0), 0), sans: l.filter((d) => d.montant_estime == null).length }
  })
  const devisF = fichiers.filter((f) => f.type_doc === 'devis')
  // Offres à plat, recalculées ici à partir des lignes brutes (indépendamment de l'application)
  const offres = devisF.flatMap((f) => {
    const v = Array.isArray(f.variantes) ? f.variantes : []
    if (v.length >= 1) {
      return v.map((o) => ({ fichier: f.id, dossier: f.dossier_id, etat: ['retenue', 'a_trancher', 'ecartee', 'reportee'].includes(o.etat) ? o.etat : 'a_trancher', montant: Number(o.montant_ttc) }))
    }
    if (f.montant_ttc == null) return []
    return [{ fichier: f.id, dossier: f.dossier_id, etat: { retenu: 'retenue', a_trancher: 'a_trancher', mis_de_cote: 'reportee' }[f.decision] ?? 'ecartee', montant: Number(f.montant_ttc) }]
  })
  const parDossier = (l) => l.reduce((m, o) => m.set(o.dossier, [...(m.get(o.dossier) ?? []), o]), new Map())
  // Dossiers reportés : (devis mis de côté, aucun devis retenu) ou (offre reportée, aucune offre retenue)
  const reportes = new Set()
  for (const [id, l] of parDossier(devisF.map((f) => ({ dossier: f.dossier_id, decision: f.decision })))) {
    if (l.some((x) => x.decision === 'mis_de_cote') && !l.some((x) => x.decision === 'retenu')) reportes.add(id)
  }
  for (const [id, l] of parDossier(offres)) if (l.some((o) => o.etat === 'reportee') && !l.some((o) => o.etat === 'retenue')) reportes.add(id)
  const signes = projets.filter((d) => !reportes.has(d.id) && d.statut !== 'perdu' && ETAPES_SIGNEES.includes(d.statut) && exerciceDe(d, annee) === annee)
  // Potentiel ouvert : à trancher = offres à trancher (plancher = offre la plus basse par devis) ; reportées = somme
  const ouvertes = offres.filter((o) => o.etat === 'a_trancher')
  const parFichier = [...ouvertes.reduce((m, o) => m.set(o.fichier, [...(m.get(o.fichier) ?? []), o]), new Map()).values()]
  const rep = offres.filter((o) => o.etat === 'reportee')
  const potentiel = {
    a_trancher: {
      offres: ouvertes.length,
      devis: parFichier.length,
      dossiers: new Set(ouvertes.map((o) => o.dossier)).size,
      montant_min: parFichier.reduce((t, l) => t + Math.min(...l.map((o) => o.montant)), 0),
    },
    reportees: {
      offres: rep.length,
      devis: new Set(rep.map((o) => o.fichier)).size,
      dossiers: new Set(rep.map((o) => o.dossier)).size,
      montant: rep.reduce((t, o) => t + o.montant, 0),
    },
  }
  // Clés historiques (par devis) conservées pour le site déjà en production
  const devisLegacy = fichiers.filter((f) => f.type_doc === 'devis' && f.decision === 'a_trancher' && !reportes.has(f.dossier_id) &&
    (f.montant_ttc != null || (f.variantes ?? []).length >= 2 || f.a_trancher_raison))
  return {
    potentiel,
    legacy: { devis: devisLegacy.length, dossiers: new Set(devisLegacy.map((f) => f.dossier_id)).size },
    annee, actifs: actifs.length, familles, signes,
    signeMontant: signes.reduce((t, d) => t + (Number(d.montant_estime) || 0), 0),
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
      expect(c.en_attente.dossiers).toBe(r.attente)
      // Potentiel ouvert par offre : à trancher (offres · devis · dossiers · plancher) et reportées
      expect({ ...c.potentiel.a_trancher, montant_min: Number(c.potentiel.a_trancher.montant_min) }).toEqual(r.potentiel.a_trancher)
      expect({ ...c.potentiel.reportees, montant: Number(c.potentiel.reportees.montant) }).toEqual(r.potentiel.reportees)
      // Clés historiques (par devis) inchangées
      expect([c.a_trancher.devis, c.a_trancher.dossiers]).toEqual([r.legacy.devis, r.legacy.dossiers])
      // Aucune donnée nominative dans la RPC
      expect(JSON.stringify(c)).not.toMatch(/nom_praticien|prenom|@|titre/)

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
      await expect(page.getByText(`${pl(r.potentiel.a_trancher.offres, 'offre')} · ${r.potentiel.a_trancher.devis} devis · ${pl(r.potentiel.a_trancher.dossiers, 'dossier')}`).first()).toBeVisible()
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
        await page.locator('svg[role=img]').nth(1).scrollIntoViewIfNeeded()
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
        { ouvrir: () => page.getByRole('button', { name: /^À trancher/ }).first().click(), titre: new RegExp(`À trancher · ${pl(c.potentiel.a_trancher.offres, 'offre')} · ${c.potentiel.a_trancher.devis} devis · ${pl(c.potentiel.a_trancher.dossiers, 'dossier')}`), lignes: c.potentiel.a_trancher.offres },
        { ouvrir: () => page.getByRole('button', { name: /^Incomplets/ }).click(), titre: new RegExp(`Incomplets · ${c.incomplets.dossiers} dossiers`), lignes: c.incomplets.dossiers },
        { ouvrir: () => page.getByRole('button', { name: /^En attente/ }).click(), titre: new RegExp(`En attente · ${c.en_attente.dossiers}`), lignes: c.en_attente.dossiers },
        { ouvrir: () => page.getByRole('button', { name: /^En retard/ }).click(), titre: new RegExp(`En retard · ${c.en_retard.total}`), lignes: c.en_retard.total },
        { ouvrir: () => page.getByLabel('Objectif', { exact: true }).locator('button', { hasText: /^Signé/ }).click(), titre: new RegExp(`Signé · ${r.signes.length} dossiers`), lignes: r.signes.length },
        { ouvrir: () => page.locator('[data-segment="signe"]').dispatchEvent('click'), titre: new RegExp(`Signé · ${r.signes.length} dossiers`), lignes: r.signes.length },
        { ouvrir: () => page.locator('[data-segment="a-trancher"]').dispatchEvent('click'), titre: /À trancher · /, lignes: c.potentiel.a_trancher.offres },
        ...(c.potentiel.reportees.offres > 0 ? [{ ouvrir: () => page.locator('[data-segment="reporte"]').dispatchEvent('click'), titre: /Reportées · /, lignes: c.potentiel.reportees.offres }] : []),
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

test('Objectif : le Board et le Dashboard affichent le même pourcentage et le même montant signé', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Dossiers actifs').first()).toBeVisible()
  const tuile = await page.getByText(/^Objectif \d{4}$/).first().locator('xpath=ancestor::button[1]').innerText()
  const [pourcentage, montant] = [tuile.match(/(\d+) %/)[1], nombre(tuile.split('\n').pop())]
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  const obj = page.getByLabel('Objectif', { exact: true })
  await expect(obj).toContainText(`${pourcentage} %`)
  const signe = await obj.locator('button', { hasText: /^Signé/ }).innerText()
  expect(nombre(signe.split('\n').filter((l) => /€/.test(l)).pop())).toBe(montant)
  // …et tous deux égalent le calcul indépendant de la base
  const r = await recalcul()
  expect(montant).toBe(r.signeMontant)
  expect(Number(pourcentage)).toBe(Math.round((r.signeMontant / 5_000_000) * 100))
})
