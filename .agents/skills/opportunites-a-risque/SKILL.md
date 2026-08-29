---
name: opportunites-a-risque
description: Identifie les dossiers du pipeline Field V9 qui stagnent, ont un rappel en retard, ou risquent d'être perdus faute de mouvement — liste priorisée avec la raison du risque et l'action recommandée. À activer pour une revue de portefeuille, pas pour le suivi d'un dossier isolé. Réservé à la vente d'équipement dentaire, Field V9.
---

# Opportunités à Risque

## When to Activate

Activer pour une revue de portefeuille ("quels dossiers sont à risque ?",
avant une session de relances groupées, ou en complément du Brief Soir déjà
existant dans Field V9).

**Ne pas activer** pour : produire la relance elle-même une fois un dossier
à risque identifié (voir `relance-pipeline`) ; qualifier un prospect avant
tout contact (voir `prospect-research`) ; le suivi quotidien des rappels
échus (déjà couvert par l'écran Brief Soir de Field V9 — ce skill le
complète en repérant la stagnation silencieuse, pas les rappels déjà
signalés).

## Core Concepts

Un dossier à risque se repère par un des signaux suivants, ou leur
combinaison :

- **Stagnation dans l'étape** — temps passé dans l'étape actuelle sans
  changement de statut, au-delà d'un seuil qui dépend de l'étape (voir
  Guidelines — seuils proposés à valider avec Bruce, pas encore calibrés
  sur des données réelles).
- **Rappel en retard** — un rappel non fait dont la date est dépassée.
- **Devis envoyé sans relance programmée** — l'étape Devis envoyé ou
  Relance sans aucun rappel à venir : le dossier peut glisser sans que
  personne ne s'en aperçoive.
- **Échéance d'objectif qui approche** — un dossier ouvert de montant
  significatif alors que l'exercice se referme au 31 décembre, sans
  mouvement récent.

## Practical Guidance

1. Parcourir les dossiers ouverts (hors Terminé, Dossier perdu) avec leur
   étape, date de dernier mouvement, rappel associé.
2. Appliquer les seuils de stagnation ci-dessous (proposition initiale,
   à ajuster avec Bruce sur retour d'usage).
3. Prioriser la liste : rappel en retard d'abord (le plus visible et le
   plus urgent), puis stagnation avancée, puis devis sans relance
   programmée.
4. Pour chaque dossier signalé, proposer une action concrète — relancer
   (voir `relance-pipeline`), requalifier (revoir avec MEDDIC dans
   `sales-strategy` si le dossier est-il seulement mal engagé), ou marquer
   perdu si le signal est net.

## Guidelines — seuils proposés (à valider)

Seuils de stagnation par étape, proposition initiale sans donnée réelle
pour les calibrer — à ajuster une fois utilisés :

| Étape | Seuil proposé |
|---|---|
| Prospect, Prise de contact | 15 jours sans mouvement |
| Devis à faire | 5 jours (c'est une tâche interne, pas une attente client) |
| Devis envoyé, Relance | 10 jours sans relance programmée |
| Visite local, Négociation, Confirmation | 15 jours |
| Commande, Réunion de chantier, Installation, Finition, Financement | pas de seuil de risque commercial — un retard ici est opérationnel, pas un signal de perte |

## Gotchas

- Un dossier stable en Commande ou Installation n'est pas "à risque" même
  s'il ne bouge pas depuis longtemps — la vente est faite, ce qui reste
  est logistique (voir `relance-pipeline`).
- Ne pas confondre stagnation et rythme naturel du secteur (un cabinet en
  travaux, voir l'objection correspondante dans `sales-strategy`, peut
  légitimement rester en pause plusieurs semaines sans être un dossier
  perdu).
- Les seuils ci-dessus sont une hypothèse de départ, pas une vérité
  mesurée — à corriger au fil de l'usage plutôt qu'à traiter comme figés.

## Integration

Complète le Brief Soir de Field V9 (qui couvre les rappels échus au jour
le jour) en repérant la stagnation silencieuse qu'aucun rappel n'a
signalée. Alimente `relance-pipeline` (action de relance) et
`sales-strategy` (MEDDIC pour requalifier un dossier douteux).

## References

Aucune référence dédiée — s'appuie sur les données du pipeline Field V9
(table `dossiers`, `rappels`) plutôt que sur un corpus statique.
