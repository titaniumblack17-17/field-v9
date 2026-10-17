import React, { useRef } from 'react'
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
import { libelleVersion } from '../lib/version'

// Accueil unique : « Aujourd'hui » (tout le contenu utile du Board, mêmes
// données, mêmes règles, un seul calcul) puis « Pilotage » (le Dashboard).
// L'ancien Board reste accessible par « Ancien accueil » en pied de page.
export default function Accueil({ onOpenDossier, onOpenClient, onClients, onPipeline, onProjets, onCapture, onAncienAccueil, onReglages }) {
  const b = useBoardData()
  // Une seule liste « à trancher » : la ligne d'Aujourd'hui ouvre la feuille du Pilotage.
  const ouvrirPilotage = useRef(null)
  return (
    <div className="min-h-screen bg-fond">
      <BoardEntete
        b={b}
        onOpenClient={onOpenClient}
        onClients={onClients}
        onPipeline={onPipeline}
        onProjets={onProjets}
        onCapture={onCapture}
      />
      <main className="px-4 pb-8">
        <section aria-label="Aujourd'hui">
          <h1 className="text-lg font-bold text-texte mt-1">Aujourd'hui</h1>
          <BoardHaut b={b} onPipeline={onPipeline} onOpenDossier={onOpenDossier} />
          <BoardListes b={b} onPipeline={onPipeline} onTrancher={() => ouvrirPilotage.current?.('trancher')} />
        </section>

        <section aria-label="Pilotage" className="mt-10">
          <h1 className="text-lg font-bold text-texte">Pilotage</h1>
          <Dashboard integre ouvrirRef={ouvrirPilotage} onOpenDossier={onOpenDossier} onPipeline={onPipeline} onProjets={onProjets} />
          <BoardJauge b={b} />
          <BoardQualite b={b} />
        </section>

        <div className="mt-10 flex justify-center gap-2">
          <button onClick={onAncienAccueil} className="min-h-11 px-4 text-xs text-texte-faible underline">
            Ancien accueil
          </button>
          {onReglages && (
            <button onClick={onReglages} className="min-h-11 px-4 text-xs text-texte-faible underline">
              Réglages
            </button>
          )}
        </div>
        <p data-testid="version" className="mt-2 text-center text-[11px] text-texte-faible tabular-nums">{libelleVersion()}</p>
      </main>
      <BoardFeuilles b={b} onOpenDossier={onOpenDossier} onProjets={onProjets} />
    </div>
  )
}
