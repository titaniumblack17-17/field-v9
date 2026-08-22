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

## Pipeline et Brief — 22/08 après-midi

- Barre d'étapes au-dessus du Kanban : libellé, nombre, appui pour s'y rendre.
  Treize étapes peuplées faisaient sept écrans de balayage sur iPhone. La barre
  suit le défilement, pas le dernier appui.
- Étapes vides masquées, `Dossier perdu` replié derrière une pastille.
- Rappels lisibles et colorés : rouge échu, orange sous huit jours, bleu au-delà.
  Pas de vert, qui se lirait « réglé ».
- Coche « rappel fait » dans le Brief : efface la date, retire la tâche Todoist,
  écrit au journal.
- SAV : quatre statuts (ouvert, en cours, en attente, clos) et un champ
  « en attente de quoi », visible dans le Brief.

## Ce qui reste ouvert

**Décisions qui vous appartiennent**
- Doublons à trancher : `Matheu` / `Matheu-Cohen`, `Alakian` / `Patrice Alakian`
- Cumul des devis à cocher : Pricop (995 € affiché au lieu de 193 635 €),
  Alakian (1 150 + 8 290)
- Cinq devis à variantes, montant à saisir à la main : Grunberg, Mimoune,
  Alakian MHC, Alakian SNC, Perez-Grassano Viso G1
- Vider les projets Todoist `🎯 Pipeline actif` et `📐 Plans & remboursements`,
  désormais recopiés dans Field

**Question de fond — alimentation du SAV**

Un seul dossier SAV pour 77 clients équipés : Bruce confirme qu'il en gère
davantage, mais qu'ils n'entrent pas dans Field. Le suivi est prêt, la section
restera vide tant que le canal d'entrée n'est pas trouvé. Piste évoquée le
22/08, non décidée : passer par la capture vocale, déjà utilisée debout, plutôt
que par un écran à ouvrir.

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
