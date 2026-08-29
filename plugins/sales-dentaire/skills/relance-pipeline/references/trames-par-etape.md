# Trames de relance par étape du pipeline

Les 17 étapes de `ETAPES_PROJET` (src/constants/dossiers.js), avec pour
chacune : le type de relance pertinent, le ton, et ce qu'elle doit
contenir. Étapes sans relance commerciale marquées explicitement.

---

## À classer

Colonne d'attente technique (import Notion sans équivalent direct) — pas
une étape commerciale. **Pas de relance** : ce dossier doit d'abord être
reclassé dans une vraie étape avant toute action.

## Prospect

**Type.** Relance de découverte. **Ton.** Curieux, léger, sans pression.
**Contenu.** Rappeler le contexte du premier contact (signal repéré via
`prospect-research` si disponible), une question ouverte pour relancer
l'échange — pas de proposition chiffrée à ce stade.

## Prise de contact

**Type.** Relance de qualification. **Ton.** Direct mais pas commercial.
**Contenu.** S'appuyer sur ce qui a été dit au premier échange, poser la
question qui manque pour avancer (besoin précis, calendrier, budget
approximatif) — objectif : passer à Devis à faire, pas encore vendre.

## Devis à faire

Étape interne (le devis n'est pas encore parti) — **pas de relance client**
à ce stade, c'est un rappel pour Bruce lui-même (voir Brief Soir dans
Field V9), pas une communication vers le praticien.

## Devis envoyé

**Type.** Relance factuelle. **Ton.** Professionnel, pas insistant.
**Contenu.** Rappel court du contenu du devis (montant, éléments clés),
question ouverte sur d'éventuelles questions ou points à ajuster — première
relance après envoi, pas encore de cadre de persuasion appuyé.

## Relance

Étape dédiée du pipeline — dossier déjà relancé une fois sans réponse
ferme. **Type.** Relance avec cadre. **Ton.** Toujours respectueux, plus
direct. **Contenu.** Combiner avec `sales-strategy` — Challenger (recadrer
avec un élément nouveau) ou Goulston (nommer l'absence de réponse sans
reproche) selon le contexte. Si cette étape se prolonge sans réponse malgré
plusieurs relances, consulter `opportunites-a-risque`.

## Visite local

**Type.** Relance logistique. **Ton.** Pratique. **Contenu.** Confirmer ou
reprogrammer le rendez-vous de visite, préciser ce qui sera vérifié sur
place — pas de contenu commercial, la visite elle-même en est le moment.

## Négociation

**Type.** Relance orientée décision. **Ton.** Direct, cadre BATNA/Voss en
tête (voir `sales-strategy`). **Contenu.** Reprendre le point de blocage
identifié, proposer une évolution concrète (configuration, délai,
financement) plutôt qu'une remise pure.

## Confirmation

**Type.** Relance de clôture. **Ton.** Factuel, rassurant. **Contenu.**
Récapituler les termes convenus, lever les derniers doutes, aucune nouvelle
négociation à ce stade — l'objectif est de sécuriser l'accord, pas de le
rouvrir.

## Commande

**Type.** Suivi opérationnel. **Ton.** Logistique. **Contenu.** Confirmer
la commande passée, délais fournisseur, prochaines étapes — **pas de
relance commerciale**, le dossier est gagné.

## Réunion de chantier

**Type.** Suivi opérationnel. **Ton.** Coordination. **Contenu.** Confirmer
date/présence, prérequis techniques (accès, raccordements) — **pas de
relance commerciale**.

## Installation

**Type.** Suivi opérationnel. **Ton.** Rassurant, disponible. **Contenu.**
Confirmer la date d'intervention, ce qui est attendu du cabinet ce
jour-là — **pas de relance commerciale**.

## Finition

**Type.** Suivi opérationnel. **Ton.** Clôture technique. **Contenu.**
Vérifier que tout fonctionne, recueillir un retour — **pas de relance
commerciale**, mais un bon moment pour une preuve sociale future (avis,
référence) si la relation le permet.

## Financement

**Type.** Suivi administratif. **Ton.** Factuel. **Contenu.** Relance sur
un paiement ou un dossier de financement en cours — **pas une relance
commerciale**, un rappel de gestion.

## Terminé

Dossier soldé et réglé. **Pas de relance**, sauf reprise de contact
générale hors contexte de vente (fidélisation, nouvelle opportunité future
identifiée séparément).

## Dossier perdu

**Pas de relance directe.** Un devis qui revient après 30 jours de silence
devient un nouveau dossier — l'ancien reste Perdu, jamais réactivé
directement.

## SAV

**Type.** Relance de suivi d'intervention. **Ton.** Orienté résolution de
problème, pas commercial. **Contenu.** Statut de l'intervention, prochaine
étape technique — une bonne résolution SAV est un moment de confiance à
noter pour une future relance commerciale, mais la relance SAV elle-même
reste focalisée sur le problème en cours.
