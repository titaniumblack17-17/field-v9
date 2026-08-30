import React, { Suspense, useEffect, useRef, useState } from 'react'
// Clients reste chargé d'un bloc : c'est le tout premier écran, autant ne
// pas ajouter un aller-retour réseau avant même de le voir apparaître. Les
// autres écrans ne se chargent qu'une fois qu'on y navigue — auparavant,
// tout partait dans un seul paquet, même pour n'ouvrir que le Brief.
import ClientList from './screens/ClientList'
const ClientDetail = React.lazy(() => import('./screens/ClientDetail'))
const ClientForm = React.lazy(() => import('./screens/ClientForm'))
const Capture = React.lazy(() => import('./screens/Capture'))
const DossierForm = React.lazy(() => import('./screens/DossierForm'))
const DossierDetail = React.lazy(() => import('./screens/DossierDetail'))
const Pipeline = React.lazy(() => import('./screens/Pipeline'))
const BriefSoir = React.lazy(() => import('./screens/BriefSoir'))
const Catalogue = React.lazy(() => import('./screens/Catalogue'))
import useConfirm from './hooks/useConfirm'
import { tailleFile, ecouterTailleFile, viderFile } from './lib/fileAttente'
import { supabase } from './lib/supabaseClient'
import { assurerRappelDeRelance } from './lib/rappel'
import { verifierConnexionReelle } from './lib/reseau'
import { diagnosticActif, journaliser } from './lib/diagnosticReseau'
import DiagnosticReseau from './components/DiagnosticReseau'

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

// Sans repère de connexion, un écran qui ne charge pas ressemblait à une
// panne — rien ne disait « c'est le réseau, pas l'app ». En visite, une
// coupure passagère (cave, ascenseur, parking) est courante ; ce bandeau
// dit tout de suite ce qui se passe, et disparaît de lui-même au retour du
// signal — les boutons Réessayer déjà posés sur chaque écran font le reste.
function useEnLigne() {
  const [enLigne, setEnLigne] = useState(navigator.onLine)
  useEffect(() => {
    const surLigne = () => setEnLigne(true)
    const horsLigne = () => setEnLigne(false)
    // Resynchronise l'état réel à chaque retour au premier plan. Ne relit
    // plus navigator.onLine : bug WebKit documenté et toujours ouvert
    // (bugs.webkit.org #171277, #225645) — la propriété reste bloquée sur sa
    // dernière valeur connue pendant une coupure réelle en PWA installée
    // iOS (mode avion via le Centre de contrôle), confirmé sur le device de
    // Bruce. Seule une requête réseau réelle dit la vérité.
    const auRetour = async () => {
      if (document.visibilityState !== 'visible') return
      // Journalisation ciblée (voir diagnosticReseau.js) : distingue
      // « l'événement visibilitychange est arrivé » (déjà visible dans le
      // panneau) de « notre gestionnaire s'est exécuté et a appelé la
      // sonde » — les deux ne sont pas forcément la même chose.
      const diag = diagnosticActif()
      if (diag) journaliser('useEnLigne:sonde-debut')
      const debut = performance.now()
      const reel = await verifierConnexionReelle()
      if (diag) journaliser('useEnLigne:sonde-fin', { resultat: reel, duree_ms: Math.round(performance.now() - debut) })
      setEnLigne(reel)
    }
    window.addEventListener('online', surLigne)
    window.addEventListener('offline', horsLigne)
    document.addEventListener('visibilitychange', auRetour)
    return () => {
      window.removeEventListener('online', surLigne)
      window.removeEventListener('offline', horsLigne)
      document.removeEventListener('visibilitychange', auRetour)
    }
  }, [])
  return enLigne
}

// L'exécuteur ne sait rien encore à ce stade (Tâche 6 seule) — les Tâches
// 7-9 ajoutent un cas à ce switch à chaque action câblée sur la file.
async function executerActionEnFile(action) {
  switch (action.type) {
    case 'note': {
      await supabase.from(action.table).insert(action.payload)
      return
    }
    case 'etape': {
      await supabase.from('dossiers').update({ statut: action.statut }).eq('id', action.dossierId)
      await assurerRappelDeRelance(action.dossierId, action.statut)
      return
    }
    default:
      throw new Error(`Type d'action inconnu : ${action.type}`)
  }
}

function useFileAttente(enLigne) {
  const [taille, setTaille] = useState(() => tailleFile())

  useEffect(() => ecouterTailleFile(setTaille), [])

  useEffect(() => {
    if (enLigne && taille > 0) {
      viderFile(executerActionEnFile)
    }
  }, [enLigne])

  // Filet de secours indépendant de `enLigne` : si l'événement 'online' ET
  // l'événement 'offline' ont tous deux été manqués pendant une suspension
  // (voir useEnLigne ci-dessus), `enLigne` peut ne jamais avoir changé de
  // valeur dans cette session — l'effet au-dessus ne se redéclenche alors
  // jamais. On revérifie donc l'état réel directement ici à chaque retour au
  // premier plan, via une requête réseau réelle plutôt que navigator.onLine
  // (bloqué sur sa dernière valeur connue dans ce contexte — voir
  // useEnLigne). `taille` lue en direct dans le stockage plutôt que depuis
  // la fermeture de cet effet, pour ne jamais rater une action mise en file
  // entre-temps.
  useEffect(() => {
    const auRetour = async () => {
      if (document.visibilityState !== 'visible' || tailleFile() === 0) return
      const diag = diagnosticActif()
      if (diag) journaliser('useFileAttente:sonde-debut')
      const debut = performance.now()
      const reel = await verifierConnexionReelle()
      if (diag) journaliser('useFileAttente:sonde-fin', { resultat: reel, duree_ms: Math.round(performance.now() - debut) })
      if (reel) viderFile(executerActionEnFile)
    }
    document.addEventListener('visibilitychange', auRetour)
    return () => document.removeEventListener('visibilitychange', auRetour)
  }, [])

  return taille
}

export default function App() {
  const enLigne = useEnLigne()
  const tailleFileAttente = useFileAttente(enLigne)

  // Panneau de diagnostic temporaire (voir DiagnosticReseau.jsx) — inerte en
  // usage normal, ne se monte que derrière ?debug=reseau dans l'URL. Lu une
  // seule fois : ce diagnostic ne suit pas une navigation en cours de
  // session, seulement l'URL d'ouverture de l'app.
  const [diagReseauActif] = useState(diagnosticActif)

  // Pile d'écrans doublée d'entrées dans l'historique du navigateur : le swipe
  // natif iOS et le bouton Retour du navigateur reviennent d'un écran, sans
  // geste maison qui entrerait en conflit avec le glisser-déposer du Pipeline.
  const [stack, setStack] = useState([{ name: 'list' }])
  const view = stack[stack.length - 1]

  // Le swipe est un geste réflexe : sans garde-fou, quitter une fiche modifiée
  // mais non enregistrée perdrait la saisie sans un mot.
  const modifieRef = useRef(false)
  const [confirmer, boîteConfirmation] = useConfirm()

  // window.confirm ne s'affiche jamais dans une PWA en plein écran ajoutée à
  // l'écran d'accueil : le garde-fou semblait alors ne rien faire, alors
  // qu'il bloquait silencieusement toute sortie de fiche modifiée.
  const confirmerAbandon = async () => {
    if (!modifieRef.current) return true
    const quitter = await confirmer(
      'Vous avez des modifications non enregistrées. Quitter cette fiche sans les enregistrer ?',
      { titre: 'Quitter sans enregistrer ?', confirmLabel: 'Quitter' }
    )
    if (quitter) modifieRef.current = false
    return quitter
  }

  useEffect(() => {
    const onPop = async () => {
      if (!(await confirmerAbandon())) {
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

  const push = async (v) => {
    if (!(await confirmerAbandon())) return
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

  // Assigné plutôt que retourné directement pour pouvoir accrocher la boîte
  // de confirmation (quitter sans enregistrer) à toutes les vues sans la
  // répéter à chaque branche.
  let écran

  if (view.name === 'detail') {
    écran = (
      <ClientDetail
        client={view.client}
        onBack={back}
        onDirtyChange={signalerModif}
        onNewDossier={(client) => push({ name: 'dossier-create', client })}
        onOpenDossier={(dossier) => push({ name: 'dossier-detail', dossier })}
      />
    )
  } else if (view.name === 'create') {
    écran = (
      <ClientForm
        onCancel={back}
        onCreated={(client) => replace({ name: 'detail', client })}
      />
    )
  } else if (view.name === 'capture') {
    écran = (
      <Capture
        onBack={back}
        onOpenClient={(client) => replace({ name: 'detail', client })}
        onOpenDossier={(dossier) => push({ name: 'dossier-detail', dossier })}
      />
    )
  } else if (view.name === 'brief') {
    écran = (
      <BriefSoir
        onBack={back}
        onOpenDossier={(dossier) => push({ name: 'dossier-detail', dossier })}
      />
    )
  } else if (view.name === 'pipeline') {
    écran = (
      <Pipeline
        onBack={back}
        onOpenDossier={(dossier) => push({ name: 'dossier-detail', dossier })}
        onCreate={() => push({ name: 'create' })}
      />
    )
  } else if (view.name === 'catalogue') {
    écran = <Catalogue onBack={back} />
  } else if (view.name === 'dossier-create') {
    écran = (
      <DossierForm
        client={view.client}
        onCancel={back}
        onCreated={(dossier) => replace({ name: 'dossier-detail', dossier })}
      />
    )
  } else if (view.name === 'dossier-detail') {
    écran = (
      <DossierDetail
        dossier={view.dossier}
        onBack={back}
        onDirtyChange={signalerModif}
        onOpenClient={(client) => push({ name: 'detail', client })}
      />
    )
  } else {
    écran = (
      <ClientList
        onSelect={(client) => push({ name: 'detail', client })}
        onCreate={() => push({ name: 'create' })}
        onCapture={() => push({ name: 'capture' })}
        onPipeline={() => push({ name: 'pipeline' })}
        onBrief={() => push({ name: 'brief' })}
        onCatalogue={() => push({ name: 'catalogue' })}
      />
    )
  }

  // Pensé pour un téléphone, l'app s'étirait bord à bord sur un grand écran
  // Mac — des lignes de champs et de listes larges de plus d'un mètre,
  // illisibles. Le Pipeline fait exception : son kanban défile
  // horizontalement et a besoin de toute la largeur disponible.
  const largeurLibre = view.name === 'pipeline'

  const attente = <p className="text-texte-faible text-sm p-4">Chargement…</p>

  return (
    <>
      {!enLigne && (
        <div className="sticky top-0 z-30 bg-erreur text-white text-xs font-medium text-center py-1.5">
          Hors ligne — reconnexion automatique dès que possible
        </div>
      )}
      {tailleFileAttente > 0 && (
        <div className="sticky top-0 z-30 bg-alerte text-white text-xs font-medium text-center py-1.5">
          {tailleFileAttente} action{tailleFileAttente > 1 ? 's' : ''} en attente d'envoi
        </div>
      )}
      <Suspense fallback={attente}>
        {largeurLibre ? écran : <div className="max-w-2xl mx-auto">{écran}</div>}
      </Suspense>
      {boîteConfirmation}
      {diagReseauActif && <DiagnosticReseau />}
    </>
  )
}
