// Tests de parcours (devDependency uniquement : rien de ceci n'entre dans le
// build de production). Viewport iPhone 390 x 844, base Supabase réelle : les
// tests n'écrivent que sur un client « ZZTEST-E2E » créé puis supprimé par eux.
import { defineConfig } from '@playwright/test'
import 'dotenv/config'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
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
  },
})
