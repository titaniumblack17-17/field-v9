import React, { useEffect, useState } from 'react'
import { journaliser, lireJournal, viderJournal, ecouterJournal } from '../lib/diagnosticReseau'

const INTERVALLE_SONDAGE_MS = 3000
// Un battement à chaque sondage noierait le journal sur un test de plusieurs
// minutes — un battement toutes les 5 sondes (~15s) suffit à repérer un trou
// (JS suspendu) dans les horodatages, tout en gardant le journal lisible.
const BATTEMENT_TOUS_LES = 5

// Panneau de diagnostic temporaire, actif uniquement avec ?debug=reseau dans
// l'URL (voir App.jsx) — jamais monté en usage normal, donc strictement sans
// effet sur le comportement existant. Journalise chaque signal réseau/cycle
// de vie disponible, plus un sondage périodique de navigator.onLine
// indépendant de tout événement, pour établir ce qui se déclenche vraiment
// en PWA installée iOS pendant un cycle mode avion via le Centre de
// contrôle — voir diagnosticReseau.js pour le détail de la panne investiguée.
export default function DiagnosticReseau() {
  const [journal, setJournal] = useState(() => lireJournal())

  useEffect(() => {
    const desabonner = ecouterJournal(setJournal)
    journaliser('montage')

    const surEvenement = (nom) => () => journaliser(nom)
    // 'online'/'offline'/'focus'/'blur' sont des événements de window ;
    // 'visibilitychange'/'pageshow'/'pagehide' se posent sur document (les
    // deux derniers fonctionnent aussi sur window, mais document est la
    // cible standard pour visibilitychange, on garde tout groupé pareil).
    const evenementsWindow = ['online', 'offline', 'focus', 'blur']
    const evenementsDocument = ['visibilitychange', 'pageshow', 'pagehide']
    const gestionnaires = {}
    ;[...evenementsWindow, ...evenementsDocument].forEach((nom) => {
      gestionnaires[nom] = surEvenement(nom)
    })
    evenementsWindow.forEach((nom) => window.addEventListener(nom, gestionnaires[nom]))
    evenementsDocument.forEach((nom) => document.addEventListener(nom, gestionnaires[nom]))

    // Sondage indépendant de tout événement : si le Centre de contrôle ne
    // suspend pas vraiment l'exécution JS, cette boucle continue de tourner
    // et détecte un changement de navigator.onLine même si aucun événement
    // 'online'/'offline' n'est jamais délivré.
    let dernierEnLigne = navigator.onLine
    let compteur = 0
    const sonde = setInterval(() => {
      compteur += 1
      if (navigator.onLine !== dernierEnLigne) {
        journaliser('sondage-changement', { ancien: dernierEnLigne, nouveau: navigator.onLine })
        dernierEnLigne = navigator.onLine
      } else if (compteur % BATTEMENT_TOUS_LES === 0) {
        journaliser('sondage-battement')
      }
    }, INTERVALLE_SONDAGE_MS)

    return () => {
      desabonner()
      evenementsWindow.forEach((nom) => window.removeEventListener(nom, gestionnaires[nom]))
      evenementsDocument.forEach((nom) => document.removeEventListener(nom, gestionnaires[nom]))
      clearInterval(sonde)
    }
  }, [])

  const dernieres = journal.slice(-12).reverse()

  const copier = async () => {
    const texte = journal
      .map(
        (e) =>
          `${e.n}. ${e.horodatage} — ${e.evenement}` +
          (e.ancien !== undefined ? ` (${e.ancien}→${e.nouveau})` : '') +
          ` — onLine=${e.enLigne} visible=${e.visibilite}`
      )
      .join('\n')
    try {
      await navigator.clipboard.writeText(texte)
      alert('Journal copié — colle-le dans le message.')
    } catch {
      alert("Copie automatique impossible — fais une capture d'écran à la place.")
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/90 text-white text-[10px] font-mono leading-snug p-2 max-h-52 overflow-y-auto">
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="font-bold">
          ⚠ Diag réseau — onLine={String(navigator.onLine)} visible={document.visibilityState}
        </span>
        <div className="flex gap-3 flex-shrink-0">
          <button onClick={copier} className="underline">Copier</button>
          <button onClick={viderJournal} className="underline">Vider</button>
        </div>
      </div>
      {dernieres.length === 0 && <div className="opacity-60">Aucune entrée pour l'instant.</div>}
      {dernieres.map((e) => (
        <div key={e.n}>
          {e.n}. {e.horodatage.slice(11, 23)} — {e.evenement}
          {e.ancien !== undefined ? ` (${String(e.ancien)}→${String(e.nouveau)})` : ''} — onLine=
          {String(e.enLigne)} vis={e.visibilite}
        </div>
      ))}
    </div>
  )
}
