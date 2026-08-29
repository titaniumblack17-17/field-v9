# Mode hors-ligne minimal

29/08/2026. Voir [PASSATION.md](../../../PASSATION.md).

## Pourquoi

Field V9 est utilisé debout, sur iPhone, entre deux cabinets — exactement
les conditions où le réseau manque le plus. Aujourd'hui, sans réseau, l'app
ne peut rien faire : pas de lecture depuis un cache, pas de file d'écriture
en attente. Une dictée, une note ou un changement d'étape fait hors-ligne se
perd purement et simplement.

## Ce que ce mode couvre

1. **Lecture** : une fiche déjà consultée pendant la session reste lisible
   sans réseau.
2. **Écriture** : une action faite hors-ligne (dictée, note, changement de
   statut) part en file d'attente et s'envoie automatiquement au retour du
   réseau — jamais de perte de saisie.

## Hors périmètre (explicitement)

- Pas de synchronisation bidirectionnelle temps réel hors-ligne.
- Pas de résolution de conflits avancée — le dernier écrit gagne, exactement
  comme aujourd'hui en ligne. Si le même dossier a changé ailleurs pendant la
  coupure, l'écriture en attente écrase simplement la valeur, sans fusion ni
  alerte.
- Pas de mise en cache de tout le CRM — seulement ce qui a été ouvert
  pendant la session en cours.
- Pas de file d'écriture universelle sur toutes les mutations de l'app —
  seulement les trois actions citées (dictée/capture, note, changement
  d'étape).

## Point à trancher avant de coder : le shell de l'app

Sans aucun service worker, la mise en cache de lecture (point 1) ne survit
**que tant que l'onglet reste ouvert en mémoire**. Si Safari décharge
l'onglet en arrière-plan (fréquent sur iOS) ou si Bruce recharge la page
hors-ligne, le navigateur ne peut même pas charger `index.html`/le bundle
JS — écran blanc, quel que soit le cache de données construit par ailleurs.

Deux options, à trancher avant de commencer :

- **A — Sans service worker** : le mode hors-ligne ne fonctionne que dans
  l'onglet resté ouvert depuis la dernière connexion. Le plus simple, mais
  fragile dans le scénario réel (verrouillage du téléphone entre deux
  cabinets peut décharger l'onglet).
- **B — Service worker minimal, juste pour le shell** : ~15-20 lignes,
  cache uniquement `index.html` + les bundles JS/CSS via l'API Cache
  native (pas de Workbox, pas de stratégies de cache par route, pas de
  synchronisation en arrière-plan) — juste de quoi recharger l'app hors
  ligne. Ce n'est pas le service worker complexe exclu du périmètre — c'est
  le minimum pour que le reste ait un sens dans le scénario réel.

**Recommandation : B.** Sans lui, le mode hors-ligne ne couvre que le cas
où Bruce ne quitte jamais l'onglet — peu représentatif de son usage
réel décrit dans CLAUDE.md.

## Approche technique

### Lecture — cache local léger

Pas besoin d'IndexedDB/Dexie : les volumes sont petits (une fiche client +
quelques dossiers = quelques Ko), `localStorage` (limite ~5-10 Mo) suffit
largement pour "ce qui a été ouvert récemment".

- À chaque lecture réussie d'une fiche client ou d'un dossier, écrire sa
  version en `localStorage` sous une clé namespacée (`fv9:client:<id>`,
  `fv9:dossier:<id>`), avec horodatage.
- Borner le cache aux N dernières fiches consultées (ex. 30) pour rester
  loin de la limite de `localStorage` — purge simple des entrées les plus
  anciennes au-delà du seuil.
- À l'échec réseau d'une lecture, retomber sur la version en cache si elle
  existe, avec un indicateur visuel clair ("Version hors ligne du
  <date/heure>") — jamais silencieux, pour que Bruce sache que ce qu'il
  regarde peut être périmé.
- Périmètre concret : fiche client (`ClientDetail`), dossier
  (`DossierDetail`), et la liste de dossiers déjà chargée dans `Pipeline` —
  pas la liste complète des clients (trop volumineuse pour un cache
  "juste ce qui a été ouvert", et de toute façon la recherche a besoin du
  serveur).

### Écriture — file d'attente

- Sur échec réseau d'une des trois actions ciblées (dictée via
  `capture-intake`, ajout de note, changement d'étape/statut), au lieu de
  simplement afficher une erreur : ajouter l'action à une file dans
  `localStorage` (`fv9:file-attente`, tableau de `{type, payload,
  horodatage}`).
- `useEnLigne` existe déjà (écoute `online`/`offline`) — sur passage en
  ligne, déclencher le vidage de la file : rejouer chaque action dans
  l'ordre via les mêmes appels Supabase déjà utilisés en ligne, retirer de
  la file au succès, garder (retenter plus tard) à l'échec.
- Petit indicateur d'UI ("3 actions en attente d'envoi") tant que la file
  n'est pas vide — pour que Bruce sache qu'une saisie hors-ligne n'est pas
  perdue, juste pas encore partie.
- La file survit à un rechargement de page (contrairement à un état en
  mémoire) puisqu'elle vit en `localStorage` — c'est ce qui garantit
  qu'aucune saisie ne se perd même si l'app redémarre avant le retour du
  réseau.

## Estimation

| Bloc | Complexité | Temps |
|---|---|---|
| Cache de lecture (localStorage + fallback + purge) | Faible | 0,5–1 jour |
| File d'écriture (3 actions ciblées + vidage au retour réseau + indicateur) | Moyenne | 1–1,5 jour |
| Service worker minimal (shell only, option B ci-dessus) | Faible | 0,5 jour |
| **Total** | | **2–3 jours** (sans B) / **2,5–3,5 jours** (avec B, recommandé) |

## Ce que ça ne résout pas (à accepter dès le départ)

- Une écriture en attente qui échoue de façon répétée (ex. le dossier a été
  supprimé entre-temps) reste dans la file indéfiniment sans intervention —
  prévoir au minimum un moyen de la voir et de l'abandonner manuellement,
  même sommaire.
- Aucune fusion si la même fiche a changé des deux côtés pendant la
  coupure — le dernier écrit gagne, à charge pour Bruce de vérifier après
  coup si le doute existe.
