# Inventaire du Board → accueil unique

Chaque fonction de l'ancien Board, où elle vit dans l'accueil (`Accueil.jsx` : zone « Aujourd'hui » puis zone « Pilotage »), et le test qui la couvre. L'ancien Board (`BriefSoir.jsx`) reste atteignable par « Ancien accueil » (pied de page) ; il rend les **mêmes blocs** (`BoardAffichage.jsx`) alimentés par le **même calcul** (`useBoardData` → `lib/bilanBoard.js`) : un seul N.

| # | Fonction du Board | Où dans l'accueil | Test |
|---|---|---|---|
| A1 | Recherche rapide client (≤ 8 résultats, ×, relecture complète de la fiche) | En-tête collant, inchangé | accueil A1 |
| A2–A4 | Pastilles Clients / Pipeline / Capture | En-tête collant, cibles passées à 44 px | accueil A2–A4 |
| A5 | Pastille Dashboard | **Disparaît** : le Dashboard est la zone « Pilotage » (pas de pastille « Board » à retirer : il n'y en avait pas) | accueil « ouverture à froid » |
| B1 | Bandeau « Version hors ligne » | Aujourd'hui (+ « Dernières valeurs connues » de Pilotage) | accueil hors-ligne |
| B2 | Tuile Dossiers actifs → Pipeline | Aujourd'hui | accueil B2/B5 |
| B3 | Tuile Objectif % / montant → défile à la jauge | Aujourd'hui ; la jauge détaillée est dans Pilotage | accueil B3 |
| B4 | Tuile À traiter → déplie « Aussi à traiter » | Aujourd'hui | accueil B4 |
| B5 | Tuile SAV ouverts → Pipeline SAV | Aujourd'hui | accueil B2/B5 |
| B6 | Tuile En attente → feuille avec pastilles | Aujourd'hui. La tuile du même nom du Dashboard est **masquée dans l'accueil** (même feuille, même nombre) | accueil B6 |
| B7 | Ligne « N actions à traiter aujourd'hui · M contacts à appeler » | Aujourd'hui | accueil B7 |
| B8 | Bande « À appeler » + bouton Appeler (tel:) | Aujourd'hui | board.spec (bande), accueil B8-B9 |
| B9 | Feuille « À appeler » : Priorité du jour, Plus tard, Appeler, « Aussi à traiter » hors contacts | Aujourd'hui | board.spec (bande, Plus tard), accueil B8-B9 |
| B10 | « Aussi à traiter » : tags, ✓ (jamais sur un devis), ligne secondaire, « Voir les N autres » | Aujourd'hui | accueil B10 ×2 |
| C1–C9 | Listes À traiter (SAV, Devis sans réponse, À rappeler, Devis à trancher + feuille, Tâches en retard), Production (Rappels à venir, Plans à produire, À chiffrer), Financier (Règlements + ligne € facturables) | Aujourd'hui, mêmes en-têtes | accueil C, C4, board.spec (N devis · M dossiers) |
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

## À décider par Bruce avant tout retrait de l'ancien Board

1. Trois « N » coexistent et ne mesurent pas la même chose : tuile « À traiter » (rappels dus + SAV ouverts + tâches en retard), ligne « N actions » / « Aussi à traiter » (éléments urgents, hors SAV en attente, devis sans réponse inclus) et tuile « En retard » du Pilotage (= « N actions », vérifié). Ils sont tous calculés par la même fonction mais gardent leurs définitions d'origine.
2. « À trancher » (tuile du Pilotage) et « Devis à trancher » (liste d'Aujourd'hui) disent la même chose à deux endroits ; seule la tuile « En attente » a été dédoublonnée.
3. Tuile « Dossiers actifs » du Board (projets + plans + SAV) ≠ « projets actifs » du Pipeline du Pilotage (projets seuls).
