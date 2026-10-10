import React from 'react'
import useBoardData from '../hooks/useBoardData'
import {
  BoardEntete,
  BoardHaut,
  BoardJauge,
  BoardListes,
  BoardQualite,
  BoardFeuilles,
} from '../components/BoardAffichage'
import Dashboard from './Dashboard'

// Accueil unique : « Aujourd'hui » (tout le contenu utile du Board, mêmes
// données, mêmes règles, un seul calcul) puis « Pilotage » (le Dashboard).
// L'ancien Board reste accessible par « Ancien accueil » en pied de page.
export default function Accueil({ onOpenDossier, onOpenClient, onClients, onPipeline, onCapture, onAncienAccueil }) {
  const b = useBoardData()
  return (
    <div className="min-h-screen bg-fond">
      <BoardEntete
        b={b}
        onOpenClient={onOpenClient}
        onClients={onClients}
        onPipeline={onPipeline}
        onCapture={onCapture}
      />
      <main className="px-4 pb-8">
        <section aria-label="Aujourd'hui">
          <h1 className="text-lg font-bold text-texte mt-1">Aujourd'hui</h1>
          <BoardHaut b={b} onPipeline={onPipeline} onOpenDossier={onOpenDossier} />
          <BoardListes b={b} onPipeline={onPipeline} />
        </section>

        <section aria-label="Pilotage" className="mt-10">
          <h1 className="text-lg font-bold text-texte">Pilotage</h1>
          <Dashboard integre onOpenDossier={onOpenDossier} onPipeline={onPipeline} />
          <BoardJauge b={b} />
          <BoardQualite b={b} />
        </section>

        <div className="mt-10 flex justify-center">
          <button onClick={onAncienAccueil} className="min-h-11 px-4 text-xs text-texte-faible underline">
            Ancien accueil
          </button>
        </div>
      </main>
      <BoardFeuilles b={b} onOpenDossier={onOpenDossier} />
    </div>
  )
}
