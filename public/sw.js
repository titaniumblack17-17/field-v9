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
