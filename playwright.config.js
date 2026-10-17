// Tests de parcours (devDependency uniquement : rien de ceci n'entre dans le
// build de production). Viewport iPhone 390 x 844, base Supabase réelle : les
// tests n'écrivent que sur un client « ZZTEST-E2E » créé puis supprimé par eux.
import { defineConfig } from '@playwright/test'
import 'dotenv/config'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Plafond des attentes sur un état (jamais un délai fixe) : l'écran d'ouverture attend d'abord la réconciliation
  // Todoist, qui prend parfois plusieurs secondes.
  expect: { timeout: 15_000 },
  workers: 1,
  globalSetup: './e2e/verrou-global.js',
  reporter: [['list']],
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
    // Serveur de développement des tests : la porte de connexion est ouverte (voir src/lib/session.js). Jamais en production.
    env: { VITE_E2E_SANS_CONNEXION: '1' },
  },
})
