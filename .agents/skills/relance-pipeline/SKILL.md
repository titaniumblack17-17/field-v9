---
name: relance-pipeline
description: Génère une relance (e-mail, message, ou script d'appel) adaptée à l'étape précise du dossier dans les 17 étapes du pipeline Field V9 (de À classer à SAV), à partir des données déjà en base (montant, dernier échange, rappel en cours). À activer pour relancer un dossier existant. Réservé à la vente d'équipement dentaire, Field V9.
---

# Relance Pipeline

## When to Activate

Activer pour produire une relance sur un dossier déjà engagé dans le
pipeline Field V9 (Projet, Plan ou SAV), en s'appuyant sur son étape
actuelle et son historique.

**Ne pas activer** pour : un premier contact à froid (voir
`email-prospection`) ; qualifier si un dossier mérite vraiment une relance
ou risque d'être perdu (voir `opportunites-a-risque` — à consulter
d'abord si le doute existe) ; choisir l'angle de persuasion à utiliser dans
la relance (voir `sales-strategy`, à combiner avec ce skill plutôt qu'à la
place).

## Core Concepts

Les 17 étapes de `ETAPES_PROJET` (src/constants/dossiers.js) n'appellent
pas le même type de relance — le détail complet est dans
`references/trames-par-etape.md`, la logique générale :

- **Étapes de qualification** (À classer, Prospect, Prise de contact) —
  relance de découverte, pas de proposition chiffrée.
- **Étapes de proposition** (Devis à faire, Devis envoyé, Relance) —
  relance factuelle sur le contenu du devis, éventuellement un cadre
  Challenger ou Cialdini (voir `sales-strategy`).
- **Étapes de clôture** (Visite local, Négociation, Confirmation) —
  relance orientée décision, ton plus direct.
- **Étapes opérationnelles** (Commande, Réunion de chantier, Installation,
  Finition, Financement) — suivi logistique, pas commercial : confirmer une
  date, un accès, un paiement — jamais de relance commerciale ici.
- **Étapes terminales** (Terminé, Dossier perdu) — pas de relance, sauf
  réactivation explicite d'un devis revenu après 30 jours de silence
  (règle déjà établie : ça devient un nouveau dossier, l'ancien reste
  Perdu).
- **SAV** — relance de suivi d'intervention, ton orienté résolution de
  problème plutôt que commercial.

## Practical Guidance

1. Lire l'étape actuelle du dossier et les données déjà présentes
   (montant, dernier échange en note, rappel en cours) plutôt que de
   demander à Bruce de les redonner.
2. Choisir la trame correspondant à l'étape dans
   `references/trames-par-etape.md`.
3. Si l'étape est opérationnelle (Commande à Financement) ou terminale,
   ne pas produire de relance commerciale — le signaler plutôt que de
   forcer une trame qui ne s'applique pas.
4. Combiner avec un cadre de `sales-strategy` si la relance porte sur une
   objection ou une négociation, pas juste un suivi factuel.

## Gotchas

- Générer une relance commerciale sur un dossier en Installation ou
  Finition — ce sont des étapes de suivi technique, une relance
  commerciale y sonnerait déplacée.
- Relancer un dossier Terminé ou Perdu sans vérifier la règle des 30 jours
  (un devis qui revient après un silence prolongé devient un nouveau
  dossier, pas une réactivation de l'ancien).
- Répéter la même relance à l'identique d'une fois sur l'autre — si le
  dossier est resté trop longtemps sans réponse malgré plusieurs relances,
  c'est un signal à faire remonter (voir `opportunites-a-risque`), pas une
  raison de relancer une troisième fois de la même manière.

## Integration

Consomme les données du pipeline Field V9 (dossiers, étapes, rappels). Se
combine avec `sales-strategy` pour le choix du cadre de persuasion. Doit
être précédé d'un passage par `opportunites-a-risque` si le dossier est
resté longtemps sans mouvement, pour confirmer qu'une relance est la bonne
action plutôt qu'une requalification ou un classement en perdu.

## References

- `references/trames-par-etape.md` — une trame par étape pertinente, avec
  ton et contenu attendus
