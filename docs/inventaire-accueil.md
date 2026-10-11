# Inventaire du Board → accueil unique

Chaque fonction de l'ancien Board, où elle vit dans l'accueil (`Accueil.jsx` : zone « Aujourd'hui » puis zone « Pilotage »), et le test qui la couvre. L'ancien Board (`BriefSoir.jsx`) reste atteignable par « Ancien accueil » (pied de page) ; il rend les **mêmes blocs** (`BoardAffichage.jsx`) alimentés par le **même calcul** (`useBoardData` → `lib/bilanBoard.js`) : un seul N.

| # | Fonction du Board | Où dans l'accueil | Test |
|---|---|---|---|
| A1 | Recherche rapide client (≤ 8 résultats, ×, relecture complète de la fiche) | En-tête collant, inchangé | accueil A1 |
| A2–A4 | Pastilles Clients / Pipeline / Capture | En-tête collant, cibles passées à 44 px | accueil A2–A4 |
| A5 | Pastille Dashboard | **Disparaît** : le Dashboard est la zone « Pilotage » (pas de pastille « Board » à retirer : il n'y en avait pas) | accueil « ouverture à froid » |
| B1 | Bandeau « Version hors ligne » | Aujourd'hui (+ « Dernières valeurs connues » de Pilotage) | accueil hors-ligne |
| B2 | Tuile Dossiers actifs (projets ni perdus ni terminés) → Pipeline | Aujourd'hui | accueil B2/B5, « Actif » partout |
| B3 | Tuile Objectif % / montant → défile à la jauge | Aujourd'hui ; la jauge détaillée est dans Pilotage | accueil B3 |
| B4 | Tuile À traiter → déplie « Aussi à traiter » | Aujourd'hui | accueil B4 |
| B5 | Tuile SAV ouverts → Pipeline SAV | Aujourd'hui | accueil B2/B5 |
| B6 | Tuile En attente → feuille avec pastilles | Aujourd'hui. La tuile du même nom du Dashboard est **masquée dans l'accueil** (même feuille, même nombre) | accueil B6 |
| B7 | Ligne « N actions à traiter aujourd'hui · M contacts à appeler » | Aujourd'hui | accueil B7 |
| B8 | Bande « À appeler » + bouton Appeler (tel:) | Aujourd'hui | board.spec (bande), accueil B8-B9 |
| B9 | Feuille « À appeler » : Priorité du jour, Plus tard, Appeler, « Aussi à traiter » hors contacts | Aujourd'hui | board.spec (bande, Plus tard), accueil B8-B9 |
| B10 | « Aussi à traiter » : tags, ✓ (jamais sur un devis), ligne secondaire, « Voir les N autres » | Aujourd'hui | accueil B10 ×2 |
| C1–C9 | (« Devis à trancher » ouvre la feuille du Pilotage) Listes À traiter (SAV, Devis sans réponse, À rappeler, Devis à trancher + feuille, Tâches en retard), Production (Rappels à venir, Plans à produire, À chiffrer), Financier (Règlements + ligne € facturables) | Aujourd'hui, mêmes en-têtes | accueil C, C4, board.spec (N devis · M dossiers) |
| D1 | Jauge d'objectif détaillée (projection, signé, facturé, reportables, casquette technique) | Pilotage, sous l'anneau Objectif | accueil D1 |
| D2 | Qualité des données (couverture faible) | Pilotage | accueil D1 |
| D3 | Anomalies détectées (accordéon, « Traité ») | Pilotage | accueil D1 |
| D4 | Rapport hebdo (accordéon) | Pilotage | accueil D1 |
| D5 | Bouton flottant « Retour en haut » | Accueil | accueil D5 |
| E | Gestes et mécanismes : Plus tard (session), ✓ rappel/tâche/SAV, réconciliation rappels/tâches avant lecture, synchro Todoist des tâches en retard, temps réel dossiers/fichiers/tâches, cache hors-ligne | Dans le hook partagé, donc identiques | board.spec, smoke |

## Comportements d'ouverture

- Démarrage à froid : pile `[accueil]`.
- Retour d'arrière-plan après plus de 30 min : retour à l'accueil (jamais si une fiche porte des modifications non enregistrées ; l'historique du navigateur est recalé).
- Retour d'une liste, d'une fiche, du Pipeline, de Capture ou de l'ancien accueil : ramène à l'accueil (libellés « ← Accueil »).
- Liens profonds : l'application n'en avait pas d'autres que l'URL d'ouverture `/` (manifeste PWA, Raccourci/widget Scriptable qui « ouvre l'app ») et `/?debug=reseau` ; les deux ouvrent l'accueil comme avant. Aucune route interne n'existe (pile en mémoire).

## Définitions (alignées, testées dans `e2e/accueil.spec.js`)

| Libellé | Ce que ça compte | Où |
|---|---|---|
| **Actif** | un **projet** ni `perdu` ni `termine`, partout | tuile « Dossiers actifs » (sous-titre « projets, ni perdus ni terminés ») et « projets actifs » du Pilotage : même N (test : tuile = Pilotage = RPC `projets_actifs` = recalcul indépendant) |
| À traiter | rappels dus + SAV ouverts + tâches en retard (sous-titre « rappels, SAV, tâches ») | tuile d'Aujourd'hui |
| N actions à traiter aujourd'hui | éléments urgents triés : rappels dus, SAV ouverts hors « en attente », tâches en retard, devis sans réponse | ligne sous les tuiles ; égale « Aussi à traiter » + 1 et « En retard » du Pilotage |
| En attente | dossiers dont `bloque_par` est renseigné, statut non terminal (« un tiers doit répondre ») | tuile d'Aujourd'hui (celle du Pilotage est masquée dans l'accueil) |
| SAV ouverts | SAV non clos (« dont N en retard ») | tuile d'Aujourd'hui |
| **À trancher** | devis ayant au moins une offre « à trancher » ; N = « N devis · M dossiers » (+ nombre d'offres) | tuile « À trancher » du Pilotage ET ligne « Devis à trancher » d'Aujourd'hui : **la ligne ouvre la feuille du Pilotage** (une seule liste, une ligne par offre), même N (test) |

Reste distinct, par nature : « Objectif » (signé de l'exercice) et la jauge détaillée, « Incomplets » (devis ou CDC manquant).
