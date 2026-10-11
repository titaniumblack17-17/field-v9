// Un seul passage de la suite à la fois sur cette machine : toutes les sessions écrivent dans
// la même base Supabase (fixtures ZZTEST, chiffres globaux de la RPC). Deux suites simultanées
// se piétinent — doublons de fixtures, totaux qui bougent entre deux lectures. Verrou par
// dossier (création atomique) ; un verrou dont le processus est mort est repris.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const VERROU = '/tmp/field-v9-e2e.verrou'
const vivant = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export default async function verrouGlobal() {
  const debut = Date.now()
  let signale = false
  for (;;) {
    try {
      mkdirSync(VERROU)
      writeFileSync(`${VERROU}/pid`, String(process.pid))
      break
    } catch {
      let pid = NaN
      try {
        pid = Number(readFileSync(`${VERROU}/pid`, 'utf8'))
      } catch {
        // verrou en cours de création par une autre session : on retente
      }
      if (pid && !vivant(pid)) {
        rmSync(VERROU, { recursive: true, force: true })
        continue
      }
      if (!signale) console.log(`Une autre suite tourne (pid ${pid || '?'}) : attente du verrou ${VERROU}`)
      signale = true
      if (Date.now() - debut > 60 * 60_000) throw new Error('Verrou de suite non libéré après 60 min')
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
  return async () => rmSync(VERROU, { recursive: true, force: true })
}
