import React, { useEffect, useRef, useState } from 'react'
import ClientList from './screens/ClientList'
import ClientDetail from './screens/ClientDetail'
import ClientForm from './screens/ClientForm'
import Capture from './screens/Capture'
import DossierForm from './screens/DossierForm'
import DossierDetail from './screens/DossierDetail'
import Pipeline from './screens/Pipeline'

export default function App() {
  // Pile d'écrans doublée d'entrées dans l'historique du navigateur : le swipe
  // natif iOS et le bouton Retour du navigateur reviennent d'un écran, sans
  // geste maison qui entrerait en conflit avec le glisser-déposer du Pipeline.
  const [stack, setStack] = useState([{ name: 'list' }])
  const view = stack[stack.length - 1]

  // Le swipe est un geste réflexe : sans garde-fou, quitter une fiche modifiée
  // mais non enregistrée perdrait la saisie sans un mot.
  const modifieRef = useRef(false)

  const confirmerAbandon = () => {
    if (!modifieRef.current) return true
    const quitter = window.confirm(
      'Vous avez des modifications non enregistrées. Quitter cette fiche sans les enregistrer ?'
    )
    if (quitter) modifieRef.current = false
    return quitter
  }

  useEffect(() => {
    const onPop = () => {
      if (!confirmerAbandon()) {
        // On était déjà revenu d'un cran : on ré-empile pour rester sur place.
        window.history.pushState(null, '')
        return
      }
      setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const signalerModif = (d) => {
    modifieRef.current = d
  }

  const push = (v) => {
    if (!confirmerAbandon()) return
    window.history.pushState(null, '')
    setStack((s) => [...s, v])
  }

  // Remplace l'écran courant sans empiler : la profondeur d'historique reste
  // alignée sur la pile.
  const replace = (v) => setStack((s) => [...s.slice(0, -1), v])

  const back = () => {
    if (stack.length > 1) window.history.back()
  }

  if (view.name === 'detail') {
    return (
      <ClientDetail
        client={view.client}
        onBack={back}
        onDirtyChange={signalerModif}
        onNewDossier={(client) => push({ name: 'dossier-create', client })}
        onOpenDossier={(dossier) => push({ name: 'dossier-detail', dossier })}
      />
    )
  }

  if (view.name === 'create') {
    return (
      <ClientForm
        onCancel={back}
        onCreated={(client) => replace({ name: 'detail', client })}
      />
    )
  }

  if (view.name === 'capture') {
    return <Capture onBack={back} />
  }

  if (view.name === 'pipeline') {
    return (
      <Pipeline
        onBack={back}
        onOpenDossier={(dossier) => push({ name: 'dossier-detail', dossier })}
      />
    )
  }

  if (view.name === 'dossier-create') {
    return (
      <DossierForm
        client={view.client}
        onCancel={back}
        onCreated={back}
      />
    )
  }

  if (view.name === 'dossier-detail') {
    return <DossierDetail dossier={view.dossier} onBack={back} onDirtyChange={signalerModif} />
  }

  return (
    <ClientList
      onSelect={(client) => push({ name: 'detail', client })}
      onCreate={() => push({ name: 'create' })}
      onCapture={() => push({ name: 'capture' })}
      onPipeline={() => push({ name: 'pipeline' })}
    />
  )
}
