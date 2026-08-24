import React, { useEffect, useRef, useState } from 'react'
import ClientList from './screens/ClientList'
import ClientDetail from './screens/ClientDetail'
import ClientForm from './screens/ClientForm'
import Capture from './screens/Capture'
import DossierForm from './screens/DossierForm'
import DossierDetail from './screens/DossierDetail'
import Pipeline from './screens/Pipeline'
import BriefSoir from './screens/BriefSoir'

// Balayage depuis le bord gauche pour revenir. Le geste natif d'iOS est
// capricieux sur une application à écran unique, et le défilement horizontal
// du Pipeline le capte de toute façon : on le gère donc nous-mêmes.
// Déclenchement volontairement étroit — départ collé au bord, trajet nettement
// horizontal — pour ne jamais se confondre avec un défilement ou un glissé.
function useSwipeRetour(actif, onRetour) {
  useEffect(() => {
    if (!actif) return

    let departX = null
    let departY = 0

    const debut = (e) => {
      const t = e.touches[0]
      departX = t.clientX <= 28 ? t.clientX : null
      departY = t.clientY
    }
    const fin = (e) => {
      if (departX === null) return
      const t = e.changedTouches[0]
      const dx = t.clientX - departX
      const dy = Math.abs(t.clientY - departY)
      departX = null
      if (dx > 70 && dy < 50) onRetour()
    }
    // iOS émet touchcancel quand il prend la main pour son propre geste :
    // on abandonne alors, pour ne pas revenir deux fois.
    const annule = () => {
      departX = null
    }

    document.addEventListener('touchstart', debut, { passive: true })
    document.addEventListener('touchend', fin, { passive: true })
    document.addEventListener('touchcancel', annule, { passive: true })
    return () => {
      document.removeEventListener('touchstart', debut)
      document.removeEventListener('touchend', fin)
      document.removeEventListener('touchcancel', annule)
    }
  }, [actif, onRetour])
}

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

  // Filet contre un double retour si le geste natif d'iOS s'est déclenché en
  // plus du nôtre.
  const dernierRetourRef = useRef(0)

  const profond = stack.length > 1

  const back = React.useCallback(() => {
    if (!profond) return
    const maintenant = Date.now()
    if (maintenant - dernierRetourRef.current < 600) return
    dernierRetourRef.current = maintenant
    window.history.back()
  }, [profond])

  // Pas de balayage sur le Pipeline : on y fait glisser des cartes
  // horizontalement, et le tableau défile lui-même de gauche à droite.
  useSwipeRetour(profond && view.name !== 'pipeline', back)

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
    return (
      <Capture
        onBack={back}
        onOpenClient={(client) => replace({ name: 'detail', client })}
        onOpenDossier={(dossier) => push({ name: 'dossier-detail', dossier })}
      />
    )
  }

  if (view.name === 'brief') {
    return (
      <BriefSoir
        onBack={back}
        onOpenDossier={(dossier) => push({ name: 'dossier-detail', dossier })}
      />
    )
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
    return (
      <DossierDetail
        dossier={view.dossier}
        onBack={back}
        onDirtyChange={signalerModif}
        onOpenClient={(client) => push({ name: 'detail', client })}
      />
    )
  }

  return (
    <ClientList
      onSelect={(client) => push({ name: 'detail', client })}
      onCreate={() => push({ name: 'create' })}
      onCapture={() => push({ name: 'capture' })}
      onPipeline={() => push({ name: 'pipeline' })}
      onBrief={() => push({ name: 'brief' })}
    />
  )
}
