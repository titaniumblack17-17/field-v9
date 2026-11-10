// Tests de parcours (devDependency uniquement : rien de ceci n'entre dans le
// build de production). Viewport iPhone 390 x 844, base Supabase réelle : les
// tests n'écrivent que sur un client « ZZTEST-E2E » créé puis supprimé par eux.
import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true }) // clé de service (temps B), jamais commitée — voir e2e/cle.js
dotenv.config({ quiet: true })

// Serveur de développement des tests. La porte de connexion est ouverte (voir src/lib/session.js) : jamais en production.
// Une fois RLS activé, l'application « sans connexion » n'a plus de session : E2E_APP_CLE_SERVICE=1 lui injecte la clé de
// service (opt-in, serveur de test local uniquement — la clé n'est jamais écrite dans un fichier ni publiée). Pour valider les
// politiques elles-mêmes, utiliser plutôt une vraie session (voir docs/securite-temps-b/PLAN.md).
export function envServeurTest() {
  const env = { VITE_E2E_SANS_CONNEXION: '1' }
  if (process.env.E2E_APP_CLE_SERVICE === '1') {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('E2E_APP_CLE_SERVICE=1 demande SUPABASE_SERVICE_ROLE_KEY (.env.local).')
    env.VITE_SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  }
  return env
}

const RE_LEGER = /(connexion|decisions|financement|financement-champs|rejeu-hors-ligne|historique|devis-ecarte|version|ajout-pdf-whatsapp|ajout-document-local|cors)\.spec\.js|@leger/

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Plafond des attentes sur un état (jamais un délai fixe) : l'écran d'ouverture attend d'abord la réconciliation
  // Todoist, qui prend parfois plusieurs secondes.
  expect: { timeout: 15_000 },
  workers: 1,
  globalSetup: './e2e/verrou-global.js',
  // Rapporteur de requêtes Supabase en fin de passe (voir e2e/reporter-requetes.js).
  reporter: [['list'], ['./e2e/reporter-requetes.js'], ...(process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ? [['json']] : [])],
  // Mode léger (E2E_LEGER=1) : seulement les scénarios critiques — fichiers entiers ci-dessous + scénarios étiquetés @leger.
  // La suite complète reste celle de la mise en production.
  grep: process.env.E2E_LEGER === '1' ? RE_LEGER : undefined,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    env: envServeurTest(),
  },
})
