# Field V9 — état au 22/08/2026

## Phase 1 — Fiche client : terminée

Test de sortie de la spec — « je crée un client sur le Mac, il apparaît sur
l'iPhone sans action manuelle » — satisfait depuis le 20/08 par les
abonnements temps réel Supabase.

La fiche porte : identité du praticien et du cabinet, adresse, quatre moyens
de contact, associés et assistantes, matériel installé, pièces jointes,
dossiers liés, informations annexes, journal des captures, et suppression.

Vérifié le 22/08 depuis l'application, pas seulement en ligne de commande :
- suppression d'un client → dossiers, notes, matériel et fichiers effacés,
  objets retirés du dépôt, tâche Todoist du rappel supprimée
- toutes les cibles tactiles atteignent 44 px
- 77 clients, 75 dossiers en base

## Ce qui reste ouvert

**Décisions qui vous appartiennent**
- Doublons à trancher : `Matheu` / `Matheu-Cohen`, `Alakian` / `Patrice Alakian`
- Cumul des devis à cocher : Pricop (995 € affiché au lieu de 193 635 €),
  Alakian (1 150 + 8 290)
- Cinq devis à variantes, montant à saisir à la main : Grunberg, Mimoune,
  Alakian MHC, Alakian SNC, Perez-Grassano Viso G1
- Vider les projets Todoist `🎯 Pipeline actif` et `📐 Plans & remboursements`,
  désormais recopiés dans Field

**Dette assumée**
- `trouverExistant` (capture-intake) rapproche deux praticiens homonymes dès
  que l'un des deux n'a pas de prénom enregistré. Avec beaucoup de fiches sans
  prénom, le risque de fusion abusive est réel — non corrigé pour ne pas
  recréer l'inverse, la duplication silencieuse.
- `recalculer_montant_dossier` ne remet pas le montant à null quand le dernier
  devis chiffré est supprimé : la saisie manuelle antérieure est préservée.
- Sept dossiers en finition portent une date de clôture approximative
  (rattrapage du 21/08, faute de date d'installation connue).

## Bugs corrigés le 22/08

- **CORS des fonctions Edge** — `todoist-rappel` et `devis-montant`
  n'autorisaient pas `x-client-info`, ajouté par supabase-js. Le contrôle
  préalable échouait et l'appel mourait en « Failed to fetch ». Rappels,
  réconciliation du Brief et lecture des devis étaient morts depuis l'app,
  tout en fonctionnant en curl — ce qui les rendait invisibles.
- **ClientDetail dupliqué cinq fois** — un remplacement de texte non borné
  avait recopié la fonction de suppression à chaque `return (` du fichier,
  dont quatre fois à l'intérieur de useEffect. 836 lignes pour 470 utiles.
- **Suppression fondée sur l'état local** — les dossiers sont relus en base
  avant d'énumérer et de nettoyer.
- **PDF orphelins** — la cascade efface les lignes `fichiers`, pas les objets
  du dépôt. Relevés et retirés, après la base et non avant.
