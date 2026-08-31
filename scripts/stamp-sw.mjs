// Substitue __BUILD_VERSION__ dans dist/sw.js par un identifiant qui change
// à chaque déploiement — condition nécessaire pour que le navigateur détecte
// une mise à jour du service worker (voir le commentaire dans public/sw.js).
// Exécuté après `vite build`, jamais en dev (le service worker n'y est pas
// enregistré, voir main.jsx).
import { readFileSync, writeFileSync } from 'node:fs'

// Vercel fournit automatiquement le SHA du commit déployé — le choix le
// plus lisible pour un identifiant de version. En repli (build local hors
// Vercel), un horodatage suffit : il change à chaque exécution.
const version = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())

const chemin = 'dist/sw.js'
const contenu = readFileSync(chemin, 'utf8')
const remplace = contenu.replaceAll('__BUILD_VERSION__', version)

if (remplace === contenu) {
  console.error('stamp-sw: __BUILD_VERSION__ introuvable dans dist/sw.js — rien remplacé.')
  process.exit(1)
}

writeFileSync(chemin, remplace)
console.log(`stamp-sw: service worker versionné (${version.slice(0, 12)}).`)
