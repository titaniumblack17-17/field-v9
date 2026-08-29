---
name: prospect-research
description: Recherche et qualifie un cabinet dentaire avant un premier contact commercial — praticien, spécialité(s), taille et ancienneté du cabinet, associés, équipement probable, angle d'approche. S'appuie sur l'edge function client-web-lookup de Field V9 plutôt que de dupliquer une recherche web. Réservé à la vente d'équipement dentaire (Bruce Da Silva, Île-de-France).
---

# Prospect Research

## When to Activate

Activer avant un premier contact (appel, e-mail, visite non planifiée) avec
un cabinet dentaire pas encore qualifié dans Field V9, ou pour compléter la
qualification d'un prospect déjà en fiche mais encore pauvre en
informations.

**Ne pas activer** pour : compléter une fiche client déjà bien renseignée
(le bouton « Chercher sur le web » de la fiche, ou le passage automatique à
la création, suffisent — voir Integration) ; rédiger l'e-mail de prospection
lui-même (voir `email-prospection`) ; qualifier un dossier déjà engagé dans
le pipeline (voir `opportunites-a-risque` pour le suivi, `sales-strategy`
pour MEDDIC).

## Core Concepts

La qualification commerciale ajoute une couche par-dessus la recherche
factuelle déjà automatisée dans Field V9 : au-delà de l'identité et des
coordonnées, ce qui détermine si un prospect vaut la démarche —

- **Signal d'investissement probable** — cabinet récemment créé ou repris,
  associé qui s'ajoute, mention de travaux ou d'agrandissement : autant de
  moments où un équipement neuf devient pertinent.
- **Mauvais moment probable** — équipement visiblement récent (site web,
  avis récents mentionnant du matériel neuf), cabinet en fin d'activité
  proche (âge du praticien, absence de succession visible).
- **Taille et structure** — praticien seul ou cabinet de groupe (change
  qui décide, voir MEDDIC dans `sales-strategy`), nombre de fauteuils
  probable.
- **Angle d'approche** — spécialité(s) du praticien orientent quelles
  marques du portefeuille mettre en avant en premier (voir
  `email-prospection`).

## Practical Guidance

1. Vérifier d'abord si le cabinet a déjà une fiche Field V9 — si oui,
   regarder ce qu'elle contient avant de relancer une recherche.
2. Pour une fiche absente ou pauvre, s'appuyer sur `client-web-lookup`
   (l'edge function existante) pour l'identité et les coordonnées ; ce
   skill se concentre sur l'interprétation commerciale des résultats, pas
   sur une nouvelle recherche web parallèle.
3. Chercher spécifiquement les signaux d'investissement/de mauvais moment
   ci-dessus, que `client-web-lookup` ne cherche pas (il vise
   l'identification, pas la qualification commerciale).
4. Restituer une fiche de qualification courte : identité confirmée,
   signal principal repéré, angle d'approche recommandé, niveau de
   confiance sur chaque point.

## Examples

*Recherche demandée : "Dr Martin, dentiste à Melun, jamais contacté."*

Résultat attendu : confirmation d'identité (via `client-web-lookup` si pas
déjà en fiche), puis qualification — "Cabinet ouvert en 2024 d'après
Doctolib (signal fort : équipement probablement encore incomplet ou en
phase d'ajout), praticien seul, aucune mention de spécialité orthodontique
donc angle omnipratique à privilégier en premier contact."

## Gotchas

- Ne pas sur-rechercher : un praticien a une présence digitale plus pauvre
  qu'une entreprise classique (pas de site "à propos" détaillé, peu de
  réseaux pro) — accepter un niveau de confiance moyen plutôt que
  multiplier les recherches sans résultat.
- Un cabinet récent n'est pas automatiquement un bon prospect équipement —
  vérifier qu'il ne vient pas justement d'être équipé à neuf.
- Distinguer taille du cabinet réelle (fauteuils, associés) et taille de sa
  présence en ligne (les deux ne sont pas corrélées).

## Integration

En aval de `client-web-lookup` (édge function Field V9) pour l'identité et
les coordonnées factuelles — ne pas dupliquer cette recherche. En amont de
`email-prospection` (l'angle d'approche qualifié ici détermine le contenu
de l'e-mail) et de `sales-strategy` (MEDDIC, une fois le premier contact
engagé).

## References

Aucune référence dédiée — s'appuie sur les données déjà structurées de
Field V9 (table `clients`, edge function `client-web-lookup`) plutôt que
sur un corpus statique.
