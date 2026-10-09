# Inventaire Phase 0 — état au 9 oct. 2026

Aucune modification de code ni de données. Sert de référence « avant » pour les phases suivantes.

## Écrans (`src/screens`, pile d'écrans + historique navigateur dans `App.jsx`)

| Écran | Rôle | Chemin d'accès aujourd'hui |
|---|---|---|
| `BriefSoir` (accueil / Board) | Total remonté, accordéons « À traiter », rappels du jour, Brief du soir, rapport hebdo | Écran par défaut |
| `Pipeline` | 14 étapes, glisser-déposer (dnd-kit), annulation, colonnes Terminé / Perdu repliées | `push({name:'pipeline', vueInitiale, etapeInitiale})` depuis le Board |
| `ClientList` | Liste + recherche clients | Nav principale |
| `ClientDetail` | Fiche client : dossiers, notes, rappels, matériel, pièces jointes, adresse | Depuis liste, Board, Pipeline |
| `ClientForm` | Création / édition client (+ complétion carnet, recherche d'adresse) | Depuis liste / fiche |
| `DossierDetail` | Dossier : étape, SAV (motif d'attente), plan, journal, rappels/tâches/sous-tâches, pièces jointes | Depuis Pipeline, Board, fiche client |
| `DossierForm` | Création / édition dossier | Depuis fiche client / Pipeline |
| `Capture` | Capture / dictée, suggestions de dossier | Nav principale |
| `Catalogue` | Catalogue produits (route conservée, plus de pilule en nav) | Route directe |

Composants partagés : `PiecesJointes` (client **et** dossier), `Rappels`, `NoteTaches`, `NoteTexte`, `MaterielInstalle`, `RechercheWeb`, `SuggestionCapture`, `AccesCabinet`, `JaugeObjectif`, `ChampChoix`, `ChoixClient`, `DiagnosticReseau`.

## Données (Supabase `qgbdhwkdbmplvpflsgdt`, RLS désactivée — ne pas toucher)

Tables : `captures`, `carnet_contacts`, `client_notes`, `clients`, `dossier_note_taches`, `dossier_notes`, `dossiers`, `fichiers`, `loupe_memoire`, `loupe_runs`, `materiel`, `produits`, `rappels`, `rapport_hebdo`.
Realtime : captures, client_notes, clients, dossier_note_taches, dossier_notes, dossiers, fichiers, materiel, rappels.
Storage : bucket privé `documents` (URL signées 60 s).
Fonctions SQL : `horodater_cloture`, `maj_statut_changed_at`, `recalculer_montant_dossier`, `refleter_prochain_rappel`, `sur_changement_devis`, `widget_chiffres_board` (RPC widget, **aucune donnée nominative**).
Cron : `loupe-audit-integrite-dimanche`, `loupe-dossiers-dormants-quotidien`, `loupe-rapport-hebdo-lundi`, `todoist-taches-echues-quotidien`.
Chaîne de triggers `fichiers` : `fichiers_recalcul_montant` → `sur_changement_devis()` → `recalculer_montant_dossier()`.

## Fonctions Edge (prod)

`capture-intake`, `todoist-rappel`, `todoist-tache`, `devis-montant`, `client-web-lookup`, `entreprise-lookup`, `loupe-dossiers-dormants`, `loupe-relances-echues`, `loupe-rapport-hebdo`, `loupe-audit-integrite`, `loupe-memoire-resoudre`, plus deux fonctions de debug (`debug-todoist-check`, `debug-race-client-lookup`) à ne pas toucher dans ce chantier.

## Synchros et hors-ligne

- File hors-ligne : `src/lib/fileAttente.js` (localStorage `fv9:file-attente`), exécuteur `executerActionEnFile` dans `App.jsx` : types `note`, `etape`, `rappel-cloture`, `capture`, `capture-lien`, et génériques `insert` / `update` (`rowId`) / `delete` (`rowId`). Vidage au retour réseau + filet `visibilitychange`, verrou anti-double rejeu.
- Lecture avec cache : `src/lib/cacheLecture.js` (`lireAvecCache`).
- Todoist : rappels uniquement (`todoist-rappel`, `todoist-tache`).
- **Dexie n'est pas utilisé** (absent de `package.json`) ; le stockage hors-ligne est localStorage. Le brief mentionne Dexie par erreur ; rien à adapter.

## SAV « En attente de qui » (à réutiliser tel quel)

- Colonne : `dossiers.bloque_par` (CHECK étendu à `'rdv'`).
- Valeurs (`MOTIFS_ATTENTE_SAV`, `src/constants/dossiers.js`) : `technicien` Technicien · `rdv` Créneau à caler · `fournisseur` Devis fournisseur · `piece` Pièce · `client` Réponse du client · `autre` Autre. « À préciser » = `bloque_par` nul.
- Compteur « En attente depuis N j » : `joursEnAttente(d)` = `floor((now − statut_changed_at) / 86 400 000)`, pour SAV `en_attente` et Projet `devis_envoye` / `relance`. `statut_changed_at` tenu par le trigger `maj_statut_changed_at`. Couleur : `classeAttente` (≥ 10 j orange, ≥ 30 j rouge, sinon bleu ; jamais de vert).
- Consommateurs : `DossierDetail` (sélecteur motif), `Pipeline`, `BriefSoir`.

## Où chaque élément apparaît, et le chemin depuis le Board

| Élément | Apparaît | Chemin depuis le Board |
|---|---|---|
| Devis / fichiers | `PiecesJointes` dans `DossierDetail` et `ClientDetail` | Board → dossier → section pièces jointes |
| Montant dossier | `DossierDetail`, Pipeline (cartes), Board (total) | Board → Pipeline → carte |
| SAV en attente | Board (accordéon), Pipeline (colonne SAV), `DossierDetail` | Board → accordéon SAV → dossier |
| Devis relancés | Board, Pipeline (Devis envoyé / Relance) | Board → Pipeline (étape ciblée) |
| Rappels | Board, `Rappels` dans dossier/client | Board → rappel → dossier |
| Capture / dictée | `Capture`, journal client | Nav principale |
| Brief du soir / rapport hebdo | `BriefSoir` | Board |

## État mesuré de la base (référence « avant » Phase 1)

dossiers : 111 (plan 17, projet 85 dont perdu 6 / terminé 14, sav 9) · clients 106 · dossier_notes 226 · captures 18 · matériel 4 · rappels 73 (14 ouverts) · SAV en attente 2 (motif renseigné 2).
fichiers : 44 · TTC renseigné 25 · somme TTC 1 452 470 · cumulés 2 · erreurs d'analyse 8 · `montant_estime` total des dossiers 2 011 101 (40 non nuls).

## Points d'attention relevés

1. `docs/maquette-board.html` **n'existe pas** (dépôt, branches, Téléchargements, Bureau). Le sous-point (d) « bandeau À appeler / pastilles En attente d'après la maquette » est bloqué en attendant le fichier.
2. Pas de dossier `supabase/migrations` dans le dépôt : les migrations vivent côté base. Je versionnerai les miennes dans `supabase/migrations/` pour que le diff de la PR les montre.
3. Playwright et `gh` ne sont pas installés : parcours iPhone fait avec le navigateur intégré (390 × 844), branche poussée sans PR automatique.
