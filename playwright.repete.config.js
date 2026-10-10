// Suite répétée (stabilité) : port et largeur au choix, serveur de dev dédié pour ne jamais
// partager celui d'une autre session. PORT=5199 LARGEUR=1280 npx playwright test -c playwright.repete.config.js
import base from './playwright.config.js'

const port = Number(process.env.PORT ?? 5199)
const large = Number(process.env.LARGEUR ?? 390)
export default {
  ...base,
  use: {
    ...base.use,
    baseURL: `http://localhost:${port}`,
    viewport: { width: large, height: large >= 768 ? 800 : 844 },
    isMobile: large < 768,
    hasTouch: large < 768,
  },
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true },
}
