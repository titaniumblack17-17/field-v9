# Mode hors-ligne minimal — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Field V9 reste consultable (fiches déjà ouvertes) et n'oublie plus une saisie (dictée, note, changement d'étape) quand le réseau manque entre deux cabinets.

**Architecture:** Un service worker minimal met en cache le shell de l'app (HTML/JS/CSS) pour qu'elle recharge hors-ligne. Un utilitaire `localStorage` conserve les dernières fiches consultées et sert de secours quand une lecture réseau échoue. Un second utilitaire `localStorage` met en file les écritures qui échouent par manque de réseau et les rejoue au retour de la connexion (déjà détecté par `useEnLigne`, existant).

**Tech Stack:** React 18, Vite 5, Supabase JS, `localStorage`, Service Worker natif (API Cache) — aucune nouvelle dépendance.

## Global Constraints

- Voir la spec : [2026-08-29-mode-hors-ligne-minimal.md](../specs/2026-08-29-mode-hors-ligne-minimal.md) — option B retenue (service worker shell-only).
- Hors périmètre, à ne pas construire : synchronisation bidirectionnelle temps réel hors-ligne, résolution de conflits (dernier écrit gagne, comme aujourd'hui en ligne), mise en cache de tout le CRM, file d'écriture universelle sur toutes les mutations de l'app.
- Périmètre de la file d'écriture : uniquement dictée (`capture-intake`), ajout de note (`client_notes` et `dossier_notes`), changement d'étape/statut de dossier.
- Périmètre du cache de lecture : fiche client (`ClientDetail`), dossier (`DossierDetail`), liste de dossiers déjà chargée (`Pipeline`) — pas la liste complète des clients.
- **Pas de framework de test dans ce dépôt** (confirmé : aucun `test`/`vitest`/`jest` dans `package.json`). Chaque tâche se vérifie donc par : `npx eslint <fichier>` + `npm run build` (déterministe), puis un exercice manuel de la fonction en console navigateur pour les utilitaires purs, puis une vérification en direct dans le navigateur pour les tâches d'intégration UI — c'est la convention déjà en usage sur ce projet (voir CLAUDE.md, section Workflow).
- Style du code : français pour les noms de fonctions/variables/commentaires, comme le reste du dépôt.
- `npm run build` lance ESLint avant Vite — un `no-undef` bloque le déploiement, à vérifier à chaque tâche.

---

## Répartition des commits

Neuf tâches, **chacune committable et déployable indépendamment** — aucune ne casse le comportement existant si elle est déployée seule, parce que chacune est soit un nouveau fichier non encore branché (Tâches 1, 2, 5), soit un branchement qui ne change rien tant que le réseau est présent (Tâches 3, 4, 6, 7, 8, 9 n'altèrent le chemin « en ligne » que pour y ajouter un filet de secours). Pas de raison d'attendre la fin du plan pour pousser — au contraire, déployer au fil de l'eau permet de vérifier chaque brique sur le vrai déploiement Vercel avant d'empiler la suivante.

---

### Tâche 1 : Service worker minimal (cache du shell)

**Files:**
- Create: `public/sw.js`
- Modify: `src/main.jsx`

**Interfaces:**
- Produces: un service worker enregistré qui met en cache `/` et `/index.html`, sous le nom de cache `field-v9-shell-v1`. Aucune tâche suivante n'en dépend directement (le cache de lecture et la file d'écriture sont indépendants du SW), mais c'est la fondation qui rend le reste utile dans le scénario réel (app rechargée hors-ligne).

- [ ] **Étape 1 : Créer le service worker**

```js
// public/sw.js
// Service worker minimal : met en cache le strict nécessaire pour recharger
// l'app hors réseau (le shell — index.html + les bundles JS/CSS générés par
// le build). Ne fait rien d'autre : pas de mise en cache par route, pas de
// stratégie réseau élaborée pour les données, pas de synchronisation en
// arrière-plan. Les appels Supabase (autre origine) ne sont jamais interceptés.
const CACHE = 'field-v9-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['/', '/index.html']))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
  )
  self.clients.claim()
})

// Réseau d'abord (toujours la version la plus fraîche quand elle est
// disponible, mise en cache au passage) ; secours sur le cache seulement si
// le réseau échoue. Jamais pour un appel vers une autre origine (Supabase).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  event.respondWith(
    fetch(event.request)
      .then((reponse) => {
        const copie = reponse.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copie))
        return reponse
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
  )
})
```

- [ ] **Étape 2 : Enregistrer le service worker**

```js
// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Enregistré après le premier rendu, jamais bloquant : l'app fonctionne
// normalement même si l'enregistrement échoue (navigateur trop ancien,
// contexte non sécurisé en dev sur certains ports).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
```

- [ ] **Étape 3 : Vérifier lint + build**

Run: `npx eslint src/main.jsx && npm run build`
Expected: aucune erreur, `dist/sw.js` présent dans la sortie du build (Vite copie automatiquement tout ce qui est dans `public/`).

- [ ] **Étape 4 : Vérifier l'enregistrement en direct**

Ouvrir l'app dans le navigateur, puis en console :

```js
navigator.serviceWorker.getRegistration().then(r => console.log(r?.active?.state))
```

Expected: `"activated"`. Puis vérifier le contenu du cache :

```js
caches.open('field-v9-shell-v1').then(c => c.keys()).then(ks => console.log(ks.map(k => k.url)))
```

Expected: liste contenant l'URL de `/` et `/index.html`.

**Vérification manuelle complémentaire (hors outillage automatisé) :** sur l'iPhone de Bruce, charger l'app une fois en ligne, activer le mode avion, puis recharger la page. Expected : l'app se charge quand même (écran d'accueil visible), pas d'écran blanc. C'est le test qui compte vraiment pour ce scénario — à faire une fois cette tâche déployée en prod, pas seulement en local.

- [ ] **Étape 5 : Commit et déploiement**

```bash
git add public/sw.js src/main.jsx
git commit -m "feat: service worker minimal pour recharger l'app hors-ligne"
git push origin main
```

Vérifier le déploiement par le hash de bundle (`curl` sur `assets/index-*.js`), puis effectuer la vérification manuelle de l'étape 4 sur le déploiement réel.

---

### Tâche 2 : Utilitaire de cache de lecture

**Files:**
- Create: `src/lib/cacheLecture.js`

**Interfaces:**
- Produces: `ecrireCache(cle: string, valeur: any): void`, `lireCache(cle: string): {valeur, horodatage} | null`, `lireAvecCache(cle: string, fetchFn: () => Promise<any>): Promise<{valeur, depuisCache: boolean, horodatage: string | null}>`
- Consumes: rien (module autonome, aucune dépendance vers le reste de l'app)

- [ ] **Étape 1 : Écrire l'utilitaire**

```js
// src/lib/cacheLecture.js
// Cache de lecture léger pour la consultation hors-ligne : conserve les
// dernières fiches consultées dans localStorage, pour qu'elles restent
// lisibles sans réseau. Pas un cache de tout le CRM — juste ce qui a été
// ouvert récemment, borné à un nombre fixe d'entrées (les plus anciennes
// sont purgées au-delà).
const PREFIXE = 'fv9:cache:'
const CLE_INDEX = 'fv9:cache:index'
const MAX_ENTREES = 30

const lireIndex = () => {
  try {
    return JSON.parse(localStorage.getItem(CLE_INDEX) ?? '[]')
  } catch {
    return []
  }
}

const ecrireIndex = (index) => {
  try {
    localStorage.setItem(CLE_INDEX, JSON.stringify(index))
  } catch {
    // localStorage plein ou indisponible (navigation privée, quota atteint) :
    // le cache devient simplement inopérant, jamais une erreur qui remonte.
  }
}

// Place la clé en tête de l'index (plus récemment consultée) et purge les
// entrées au-delà de MAX_ENTREES.
const toucherIndex = (cle) => {
  const index = lireIndex().filter((c) => c !== cle)
  index.unshift(cle)
  const perimees = index.slice(MAX_ENTREES)
  perimees.forEach((c) => localStorage.removeItem(PREFIXE + c))
  ecrireIndex(index.slice(0, MAX_ENTREES))
}

export const ecrireCache = (cle, valeur) => {
  try {
    localStorage.setItem(
      PREFIXE + cle,
      JSON.stringify({ valeur, horodatage: new Date().toISOString() })
    )
    toucherIndex(cle)
  } catch {
    // Voir ecrireIndex ci-dessus.
  }
}

export const lireCache = (cle) => {
  try {
    const brut = localStorage.getItem(PREFIXE + cle)
    return brut ? JSON.parse(brut) : null
  } catch {
    return null
  }
}

/**
 * Essaie `fetchFn`. En cas d'échec (réseau coupé), retombe sur la dernière
 * version connue dans le cache si elle existe. Ne masque jamais l'origine de
 * la valeur : le résultat porte toujours `depuisCache`, pour que l'appelant
 * affiche un indicateur si besoin. Si `fetchFn` échoue et qu'aucun cache
 * n'existe, l'erreur d'origine remonte telle quelle.
 */
export async function lireAvecCache(cle, fetchFn) {
  try {
    const valeur = await fetchFn()
    ecrireCache(cle, valeur)
    return { valeur, depuisCache: false, horodatage: null }
  } catch (erreur) {
    const secours = lireCache(cle)
    if (secours) {
      return { valeur: secours.valeur, depuisCache: true, horodatage: secours.horodatage }
    }
    throw erreur
  }
}
```

- [ ] **Étape 2 : Vérifier lint**

Run: `npx eslint src/lib/cacheLecture.js`
Expected: aucune erreur.

- [ ] **Étape 3 : Exercer la logique en console navigateur**

Ouvrir l'app, puis en console (le module est chargé dès que n'importe quel écran l'importe — voir Tâche 3 pour le premier import réel ; en attendant, coller le corps du module directement en console pour ce test isolé) :

```js
// Écriture puis lecture directe
ecrireCache('test-1', { nom: 'Dupont' })
console.log(lireCache('test-1'))
// Expected: { valeur: { nom: 'Dupont' }, horodatage: '2026-...' }

// Succès réseau : ne retombe pas sur le cache, met à jour la valeur
await lireAvecCache('test-1', () => Promise.resolve({ nom: 'Durand' }))
  .then(r => console.log(r))
// Expected: { valeur: { nom: 'Durand' }, depuisCache: false, horodatage: null }

// Échec réseau avec cache existant : retombe sur la dernière valeur connue
await lireAvecCache('test-1', () => Promise.reject(new Error('réseau coupé')))
  .then(r => console.log(r))
// Expected: { valeur: { nom: 'Durand' }, depuisCache: true, horodatage: '2026-...' }

// Échec réseau sans cache existant : l'erreur remonte
await lireAvecCache('test-inexistant', () => Promise.reject(new Error('réseau coupé')))
  .catch(e => console.log('erreur attendue:', e.message))
// Expected: "erreur attendue: réseau coupé"

// Nettoyage du test
localStorage.removeItem('fv9:cache:test-1')
```

Expected: chaque ligne produit exactement la sortie indiquée en commentaire.

- [ ] **Étape 4 : Commit**

```bash
git add src/lib/cacheLecture.js
git commit -m "feat: utilitaire de cache de lecture localStorage (mode hors-ligne)"
git push origin main
```

Pas de comportement visible pour Bruce à ce stade (module pas encore branché) — déployable sans risque.

---

### Tâche 3 : Câbler le cache de lecture dans ClientDetail

**Files:**
- Modify: `src/screens/ClientDetail.jsx`

**Interfaces:**
- Consumes: `lireAvecCache` de `src/lib/cacheLecture.js` (Tâche 2)

La fiche client elle-même (`values`) arrive déjà en props depuis l'écran appelant (`App.jsx`), pas via un fetch dans `ClientDetail` — c'est donc le chargement des **dossiers du client** (`useEffect` existant, ligne ~360 de `ClientDetail.jsx`) qui doit passer par le cache, puisque c'est la seule lecture réseau propre à cet écran.

- [ ] **Étape 1 : Importer l'utilitaire et l'état de provenance**

Dans `src/screens/ClientDetail.jsx`, ajouter l'import et un état pour savoir si la liste de dossiers affichée vient du cache :

```js
import { lireAvecCache } from '../lib/cacheLecture'
```

Ajouter, à côté des autres `useState` de dossiers (ligne ~357) :

```js
const [dossiersDepuisCache, setDossiersDepuisCache] = useState(false)
```

- [ ] **Étape 2 : Remplacer l'appel direct par `lireAvecCache`**

Remplacer le bloc `supabase.from('dossiers').select(...)` de l'effet de chargement des dossiers (autour de la ligne 364) :

```js
useEffect(() => {
  let active = true
  setErreurDossiers(null)

  lireAvecCache(`dossiers-client-${client.id}`, () =>
    supabase
      .from('dossiers')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        return data ?? []
      })
  )
    .then(({ valeur, depuisCache }) => {
      if (!active) return
      setDossiers(valeur)
      setDossiersDepuisCache(depuisCache)
    })
    .catch(() => {
      if (active) setErreurDossiers('Impossible de charger les dossiers.')
    })

  const channel = supabase
    .channel(`dossiers-client-${client.id}`)
    // ... reste de l'abonnement realtime inchangé
```

Le reste de l'effet (abonnement `.channel(...)`, `return () => {...}`) ne change pas.

- [ ] **Étape 3 : Afficher l'indicateur si la liste vient du cache**

Dans le rendu de la rubrique Dossiers (près de `{erreurDossiers ? (...) : dossiers.length === 0 ? (...) : (...)}`), ajouter juste avant :

```jsx
{dossiersDepuisCache && (
  <p className="text-xs text-alerte px-1 mb-2">
    ⚠ Version hors ligne — peut ne pas refléter les derniers changements
  </p>
)}
```

- [ ] **Étape 4 : Vérifier lint + build**

Run: `npx eslint src/screens/ClientDetail.jsx && npm run build`
Expected: aucune erreur.

- [ ] **Étape 5 : Vérifier en direct (chemin en ligne, ne doit rien casser)**

Ouvrir l'app en local (`npm run dev`), ouvrir une fiche client ayant au moins un dossier, confirmer que la liste des dossiers s'affiche normalement, sans le bandeau "Version hors ligne" (puisque le réseau fonctionne).

- [ ] **Étape 6 : Vérifier le secours sur le cache**

En console, après avoir ouvert une fiche client une première fois (pour peupler le cache) :

```js
// Remplacer <id> par l'id du client réellement ouvert
console.log(JSON.parse(localStorage.getItem('fv9:cache:dossiers-client-<id>')))
```

Expected: un objet `{ valeur: [...], horodatage: '...' }` non vide.

Puis simuler un échec réseau pour CET appel précis en coupant temporairement l'accès réseau du navigateur (DevTools → Network → Offline, ou throttling "Offline" si l'outil du navigateur utilisé le permet) et recharger la fiche client. Expected : la liste de dossiers s'affiche quand même (depuis le cache), avec le bandeau "Version hors ligne" visible. Remettre le réseau en ligne ensuite.

- [ ] **Étape 7 : Commit et déploiement**

```bash
git add src/screens/ClientDetail.jsx
git commit -m "feat: cache de lecture sur la liste de dossiers d'une fiche client"
git push origin main
```

Vérifier le déploiement par le hash de bundle, puis reproduire l'étape 6 sur le déploiement réel.

---

### Tâche 4 : Étendre le cache de lecture à DossierDetail et Pipeline

**Files:**
- Modify: `src/screens/DossierDetail.jsx`
- Modify: `src/screens/Pipeline.jsx`

**Interfaces:**
- Consumes: `lireAvecCache` de `src/lib/cacheLecture.js` (Tâche 2) — même pattern que la Tâche 3.

- [ ] **Étape 1 : Câbler `DossierDetail.jsx`**

Le dossier lui-même arrive en props (comme la fiche client) ; c'est le chargement de son journal de notes (`dossier_notes`, effet vers la ligne 297) qui doit passer par le cache — même transformation que la Tâche 3 :

```js
import { lireAvecCache } from '../lib/cacheLecture'
```

```js
const [notesDepuisCache, setNotesDepuisCache] = useState(false)
```

```js
useEffect(() => {
  let active = true

  lireAvecCache(`notes-dossier-${dossier.id}`, () =>
    supabase
      .from('dossier_notes')
      .select('*')
      .eq('dossier_id', dossier.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        return data ?? []
      })
  )
    .then(({ valeur, depuisCache }) => {
      if (!active) return
      setNotes(valeur)
      setNotesDepuisCache(depuisCache)
    })
    .catch(() => {})

  // ... abonnement realtime existant inchangé
```

Ajouter le même bandeau d'avertissement que la Tâche 3, étape 3, au-dessus de la liste de notes, conditionné sur `notesDepuisCache`.

- [ ] **Étape 2 : Câbler `Pipeline.jsx`**

Remplacer l'appel direct de l'effet de chargement des dossiers (ligne ~297) :

```js
lireAvecCache('pipeline-dossiers', () =>
  supabase
    .from('dossiers')
    .select('*, clients(id, prenom_praticien, nom_praticien, nom_cabinet, ville)')
    .in('type', ['projet', 'sav', 'plan'])
    .order('created_at', { ascending: false })
    .then(({ data, error }) => {
      if (error) throw new Error(error.message)
      return data ?? []
    })
)
  .then(({ valeur, depuisCache }) => {
    if (!active) return
    setDossiers(valeur)
    setPipelineDepuisCache(depuisCache)
    setChargement(false)
  })
  .catch(() => {
    if (active) {
      setErreur('Impossible de charger le pipeline.')
      setChargement(false)
    }
  })
```

Ajouter `const [pipelineDepuisCache, setPipelineDepuisCache] = useState(false)` et le bandeau d'avertissement dans le rendu, juste sous le header.

- [ ] **Étape 3 : Vérifier lint + build**

Run: `npx eslint src/screens/DossierDetail.jsx src/screens/Pipeline.jsx && npm run build`
Expected: aucune erreur.

- [ ] **Étape 4 : Vérifier en direct**

Même procédure que la Tâche 3, étapes 5-6, répétée sur un dossier (pour `DossierDetail`) et sur l'écran Pipeline — ouvrir en ligne, confirmer l'absence de bandeau, couper le réseau, recharger, confirmer l'affichage depuis le cache avec le bandeau, remettre le réseau.

- [ ] **Étape 5 : Commit et déploiement**

```bash
git add src/screens/DossierDetail.jsx src/screens/Pipeline.jsx
git commit -m "feat: étendre le cache de lecture à DossierDetail et Pipeline"
git push origin main
```

---

### Tâche 5 : Utilitaire de file d'écriture

**Files:**
- Create: `src/lib/fileAttente.js`

**Interfaces:**
- Produces: `mettreEnFile(action: {type: string, [autres champs]}): void`, `tailleFile(): number`, `viderFile(executer: (action) => Promise<void>): Promise<{traitees: number, restantes: number}>`, `ecouterTailleFile(callback: (taille: number) => void): () => void` (abonnement pour l'indicateur d'UI, Tâche 6)
- Consumes: rien (module autonome)

- [ ] **Étape 1 : Écrire l'utilitaire**

```js
// src/lib/fileAttente.js
// File d'écriture hors-ligne : une action qui échoue par manque de réseau
// (dictée, note, changement d'étape) est mise en attente ici plutôt que
// perdue, et rejouée automatiquement au retour du réseau. Vit dans
// localStorage pour survivre à un rechargement de page pendant la coupure.
const CLE = 'fv9:file-attente'
const ecouteurs = new Set()

const lireFile = () => {
  try {
    return JSON.parse(localStorage.getItem(CLE) ?? '[]')
  } catch {
    return []
  }
}

const ecrireFile = (file) => {
  try {
    localStorage.setItem(CLE, JSON.stringify(file))
  } catch {
    // localStorage plein/indisponible : rien de plus à faire ici, l'appelant
    // a déjà tenté l'envoi direct avant d'en arriver là.
  }
  ecouteurs.forEach((cb) => cb(file.length))
}

export const mettreEnFile = (action) => {
  const file = lireFile()
  file.push({ ...action, id: crypto.randomUUID(), horodatage: new Date().toISOString() })
  ecrireFile(file)
}

export const tailleFile = () => lireFile().length

// Pour l'indicateur d'UI (Tâche 6) : notifie à chaque changement de taille,
// retourne la fonction de désabonnement.
export const ecouterTailleFile = (callback) => {
  ecouteurs.add(callback)
  return () => ecouteurs.delete(callback)
}

/**
 * Rejoue chaque action en attente, dans l'ordre, via `executer` (fourni par
 * l'appelant — lui seul sait comment envoyer chaque type d'action, voir
 * Tâches 7-9). Une action qui échoue encore reste en file pour la prochaine
 * tentative ; le vidage s'arrête au premier échec pour garder l'ordre
 * d'origine plutôt que de rejouer dans le désordre.
 */
export async function viderFile(executer) {
  const file = lireFile()
  const restantes = [...file]
  while (restantes.length) {
    const action = restantes[0]
    try {
      await executer(action)
      restantes.shift()
      ecrireFile(restantes)
    } catch {
      break
    }
  }
  return { traitees: file.length - restantes.length, restantes: restantes.length }
}
```

- [ ] **Étape 2 : Vérifier lint**

Run: `npx eslint src/lib/fileAttente.js`
Expected: aucune erreur.

- [ ] **Étape 3 : Exercer la logique en console navigateur**

```js
// File vide au départ
console.log(tailleFile()) // Expected: 0

// Ajout de deux actions
mettreEnFile({ type: 'note', dossierId: 'abc' })
mettreEnFile({ type: 'etape', dossierId: 'def', statut: 'negociation' })
console.log(tailleFile()) // Expected: 2

// Vidage : la première réussit, la seconde échoue → s'arrête, la garde
let appel = 0
const resultat = await viderFile(async (action) => {
  appel++
  if (appel === 2) throw new Error('échec simulé')
})
console.log(resultat) // Expected: { traitees: 1, restantes: 1 }
console.log(tailleFile()) // Expected: 1

// Nettoyage du test
localStorage.removeItem('fv9:file-attente')
```

Expected: chaque ligne produit exactement la sortie indiquée.

- [ ] **Étape 4 : Commit**

```bash
git add src/lib/fileAttente.js
git commit -m "feat: utilitaire de file d'écriture localStorage (mode hors-ligne)"
git push origin main
```

Pas de comportement visible pour Bruce à ce stade (module pas encore branché) — déployable sans risque.

---

### Tâche 6 : Indicateur d'UI et vidage automatique au retour réseau

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `tailleFile`, `ecouterTailleFile`, `viderFile` de `src/lib/fileAttente.js` (Tâche 5)
- Produces: un exécuteur central `executerActionEnFile(action)` que les Tâches 7-9 doivent étendre (un `switch` sur `action.type`) — c'est ici que chaque type d'action sait comment se rejouer.

- [ ] **Étape 1 : Ajouter l'état de taille de file et le vidage automatique**

Dans `src/App.jsx`, à côté de `useEnLigne` :

```js
import { tailleFile, ecouterTailleFile, viderFile } from './lib/fileAttente'

// L'exécuteur ne sait rien encore à ce stade (Tâche 6 seule) — les Tâches
// 7-9 ajoutent un cas à ce switch à chaque action câblée sur la file.
async function executerActionEnFile(action) {
  switch (action.type) {
    default:
      throw new Error(`Type d'action inconnu : ${action.type}`)
  }
}

function useFileAttente(enLigne) {
  const [taille, setTaille] = useState(() => tailleFile())

  useEffect(() => ecouterTailleFile(setTaille), [])

  useEffect(() => {
    if (enLigne && taille > 0) {
      viderFile(executerActionEnFile)
    }
  }, [enLigne])

  return taille
}
```

- [ ] **Étape 2 : Appeler le hook et afficher l'indicateur**

Dans `App()`, à côté de `const enLigne = useEnLigne()` :

```js
const tailleFileAttente = useFileAttente(enLigne)
```

Dans le rendu, à côté du bandeau `!enLigne` existant :

```jsx
{tailleFileAttente > 0 && (
  <div className="sticky top-0 z-30 bg-alerte text-white text-xs font-medium text-center py-1.5">
    {tailleFileAttente} action{tailleFileAttente > 1 ? 's' : ''} en attente d'envoi
  </div>
)}
```

- [ ] **Étape 3 : Vérifier lint + build**

Run: `npx eslint src/App.jsx && npm run build`
Expected: aucune erreur.

- [ ] **Étape 4 : Vérifier en direct (rien à mettre en file pour l'instant)**

Ouvrir l'app, confirmer qu'aucun bandeau "en attente d'envoi" ne s'affiche (la file est vide tant que les Tâches 7-9 ne l'alimentent pas). En console :

```js
mettreEnFile({ type: 'test' })
```

Expected : le bandeau "1 action en attente d'envoi" apparaît immédiatement (sans recharger). Puis :

```js
localStorage.removeItem('fv9:file-attente')
location.reload()
```

pour nettoyer.

- [ ] **Étape 5 : Commit et déploiement**

```bash
git add src/App.jsx
git commit -m "feat: indicateur de file d'attente et vidage automatique au retour réseau"
git push origin main
```

---

### Tâche 7 : Câbler la file dans l'ajout de note

**Files:**
- Modify: `src/App.jsx` (étendre `executerActionEnFile`)
- Modify: `src/screens/ClientDetail.jsx` (`ajouterInfo`)
- Modify: `src/screens/DossierDetail.jsx` (`addNote`)

**Interfaces:**
- Consumes: `mettreEnFile` de `src/lib/fileAttente.js` ; étend le `switch` d'`executerActionEnFile` (Tâche 6)

- [ ] **Étape 1 : Ajouter le cas "note" à l'exécuteur central**

Dans `src/App.jsx`, ajouter l'import statique de `supabase` en tête de fichier (comme dans tous les autres écrans du dépôt) :

```js
import { supabase } from './lib/supabaseClient'
```

Puis étendre le `switch` de `executerActionEnFile` :

```js
async function executerActionEnFile(action) {
  switch (action.type) {
    case 'note': {
      await supabase.from(action.table).insert(action.payload)
      return
    }
    default:
      throw new Error(`Type d'action inconnu : ${action.type}`)
  }
}
```

- [ ] **Étape 2 : Câbler `ajouterInfo` dans `ClientDetail.jsx`**

Remplacer la fonction `ajouterInfo` existante (ligne ~89) :

```js
import { mettreEnFile } from '../lib/fileAttente'
```

```js
const ajouterInfo = async () => {
  if (!nouvelleInfo.trim()) return
  setEnvoiInfo(true)
  const payload = { client_id: client.id, texte: nouvelleInfo.trim() }
  const { error } = await supabase.from('client_notes').insert(payload)
  if (error) {
    // Échec probable par manque de réseau : la note part en file plutôt
    // que de se perdre. On ne distingue pas les autres causes d'erreur
    // (une erreur de schéma échouerait pareil) — hors périmètre de ce mode,
    // qui vise le cas réseau, le plus fréquent sur le terrain.
    mettreEnFile({ type: 'note', table: 'client_notes', payload })
  }
  setNouvelleInfo('')
  setAjoutInfoOuvert(false)
  setEnvoiInfo(false)
}
```

- [ ] **Étape 3 : Câbler `addNote` dans `DossierDetail.jsx`**

Même transformation, sur `addNote` (ligne ~337) :

```js
import { mettreEnFile } from '../lib/fileAttente'
```

```js
const addNote = async () => {
  const texte = await demanderTexte('', {
    titre: 'Ajouter une note',
    confirmLabel: 'Ajouter',
    placeholder: 'Objet, échange, ce qui a été dit…',
  })
  if (!texte || !texte.trim()) return
  setAddingNote(true)
  const payload = { dossier_id: dossier.id, texte: texte.trim() }
  const { error } = await supabase.from('dossier_notes').insert(payload)
  if (error) {
    mettreEnFile({ type: 'note', table: 'dossier_notes', payload })
  }
  setAddingNote(false)
}
```

- [ ] **Étape 4 : Vérifier lint + build**

Run: `npx eslint src/App.jsx src/screens/ClientDetail.jsx src/screens/DossierDetail.jsx && npm run build`
Expected: aucune erreur.

- [ ] **Étape 5 : Vérifier en direct — chemin en ligne**

Ajouter une note sur une fiche client et sur un dossier avec le réseau actif. Expected : comportement inchangé, note enregistrée normalement, aucun bandeau de file d'attente.

- [ ] **Étape 6 : Vérifier en direct — chemin hors-ligne**

Couper le réseau (DevTools → Network → Offline), ajouter une note sur un dossier. Expected : le bandeau "1 action en attente d'envoi" apparaît, la saisie ne semble pas perdue côté UI. Remettre le réseau en ligne. Expected : le bandeau disparaît dans les secondes qui suivent (vidage automatique), et la note apparaît bien dans la base au rechargement de l'écran.

- [ ] **Étape 7 : Commit et déploiement**

```bash
git add src/App.jsx src/screens/ClientDetail.jsx src/screens/DossierDetail.jsx
git commit -m "feat: mise en file des notes en cas d'échec réseau"
git push origin main
```

---

### Tâche 8 : Câbler la file dans le changement d'étape

**Files:**
- Modify: `src/App.jsx` (étendre `executerActionEnFile`)
- Modify: `src/screens/Pipeline.jsx` (`changerEtape`, `handleDragEnd`)

**Interfaces:**
- Consumes: `mettreEnFile` de `src/lib/fileAttente.js` ; étend le `switch` d'`executerActionEnFile`

- [ ] **Étape 1 : Ajouter le cas "etape" à l'exécuteur central**

Ajouter l'import statique de `assurerRappelDeRelance` en tête de `src/App.jsx` (`supabase` est déjà importé depuis la Tâche 7) :

```js
import { assurerRappelDeRelance } from './lib/rappel'
```

Puis étendre le `switch` :

```js
// src/App.jsx — étendre le switch existant (Tâche 7)
case 'etape': {
  await supabase.from('dossiers').update({ statut: action.statut }).eq('id', action.dossierId)
  await assurerRappelDeRelance(action.dossierId, action.statut)
  return
}
```

- [ ] **Étape 2 : Câbler `changerEtape` dans `Pipeline.jsx`**

```js
import { mettreEnFile } from '../lib/fileAttente'
```

```js
const changerEtape = useCallback(async (dossier, etape) => {
  setADeplacer(null)
  if (dossier.statut === etape) return
  setDossiers((current) => current.map((d) => (d.id === dossier.id ? { ...d, statut: etape } : d)))
  const { error } = await supabase.from('dossiers').update({ statut: etape }).eq('id', dossier.id)
  if (error) {
    mettreEnFile({ type: 'etape', dossierId: dossier.id, statut: etape })
    return
  }
  await assurerRappelDeRelance(dossier.id, etape)
}, [])
```

- [ ] **Étape 3 : Câbler `handleDragEnd` dans `Pipeline.jsx`**

Même transformation sur la fin de `handleDragEnd` :

```js
setDossiers((current) => current.map((x) => (x.id === d.id ? { ...x, statut } : x)))
const { error } = await supabase.from('dossiers').update({ statut }).eq('id', d.id)
if (error) {
  mettreEnFile({ type: 'etape', dossierId: d.id, statut })
  return
}
await assurerRappelDeRelance(d.id, statut)
```

- [ ] **Étape 4 : Vérifier lint + build**

Run: `npx eslint src/App.jsx src/screens/Pipeline.jsx && npm run build`
Expected: aucune erreur.

- [ ] **Étape 5 : Vérifier en direct — chemin en ligne**

Déplacer un dossier via le bouton "Déplacer" avec le réseau actif. Expected : comportement inchangé (déjà testé lors de la Tâche de mémoïsation précédente).

- [ ] **Étape 6 : Vérifier en direct — chemin hors-ligne**

Couper le réseau, déplacer un dossier. Expected : le changement d'étape reste visible à l'écran (déjà le cas — mise à jour optimiste existante), le bandeau de file d'attente apparaît. Remettre le réseau. Expected : le bandeau disparaît, l'étape est bien enregistrée en base (vérifiable en rechargeant l'écran).

**Attention à la donnée réelle pendant ce test** : comme pour la vérification de la Tâche de mémoïsation, faire ce test sur un dossier de test ou remettre manuellement le bon statut après coup — ne pas laisser un vrai dossier de Bruce dans un état de test.

- [ ] **Étape 7 : Commit et déploiement**

```bash
git add src/App.jsx src/screens/Pipeline.jsx
git commit -m "feat: mise en file des changements d'étape en cas d'échec réseau"
git push origin main
```

---

### Tâche 9 : Câbler la file dans la dictée

**Files:**
- Modify: `src/App.jsx` (étendre `executerActionEnFile`)
- Modify: `src/screens/Capture.jsx` (`submit`)

**Interfaces:**
- Consumes: `mettreEnFile` de `src/lib/fileAttente.js` ; étend le `switch` d'`executerActionEnFile`

- [ ] **Étape 1 : Ajouter le cas "capture" à l'exécuteur central**

```js
// src/App.jsx — étendre le switch existant (Tâches 7-8)
case 'capture': {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/capture-intake`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action.payload),
  })
  if (!res.ok) throw new Error('échec capture-intake')
  return
}
```

- [ ] **Étape 2 : Câbler `submit` dans `Capture.jsx`**

```js
import { mettreEnFile } from '../lib/fileAttente'
```

```js
const submit = async (e) => {
  e.preventDefault()
  if (!texte.trim()) return
  setSending(true)
  setError(null)
  setLastResult(null)

  const payload = { texte: texte.trim(), source: 'clavier' }

  try {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue')
    setLastResult(data)
    setTexte('')
    if (data.client_id) {
      const { data: c } = await supabase
        .from('clients')
        .select('id, prenom_praticien, nom_praticien, nom_cabinet, ville')
        .eq('id', data.client_id)
        .maybeSingle()
      setClientTouche(c ?? null)
    } else {
      setClientTouche(null)
    }
  } catch (err) {
    // Une dictée qui échoue par manque de réseau ne doit jamais se perdre :
    // elle part en file, le texte est vidé côté UI pour que Bruce puisse
    // enchaîner sur la suivante sans avoir l'impression que rien ne s'est
    // passé — la mention "en attente" (bandeau global) confirme la prise
    // en compte.
    mettreEnFile({ type: 'capture', payload })
    setTexte('')
    setLastResult(null)
  } finally {
    setSending(false)
  }
}
```

- [ ] **Étape 3 : Vérifier lint + build**

Run: `npx eslint src/App.jsx src/screens/Capture.jsx && npm run build`
Expected: aucune erreur.

- [ ] **Étape 4 : Vérifier en direct — chemin en ligne**

Envoyer une dictée avec le réseau actif. Expected : comportement inchangé (fiche créée/complétée normalement, résultat affiché).

- [ ] **Étape 5 : Vérifier en direct — chemin hors-ligne**

Couper le réseau, envoyer une dictée de test explicitement identifiable (ex. "Crée une fiche pour le docteur Testhorsligne"). Expected : le champ se vide, le bandeau de file d'attente apparaît, aucune erreur bloquante affichée. Remettre le réseau. Expected : le bandeau disparaît, et la fiche "Testhorsligne" apparaît bien dans la liste des clients au retour du réseau (vidage automatique a rejoué la capture).

**Nettoyage obligatoire** : supprimer la fiche de test créée par ce scénario avant de terminer (comme pour tous les tests précédents sur la vraie base).

- [ ] **Étape 6 : Commit et déploiement**

```bash
git add src/App.jsx src/screens/Capture.jsx
git commit -m "feat: mise en file de la dictée en cas d'échec réseau"
git push origin main
```

---

## Ce que ce plan ne couvre pas (rappel du hors-scope de la spec)

Une action qui échoue de façon répétée au vidage (ex. le dossier a été supprimé entre-temps) reste en file indéfiniment sans mécanisme pour la voir ou l'abandonner manuellement — pas construit ici, la spec l'identifiait déjà comme un angle mort accepté. Si ça devient gênant à l'usage, ce sera un plan à part plutôt qu'un ajout improvisé à celui-ci.
