import React, { useState } from 'react'
import ClientList from './screens/ClientList'
import ClientDetail from './screens/ClientDetail'
import ClientForm from './screens/ClientForm'
import Capture from './screens/Capture'

export default function App() {
  const [view, setView] = useState({ name: 'list' })

  if (view.name === 'detail') {
    return <ClientDetail client={view.client} onBack={() => setView({ name: 'list' })} />
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

  return (
    <ClientList
      onSelect={(client) => setView({ name: 'detail', client })}
      onCreate={() => setView({ name: 'create' })}
      onCapture={() => setView({ name: 'capture' })}
    />
  )
}
