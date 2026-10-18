// Rapporteur de fin de passe : total des requêtes Supabase (navigateur + aides de test), octets, top 5 des chemins, et alerte
// ROUGE au-dessus du seuil (5 000 en mode léger E2E_LEGER=1, 7 000 en passe complète, par taille d'écran : une passe = une
// largeur, LARGEUR=390 ou 1280). Ne fait jamais échouer la passe : il avertit.
import fs from 'node:fs'
import { FICHIER_COMPTEUR } from './compteur.js'

const SEUILS = { leger: 5000, complet: 7000 }

export default class RapporteurRequetes {
  onBegin() {
    try {
      fs.mkdirSync('test-results', { recursive: true })
      fs.writeFileSync(FICHIER_COMPTEUR, '')
    } catch {
      // sans dossier de résultats : pas de compteur
    }
  }

  onEnd() {
    let lignes = []
    try {
      lignes = fs.readFileSync(FICHIER_COMPTEUR, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    } catch {
      return
    }
    const parChemin = new Map()
    const parScenario = new Map()
    for (const { titre, stats } of lignes) {
      let sous = 0
      for (const [cle, { n, octets }] of Object.entries(stats)) {
        const e = parChemin.get(cle) ?? { n: 0, octets: 0 }
        e.n += n
        e.octets += octets
        parChemin.set(cle, e)
        sous += n
      }
      parScenario.set(titre, (parScenario.get(titre) ?? 0) + sous)
    }
    const total = [...parChemin.values()].reduce((t, e) => t + e.n, 0)
    const octets = [...parChemin.values()].reduce((t, e) => t + e.octets, 0)
    const mode = process.env.E2E_LEGER === '1' ? 'leger' : 'complet'
    const largeur = process.env.LARGEUR ?? '390'
    const top = [...parChemin].sort((a, b) => b[1].n - a[1].n).slice(0, 5)
    const sortie = [
      '',
      `Requêtes Supabase de la passe (${mode === 'leger' ? 'LÉGÈRE' : 'complète'}, ${largeur} px) : ${total} · ${(octets / 1e6).toFixed(1)} Mo reçus`,
      '  top 5 : ' + top.map(([k, e]) => `${k} ${e.n} (${(e.octets / 1e6).toFixed(1)} Mo)`).join(' · '),
      '  (navigateur + aides de test ; hors pré-vérifications CORS — mesure serveur : proxy de journalisation)',
    ]
    const seuil = SEUILS[mode]
    if (total > seuil) {
      sortie.push(`\x1b[1;31m⚠ ALERTE : ${total} requêtes > seuil de ${seuil} (${mode === 'leger' ? 'mode léger' : 'passe complète'}, ${largeur} px). Alléger avant de relancer.\x1b[0m`)
      const lourds = [...parScenario].sort((a, b) => b[1] - a[1]).slice(0, 3)
      sortie.push('  scénarios les plus lourds : ' + lourds.map(([t, n]) => `${n} ${t.slice(0, 50)}`).join(' | '))
    }
    console.log(sortie.join('\n'))
  }
}
