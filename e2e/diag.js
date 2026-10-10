// Journal de diagnostic (DIAG=1) : ordre des écritures Supabase émises par l'application,
// des réponses, des événements temps réel reçus, et de toutes les lectures/écritures du
// test lui-même. Inerte sans DIAG=1. Un fichier par test et par passage (DIAG_RUN).
import { appendFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

const actif = process.env.DIAG === '1'
const dossier = process.env.DIAG_DIR ?? '/tmp/diag'
let fichier = null

export const noter = (message) => {
  if (!actif || !fichier) return
  appendFileSync(fichier, `${new Date().toISOString().slice(11, 23)} ${message}\n`)
}

// Autres suites Playwright vivantes sur la machine (hors celle-ci) : preuve d'une écriture concurrente.
export const autresSuites = () => {
  try {
    const moi = process.ppid // le processus coordinateur de CETTE suite
    const lignes = execSync("ps -eo pid,ppid,command | grep -E 'playwright' | grep -v grep || true", { encoding: 'utf8' }).split('\n')
    const propres = new Set([moi])
    const parent = lignes.map((l) => l.trim().split(/\s+/)).find((c) => Number(c[0]) === moi)
    if (parent) propres.add(Number(parent[1]))
    return lignes
      .map((l) => l.trim())
      .filter((l) => l && /workerProcessEntry|bin\/playwright test/.test(l))
      .filter((l) => { const [pid, ppid] = l.split(/\s+/).map(Number); return !propres.has(pid) && !propres.has(ppid) && pid !== process.pid })
      .map((l) => l.slice(0, 150))
  } catch {
    return []
  }
}

export function journaliser(page, testInfo) {
  if (!actif) return
  mkdirSync(dossier, { recursive: true })
  const nom = testInfo.title.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60)
  fichier = `${dossier}/${process.env.DIAG_RUN ?? 'x'}__${testInfo.file.split('/').pop()}__${nom}.log`
  noter(`SUITES CONCURRENTES ${JSON.stringify(autresSuites())}`)
  const court = (u) => u.replace(/^https?:\/\/[^/]+/, '').slice(0, 110)
  const base = (u) => /supabase\.co\/rest\//.test(u)
  page.on('request', (r) => {
    if (base(r.url()) && r.method() !== 'GET') noter(`APP  → ${r.method()} ${court(r.url())} ${(r.postData() ?? '').slice(0, 400)}`)
  })
  page.on('requestfailed', (r) => {
    if (/supabase\.co/.test(r.url())) noter(`APP  ✗ ÉCHEC RÉSEAU ${r.method()} ${court(r.url())} ${r.failure()?.errorText ?? ''}`)
  })
  page.on('response', (r) => {
    if (base(r.url()) && r.request().method() !== 'GET') noter(`APP  ← ${r.status()} ${r.request().method()} ${court(r.url())}`)
  })
  page.on('request', (r) => {
    if (/dashboard_chiffres/.test(r.url())) noter('APP  → RPC dashboard_chiffres (demande)')
  })
  page.on('response', async (r) => {
    if (!/dashboard_chiffres/.test(r.url())) return
    try {
      const c = await r.json()
      const f = (cle) => c.familles.find((x) => x.cle === cle)?.nb
      noter(`APP  ← RPC dashboard_chiffres qualification=${f('qualification')} devis=${f('devis')} actifs=${c.projets_actifs}`)
    } catch {
      noter('APP  ← RPC dashboard_chiffres (corps illisible)')
    }
  })
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      const t = typeof f.payload === 'string' ? f.payload : ''
      if (t.includes('"table":"dossiers"') && t.includes('postgres_changes')) {
        const m = t.match(/"type":"(INSERT|UPDATE|DELETE)"/)
        noter(`WS   ⇐ ${m?.[1] ?? '?'} dossiers statut=${t.match(/"statut":"(\w+)"/)?.[1] ?? '-'}`)
      }
      if (t.includes('"table":"fichiers"') && t.includes('postgres_changes')) {
        try {
          const d = JSON.parse(t)[4].data
          const r = d.record ?? {}
          const etats = Array.isArray(r.variantes) ? r.variantes.map((o) => `${o.etat ?? '-'}${o.projet ? ':' + o.projet : ''}`).join(',') : '-'
          noter(`WS   ⇐ ${d.type} fichiers nom=${r.nom} taille=${r.taille} decision=${r.decision} decision_le=${r.decision_le} montant=${r.montant_ttc} etats=[${etats}]`)
        } catch {
          noter('WS   ⇐ fichiers (illisible)')
        }
      }
    })
  })
}
