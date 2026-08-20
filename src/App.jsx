import React, { useState } from 'react'
import ClientList from './screens/ClientList'
import ClientDetail from './screens/ClientDetail'
import ClientForm from './screens/ClientForm'
import Capture from './screens/Capture'
import DossierForm from './screens/DossierForm'
import DossierDetail from './screens/DossierDetail'

export default function App() {
  const [view, setView] = useState({ name: 'list' })

  if (view.name === 'detail') {
    return (
      <ClientDetail
        client={view.client}
        onBack={() => setView({ name: 'list' })}
        onNewDossier={(client) => setView({ name: 'dossier-create', client })}
        onOpenDossier={(dossier) => setView({ name: 'dossier-detail', dossier, client: view.client })}
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
        onBack={() => setView({ name: 'detail', client: view.client })}
      />
    )
  }

  return (
    <ClientList
      onSelect={(client) => setView({ name: 'detail', client })}
      onCreate={() => setView({ name: 'create' })}
      onCapture={() => setView({ name: 'capture' })}
    />
  )
}
