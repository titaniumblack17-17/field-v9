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

// « Ancien accueil » : le Board tel qu'il était, conservé le temps que
// l'inventaire soit validé. Tout son contenu vit désormais dans les mêmes blocs
// que la zone « Aujourd'hui » de l'accueil unique (BoardAffichage, useBoardData,
// bilanBoard) : mêmes données, mêmes règles, même N.
export default function BriefSoir({ onOpenDossier, onOpenClient, onClients, onPipeline, onCapture, onDashboard, onBack }) {
  const b = useBoardData()
  return (
    <div className="min-h-screen bg-fond">
      <BoardEntete
        b={b}
        onOpenClient={onOpenClient}
        onClients={onClients}
        onPipeline={onPipeline}
        onCapture={onCapture}
        onDashboard={onDashboard}
        retour={onBack ? { label: 'Accueil', onClick: onBack } : null}
      />
      <main className="px-4 pb-8">
        <BoardHaut b={b} onPipeline={onPipeline} onOpenDossier={onOpenDossier} />
        <BoardJauge b={b} />
        <BoardListes b={b} onPipeline={onPipeline} />
        <BoardQualite b={b} />
      </main>
      <BoardFeuilles b={b} onOpenDossier={onOpenDossier} />
    </div>
  )
}
