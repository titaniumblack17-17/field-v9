import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

// Identité du build : commit court et heure, injectés dans l'app (pied de page « Version … ») ET publiés dans
// version.json à chaque déploiement, pour que l'app puisse savoir si une version plus récente existe en ligne.
// Vercel fournit le SHA du commit déployé ; en repli (build local), le HEAD git ; à défaut « local ».
const commitComplet = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'local'
  }
})()
const commit = commitComplet.slice(0, 7)
const heureBuild = new Date().toISOString()

export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_TIME__: JSON.stringify(heureBuild),
  },
  plugins: [
    {
      name: 'version-json',
      // Même commit et même heure que ceux injectés dans le bundle : l'app se compare à elle-même.
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ commit, commitComplet, builtAt: heureBuild }),
        })
      },
    },
  ],
})
