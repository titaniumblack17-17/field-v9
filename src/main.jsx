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
