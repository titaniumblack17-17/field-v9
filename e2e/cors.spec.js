import { test, expect } from './base.js'

// Vraies pré-vérifications CORS (OPTIONS) envoyées à Supabase, avec les en-têtes que le navigateur annonce pour chaque
// appel de l'application. Les autres scénarios laissent Playwright répondre lui-même aux pré-vérifications quand il
// intercepte des requêtes : ce fichier est le garde-fou qui empêche cela de masquer un vrai défaut (c'est ainsi que trois
// fonctions Edge sont restées mortes une journée : en-tête `x-client-info` absent de leur liste autorisée).
// ~15 requêtes ; aucune donnée lue ni écrite.
const BASE = process.env.VITE_SUPABASE_URL
const ORIGINE = 'https://field-v9.vercel.app'
const EN_TETES_SUPABASE_JS = ['authorization', 'apikey', 'content-type', 'x-client-info']

const preverifier = async (chemin, methode, enTetes) => {
  const r = await fetch(`${BASE}${chemin}`, {
    method: 'OPTIONS',
    headers: { origin: ORIGINE, 'access-control-request-method': methode, 'access-control-request-headers': enTetes.join(', ') },
  })
  const permis = (r.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',').map((x) => x.trim())
  const origine = r.headers.get('access-control-allow-origin')
  const methodes = (r.headers.get('access-control-allow-methods') ?? '').toUpperCase()
  return { r, permis, origine, methodes, manque: enTetes.filter((h) => !permis.includes(h) && !permis.includes('*')) }
}

// Fonctions Edge appelées depuis le navigateur (supabase.functions.invoke ou fetch direct).
// (Les titres n'écrivent pas « todoist » : la passe qui exclut les scénarios Todoist ne doit pas exclure ces deux
// pré-vérifications, qui ne contactent jamais Todoist — elles ne parlent qu'à la fonction Edge de Supabase.)
const FONCTIONS = [['rappels', 'todoist-rappel'], ['tâches', 'todoist-tache'], ['devis', 'devis-montant-v2'], ['entreprise', 'entreprise-lookup'], ['fiche web', 'client-web-lookup'], ['anomalies', 'loupe-memoire-resoudre'], ['capture', 'capture-intake']]
for (const [etiquette, fn] of FONCTIONS) {
  test(`pré-vérification CORS réelle : fonction « ${etiquette} » (${fn.replace('todoist-', 'synchro-')})`, async () => {
    const { r, origine, manque } = await preverifier(`/functions/v1/${fn}`, 'POST', EN_TETES_SUPABASE_JS)
    expect(r.status, `statut de ${fn}`).toBeLessThan(300)
    expect(['*', ORIGINE], `origine autorisée de ${fn}`).toContain(origine)
    expect(manque, `en-têtes refusés par ${fn}`).toEqual([])
  })
}

test('pré-vérification CORS réelle : API de données, stockage et authentification', async () => {
  for (const [chemin, methode, enTetes] of [
    ['/rest/v1/dossiers', 'GET', [...EN_TETES_SUPABASE_JS]],
    ['/rest/v1/dossiers', 'PATCH', [...EN_TETES_SUPABASE_JS, 'prefer']],
    ['/rest/v1/fichiers', 'POST', [...EN_TETES_SUPABASE_JS, 'prefer']],
    ['/rest/v1/rpc/dashboard_chiffres', 'POST', [...EN_TETES_SUPABASE_JS]],
    ['/storage/v1/object/documents/essai', 'POST', [...EN_TETES_SUPABASE_JS, 'x-upsert', 'cache-control']],
    ['/auth/v1/otp', 'POST', [...EN_TETES_SUPABASE_JS]],
    ['/auth/v1/token', 'POST', [...EN_TETES_SUPABASE_JS]],
  ]) {
    const { r, origine, manque, methodes } = await preverifier(chemin, methode, enTetes)
    expect(r.status, `${methode} ${chemin}`).toBeLessThan(300)
    expect(['*', ORIGINE], `origine autorisée ${chemin}`).toContain(origine)
    expect(manque, `en-têtes refusés ${methode} ${chemin}`).toEqual([])
    expect(methodes === '' || methodes.includes('*') || methodes.includes(methode), `méthode ${methode} ${chemin}: ${methodes}`).toBe(true)
  }
})
