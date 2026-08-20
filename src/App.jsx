import React, { useState } from 'react'
import ClientList from './screens/ClientList'
import ClientDetail from './screens/ClientDetail'
import ClientForm from './screens/ClientForm'
import Capture from './screens/Capture'
import DossierForm from './screens/DossierForm'
import DossierDetail from './screens/DossierDetail'
import Pipeline from './screens/Pipeline'

export default function App() {
  const [view, setView] = useState({ name: 'list' })

  if (view.name === 'detail') {
    return (
      <ClientDetail
        client={view.client}
        onBack={() => setView({ name: 'list' })}
        onNewDossier={(client) => setView({ name: 'dossier-create', client })}
        onOpenDossier={(dossier) =>
          setView({ name: 'dossier-detail', dossier, client: view.client, returnTo: 'detail' })
        }
      />
    )
  }

  if (view.name === 'create') {
    return (
      <ClientForm
        onCancel={() => setView({ name: 'list' })}
        onCreated={(client) => setView({ name: 'detail', client })}
      />
    )
  }

  if (view.name === 'capture') {
    return <Capture onBack={() => setView({ name: 'list' })} />
  }

  if (view.name === 'pipeline') {
    return (
      <Pipeline
        onBack={() => setView({ name: 'list' })}
        onOpenDossier={(dossier) =>
          setView({ name: 'dossier-detail', dossier, client: dossier.clients, returnTo: 'pipeline' })
        }
      />
    )
  }

  if (view.name === 'dossier-create') {
    return (
      <DossierForm
        client={view.client}
        onCancel={() => setView({ name: 'detail', client: view.client })}
        onCreated={() => setView({ name: 'detail', client: view.client })}
      />
    )
  }

  if (view.name === 'dossier-detail') {
    return (
      <DossierDetail
        dossier={view.dossier}
        onBack={() =>
          view.returnTo === 'pipeline'
            ? setView({ name: 'pipeline' })
            : setView({ name: 'detail', client: view.client })
        }
      />
    )
  }

  return (
    <ClientList
      onSelect={(client) => setView({ name: 'detail', client })}
      onCreate={() => setView({ name: 'create' })}
      onCapture={() => setView({ name: 'capture' })}
      onPipeline={() => setView({ name: 'pipeline' })}
    />
  )
}
