import { useEffect, useRef } from 'react'

// Empêche l'écran de se mettre en veille tant que `actif` est vrai — pensé
// pour la dictée : la dictée native iOS est liée au focus du champ, et une
// mise en veille la coupe net, sans avertissement pour Bruce.
//
// Compatibilité (vérifiée avant d'écrire ce fichier, même prudence que pour
// `scrollend` dans Pipeline.jsx) : l'API existe sur Safari iOS/iPadOS à
// partir de la version 16.4 (mars 2023) et sur Safari macOS 16.4 — mais pas
// du tout sur Firefox. On vérifie donc sa présence avant d'appeler quoi que
// ce soit ; à défaut, pas de verrou, la dictée continue normalement, juste
// sans protection contre la veille.
//
// PIÈGE SPÉCIFIQUE PWA INSTALLÉE — Field V9 est ajoutable à l'écran
// d'accueil (voir le commentaire sur window.confirm dans App.jsx) : sur iOS
// avant la version 18.4, l'API échoue *silencieusement* dans ce mode précis
// (Home Screen Web App) — `request()` résout avec un WakeLockSentinel
// parfaitement valide, mais l'écran se met quand même en veille
// (WebKit #254545, corrigé le 31/03/2025 par iOS/iPadOS 18.4). Aucun moyen
// détectable en JS de distinguer ce cas d'un vrai succès : ni erreur, ni
// rejet, ni événement — le verrou a l'air pris et ne protège rien. Ouvert
// dans Safari (pas installé), ça fonctionne dès 16.4. Si Bruce utilise
// l'icône sur son écran d'accueil avec un iOS antérieur à 18.4, ce
// correctif ne changera rien à son problème malgré un code qui semble
// fonctionner — seul un test sur son iPhone, dans son usage réel, le dira.
//
// Le verrou est aussi relâché par le système dès que la page passe en
// arrière-plan (verrouillage de l'écran, changement d'app) — sans effet
// pratique ici puisque la dictée s'interrompt de toute façon dans ce cas,
// mais il faut le redemander explicitement au retour au premier plan si la
// saisie est toujours active, sans quoi l'écran repart en veille au bout du
// délai normal.
const disponible = typeof navigator !== 'undefined' && 'wakeLock' in navigator

// Délai avant une nouvelle tentative après un échec de (ré)acquisition, et
// nombre de tentatives avant d'abandonner — voir le commentaire dans
// `demander` ci-dessous pour le bug de terrain que ça corrige.
const NOUVELLE_TENTATIVE_MS = 2000
const TENTATIVES_MAX = 5

export default function useWakeLock(actif) {
  const verrouRef = useRef(null)

  useEffect(() => {
    if (!disponible || !actif) return

    let annulé = false
    let tentative = 0
    let minuteur = null

    const demander = async () => {
      if (annulé || verrouRef.current) return
      try {
        const verrou = await navigator.wakeLock.request('screen')
        if (annulé) {
          // La saisie s'est terminée pendant que la promesse était en vol.
          verrou.release().catch(() => {})
          return
        }
        tentative = 0
        verrouRef.current = verrou
        verrou.addEventListener('release', () => {
          // Ne nettoie que si c'est bien CE verrou qui vient d'être relâché —
          // un nouveau (redemandé entre-temps) ne doit pas être écrasé par
          // l'écouteur de l'ancien.
          if (verrouRef.current === verrou) verrouRef.current = null
        })
      } catch {
        // Bug de terrain (07/09) : sur un deuxième changement d'orientation
        // pendant la même dictée, la réacquisition peut échouer pour une
        // raison transitoire (constaté par test : l'API rejette aussi si
        // appelée avant que `visibilitychange` ne soit revenu à « visible »,
        // et rien ne garantit que ce retour arrive après notre tentative
        // plutôt qu'avant) — le document est alors déjà visible, donc plus
        // aucun `visibilitychange` à venir pour redéclencher `demander` via
        // `surVisibilité`. Reproduit précisément : sans cette relance, un
        // seul échec transitoire laissait la dictée sans protection pour le
        // reste de la saisie, quel que soit le nombre de changements
        // d'orientation suivants. Bornée (TENTATIVES_MAX) : un refus
        // vraiment permanent (batterie faible…) ne doit pas marteler l'API.
        if (annulé || tentative >= TENTATIVES_MAX) return
        tentative += 1
        minuteur = setTimeout(() => {
          if (!annulé && !verrouRef.current && document.visibilityState === 'visible') demander()
        }, NOUVELLE_TENTATIVE_MS)
      }
    }

    demander()

    const surVisibilité = () => {
      if (document.visibilityState === 'visible' && !verrouRef.current) demander()
    }
    document.addEventListener('visibilitychange', surVisibilité)

    return () => {
      annulé = true
      if (minuteur) clearTimeout(minuteur)
      document.removeEventListener('visibilitychange', surVisibilité)
      verrouRef.current?.release().catch(() => {})
      verrouRef.current = null
    }
  }, [actif])
}
