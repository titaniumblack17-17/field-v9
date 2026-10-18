// `test` de toute la suite (à importer à la place de '@playwright/test'). Il ajoute, pour TOUS les tests et sans toucher à
// l'application, trois choses qui réduisent le trafic Supabase d'une passe :
//   1. les chargements inutiles aux scénarios sont court-circuités : loupe_memoire, rapport_hebdo, les deux fonctions Todoist
//      (réponse vide immédiate — Todoist n'est jamais appelé) et le temps réel (serveur WebSocket de substitution : les canaux
//      s'abonnent normalement mais aucun événement n'arrive) ;
//   2. un scénario qui UTILISE réellement l'une de ces ressources la réclame (voir « autoriser » ci-dessous) ;
//   3. le compteur de requêtes Supabase (navigateur + aides Node) de e2e/compteur.js.
// Les vraies requêtes de données (dossiers, fichiers, clients…) ne sont JAMAIS simulées : elles partent vers la vraie base.
import { test as base, expect } from '@playwright/test'
import { compter, envoyer } from './compteur.js'

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const HOTE_SUPABASE = new URL(process.env.VITE_SUPABASE_URL ?? 'http://supabase.invalide').host
/** Toute adresse de Supabase (ou du proxy de mesure qui la remplace) — à utiliser pour couper le réseau vers Supabase. */
export const RE_SUPABASE = new RegExp(echapper(HOTE_SUPABASE))

// Ressources court-circuitées par défaut ; `autoriser` ou une étiquette de test (@temps-reel, @loupe, @rapport-hebdo,
// @todoist) les rend réelles pour le scénario concerné.
export const RESSOURCES = ['temps-reel', 'loupe', 'rapport-hebdo', 'todoist']

// Aide Node : compte les requêtes que les tests envoient eux-mêmes à Supabase (fixtures, vérifications en base).
if (!globalThis.__fetchCompte) {
  globalThis.__fetchCompte = true
  const original = globalThis.fetch
  globalThis.fetch = async (entree, ...reste) => {
    const reponse = await original(entree, ...reste)
    try {
      const url = typeof entree === 'string' ? entree : entree.url ?? String(entree)
      if (RE_SUPABASE.test(url)) compter(url, Number(reponse.headers.get('content-length') ?? 0))
    } catch {
      // jamais d'échec à cause du compteur
    }
    return reponse
  }
}
process.on('exit', () => envoyer('(fin du processus)'))

const cors = (route) => {
  const origine = route.request().headers().origin ?? '*'
  return { 'access-control-allow-origin': origine, 'access-control-expose-headers': 'content-range', vary: 'Origin' }
}
// Requêtes que la base n'a JAMAIS vues (réponse de substitution) : exclues du compteur.
const simulees = new WeakSet()
const repondre = (route, reponse) => {
  simulees.add(route.request())
  return route.fulfill({ headers: cors(route), ...reponse })
}
const jsonVide = (route, corps) => repondre(route, { status: 200, contentType: 'application/json', body: corps })

async function installer(context, permis, titre) {
  const en_attente = new Set()
  context.on('requestfinished', (req) => {
    if (!RE_SUPABASE.test(req.url()) || simulees.has(req)) return
    const p = req.sizes().then((s) => compter(req.url(), s.responseBodySize ?? 0), () => compter(req.url(), 0))
    en_attente.add(p)
    p.finally(() => en_attente.delete(p))
  })

  await context.route(RE_SUPABASE, (route) => {
    const req = route.request()
    const chemin = new URL(req.url()).pathname
    if (req.method() === 'OPTIONS') return route.fallback()
    if (!permis('loupe') && /^\/rest\/v1\/loupe_memoire/.test(chemin)) return jsonVide(route, '[]')
    if (!permis('rapport-hebdo') && /^\/rest\/v1\/rapport_hebdo/.test(chemin)) {
      // lecture « une ligne ou rien » (maybeSingle) : la réponse PostgREST d'une table sans ligne
      if ((req.headers().accept ?? '').includes('pgrst.object')) {
        return repondre(route, { status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }) })
      }
      return jsonVide(route, '[]')
    }
    if (!permis('todoist') && /^\/functions\/v1\/todoist-(rappel|tache)/.test(chemin)) return jsonVide(route, '{}')
    return route.fallback()
  })

  if (!permis('temps-reel')) {
    // Serveur Realtime de substitution (protocole Phoenix v2) : jointures et battements acquittés, aucun événement.
    await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      const abonnements = [] // { topic, filtres } : ce que l'application a demandé d'écouter (voir echoRealtime)
      ;(context.__factices ??= []).push({ ws, abonnements })
      ws.onMessage((message) => {
        let m
        try {
          m = JSON.parse(String(message))
        } catch {
          return
        }
        if (!Array.isArray(m)) return
        const [joinRef, ref, topic, evenement, charge] = m
        if (evenement === 'heartbeat') return ws.send(JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]))
        const filtres = (charge?.config?.postgres_changes ?? []).map((f, i) => ({ id: i + 1, ...f }))
        if (evenement === 'phx_join') abonnements.push({ topic, filtres })
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: evenement === 'phx_join' ? { postgres_changes: filtres } : {} }]))
      })
    })
  }
  return async () => {
    await Promise.allSettled([...en_attente])
    envoyer(titre)
  }
}

export const test = base.extend({
  // Ressources réelles pour ce fichier : test.use({ autoriser: ['temps-reel'] })
  autoriser: [[], { option: true }],
  context: async ({ context, autoriser }, use, testInfo) => {
    const etiquettes = new Set(testInfo.tags.map((t) => t.replace(/^@/, '')))
    // E2E_REEL=temps-reel,todoist… rend ces ressources réelles pour toute la passe (diagnostic).
    const globales = new Set((process.env.E2E_REEL ?? '').split(',').filter(Boolean))
    const permis = (nom) => autoriser.includes(nom) || etiquettes.has(nom) || globales.has(nom)
    const terminer = await installer(context, permis, `${testInfo.file.split('/').pop()} › ${testInfo.title}`)
    await use(context)
    await terminer()
  },
})
/**
 * Fait arriver un événement temps réel (INSERT / UPDATE / DELETE) aux abonnements de l'application, à travers le serveur
 * Realtime factice (inactif quand le scénario utilise le vrai temps réel). Retourne le nombre de canaux atteints.
 * Sert à tester « l'écho n'arrive jamais » (on n'appelle pas cette fonction) et « l'écho arrive en retard ».
 */
export function echoRealtime(context, { table, type = 'INSERT', record, ancien = {} }) {
  let atteints = 0
  for (const { ws, abonnements } of context.__factices ?? []) {
    for (const { topic, filtres } of abonnements) {
      for (const f of filtres) {
        if (f.table !== table || !(f.event === '*' || f.event === type)) continue
        const m = /^(\w+)=eq\.(.+)$/.exec(f.filter ?? '')
        if (m && String(record[m[1]]) !== m[2]) continue
        ws.send(JSON.stringify([null, null, topic, 'postgres_changes', { ids: [f.id], data: { schema: 'public', table, commit_timestamp: new Date().toISOString(), type, record, old_record: ancien, columns: [], errors: null } }]))
        atteints += 1
      }
    }
  }
  return atteints
}
export { expect }
