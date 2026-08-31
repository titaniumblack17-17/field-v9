import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Enregistré après le premier rendu, jamais bloquant : l'app fonctionne
// normalement même si l'enregistrement échoue (navigateur trop ancien,
// contexte non sécurisé en dev sur certains ports).
//
// Uniquement en production : un service worker en dev sert son cache dès
// qu'un fetch échoue (ex. le serveur qui redémarre après un changement de
// config Tailwind), et continue ensuite de resservir cette version périmée
// même une fois le serveur revenu — plusieurs « ça ne change jamais »
// pendant le chantier ClientList (bouton, halo de recherche) venaient de
// là, pas d'un bug de code. En dev, on désenregistre plutôt tout service
// worker existant depuis une session précédente et on vide son cache, pour
// qu'un simple rechargement suffise à voir l'état réel du code.
if (import.meta.env.PROD) {
  if ('serviceWorker' in navigator) {
    // Un nouveau service worker (sw.js versionné à chaque build, voir
    // scripts/stamp-sw.mjs) s'installe et prend le contrôle tout seul
    // (skipWaiting + clients.claim côté sw.js) — mais la page déjà chargée
    // continue de tourner avec l'ancien JS tant qu'elle n'est pas rechargée.
    // `controllerchange` se déclenche exactement à ce moment-là : on
    // recharge automatiquement, sans rien demander à Bruce. Ignoré à la
    // toute première installation (hadController = false) : la page vient
    // déjà d'être servie fraîche par le réseau, un rechargement n'y
    // apporterait rien.
    const hadController = Boolean(navigator.serviceWorker.controller)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) window.location.reload()
    })

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        // L'app reste souvent en arrière-plan de longues minutes entre deux
        // cabinets : revérifier une mise à jour à chaque retour au premier
        // plan, plutôt que d'attendre la revérification automatique (peu
        // fréquente) du navigateur.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update()
        })
      }).catch(() => {})
    })
  }
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister())
  })
  if (window.caches) {
    caches.keys().then((cles) => cles.forEach((c) => caches.delete(c)))
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
