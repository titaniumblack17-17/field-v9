# Sécurité — temps B (activer RLS) : plan, NON appliqué

État au 17/10/2026 (comptes de lignes relevés en lecture seule le 10/11/2026) : le temps A (connexion par code, session persistante) est livré sur `feat/auth-connexion-code-otp`.
**Rien de ce document n'a été exécuté.** Les fichiers SQL de ce dossier sont volontairement hors de `supabase/migrations/`.

## Pourquoi cet ordre et ce découpage
Aujourd'hui toute table est lisible et modifiable avec la clé publique (`anon`), qui est visible dans l'app. Le temps B enlève ce droit
à `anon` et ne laisse que l'utilisateur connecté (Bruce). Une mauvaise bascule coupe l'app : on le fait **table par table**, de la moins
critique à la plus critique, avec une vérification et un retour arrière prêt à chaque étape.

## Préalables (à faire AVANT la première table)
1. **Temps A en production et éprouvé** : connexion par code reçue et saisie sur le vrai iPhone ET sur le Mac, session conservée après
   fermeture de l'app, hors ligne puis retour du réseau, plusieurs jours d'usage sans re-saisie de code.
2. **Désactiver les inscriptions publiques** dans Supabase (Authentication → Sign In / Providers → désactiver « Allow new users to sign up »).
   Sans cela, n'importe qui peut obtenir un compte `authenticated`. Le second verrou `est_bruce()` limite de toute façon l'accès à l'adresse de Bruce.
3. **Réglage du courrier de code** (Authentication → Email Templates → « Magic Link ») : le gabarit doit contenir `{{ .Token }}` (le code à 6 chiffres)
   et non seulement le lien. Durée de validité du code et limite d'envoi : à vérifier (défaut 1 h, 1 envoi par minute).
4. **Sauvegarde** : export de la base avant la première bascule (Supabase → Database → Backups, ou `pg_dump`).
5. **Consommateurs de la clé publique à migrer d'abord** : voir le tableau ci-dessous. Préparation faite sur la branche
   `feat/securite-temps-b-preparation` (aucune base touchée) : scripts et e2e lisent `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local`
   (ignoré par git) et retombent sur la clé publique avec un avertissement si elle est absente — rien ne change tant que RLS est désactivé.
6. **Fournir la clé de service** : la copier (Supabase → Settings → API → `service_role`) dans `.env.local` sous `SUPABASE_SERVICE_ROLE_KEY=`.
   Jamais dans `.env`, jamais préfixée `VITE_`, jamais collée dans le chat ni commitée.

## Consommateurs de la clé publique (recensement)
| Consommateur | Clé utilisée aujourd'hui | Tables / fonctions touchées | Action à prévoir |
|---|---|---|---|
| Application (navigateur, iPhone/Mac) | publique + jeton de session (temps A) | toutes | Rien : la session de Bruce passe la politique `est_bruce()` ; temps réel inclus |
| `scripts/completer-fiches-web.mjs` | publique | `clients` (lecture/écriture), `carnet_contacts` ; Edge `client-web-lookup` | Données : clé de service (fait, repli public). Appel Edge : reste en clé publique (jeton JWT valide, la fonction a sa propre clé de service) |
| `scripts/lister-fiches-incompletes.mjs` | publique | `clients` (lecture) | Clé de service (fait) |
| `scripts/peupler-carnet.mjs` | publique | `carnet_contacts` (supprime tout puis insère) | Clé de service (fait). ⚠ fenêtre entre suppression et insertion : à ne pas interrompre |
| `scripts/importer-contacts-mac.mjs` | publique | `clients`, `carnet_contacts` | Clé de service (fait) |
| `scripts/importer-catalogue-planmeca.mjs` | publique | `produits` | Clé de service (fait) |
| e2e (19 fichiers `e2e/*.spec.js`) | publique (`e2e/cle.js`) | fixtures ZZTEST : `clients`, `dossiers`, `rappels`, `fichiers`, `dossier_*`, RPC `dashboard_chiffres` | Fixtures : clé de service via `e2e/cle.js` (fait, repli public). Application sous test : voir ci-dessous |
| `e2e/connexion.spec.js` | publique (réécrit l'en-tête `Authorization`) | auth | Garder en clé publique : il teste justement le cas sans droits |
| `e2e/cors.spec.js` | aucune clé (pré-vérifications CORS) | Edge | Rien |
| Widget iPhone (Scriptable) | publique, en clair dans le script | RPC `widget_chiffres_board()` (security definer) | Jeton dédié : `widget_jeton.sql` (proposition), puis `revoke execute … from anon` |
| Raccourci Mac « Field V9 — Board » | publique, en clair dans le `curl` | idem | Idem (même jeton ou jeton distinct) |
| Edge Functions (`capture-intake`, `client-web-lookup`, `devis-montant`, `devis-montant-v2`, `entreprise-lookup`, `todoist-rappel`, `todoist-tache`) | `SUPABASE_SERVICE_ROLE_KEY` (secret serveur) | selon la fonction | Non concernées par RLS. `verify_jwt=false` sur plusieurs : temps C |
| Tâches `pg_cron` (voir ci-dessous) | aucune (appel HTTP sans en-tête) / rôle `postgres` | Edge + `prendre_instantane_pipeline()` | Voir « Tâches planifiées » |
| Tâches locales Claude (Plaud) | aucune clé du dépôt (MCP) | — | Rien dans le dépôt ; à vérifier au premier passage après bascule |

**Application sous test (e2e)** : elle tourne en mode « sans connexion » (clé publique, sans session). Une fois `clients`/`dossiers` protégés,
elle ne verra plus rien. Deux options : (a) `E2E_APP_CLE_SERVICE=1` injecte la clé de service dans le serveur de dev de test local (opt-in ; ne valide
PAS les politiques, seulement le reste de l'app) ; (b) recommandé avant la bascule de `clients`/`dossiers` : une vraie session de test créée via l'API
admin (non écrite à ce jour — à décider avec Bruce). Les e2e n'ont pas été lancés pendant cette préparation.

## Tâches planifiées
| Tâche | Où | Horaire | Ce qu'elle appelle | Effet de RLS | Action |
|---|---|---|---|---|---|
| `todoist-taches-echues-quotidien` (job 1) | pg_cron | 06:00 quotidien | Edge `todoist-tache` (balayer) + `loupe-relances-echues` (en-tête uniquement `Content-Type`) | Fonctions à clé de service : aucun effet | Vérifier le lendemain de chaque bascule que `loupe_runs` s'écrit |
| `loupe-dossiers-dormants-quotidien` (job 2) | pg_cron | 07:00 quotidien | Edge `loupe-dossiers-dormants` (dryRun) | idem | idem |
| `loupe-rapport-hebdo-lundi` (job 4) | pg_cron | lundi 06:00 | Edge `loupe-rapport-hebdo` (dryRun: false) → écrit `rapport_hebdo` | idem ; `rapport_hebdo` basculée en 3ᵉ | Vérifier le lundi suivant la bascule |
| `loupe-audit-integrite-dimanche` (job 6) | pg_cron | dimanche 06:00 | Edge `loupe-audit-integrite` (dryRun: true) | idem | idem |
| `pipeline-snapshot-quotidien` (job 7) | pg_cron | 21:30 quotidien | SQL `prendre_instantane_pipeline()` → écrit `pipeline_snapshots` | Tourne avec le rôle du job (propriétaire de la tâche) : à confirmer qu'il contourne RLS (`select rolbypassrls from pg_roles where rolname = current_user` dans une tâche de test) | Avant de basculer `pipeline_snapshots` ; sinon rendre la fonction `security definer` |
| `plaud-scan-hebdo` | local (Claude) | lundi ~07:14 | transcriptions Plaud | aucune clé du dépôt | Rien |
| `plaud-point-quotidien` | local (Claude) | ~07:36 quotidien | idem | idem | Rien |
Remarques : (1) aucune « loupe Plaud 20 h » n'existe : les tâches Plaud réelles sont celles ci-dessus ; (2) les appels pg_cron vers les fonctions Edge n'envoient
aucun jeton → ces fonctions ont `verify_jwt=false` (sujet du temps C : n'importe qui connaissant l'URL peut les déclencher).

## Inventaire des tables (schéma `public`)
| Table | RLS aujourd'hui | Lignes ≈ | Temps réel |
|---|---|---|---|
| captures | non | 21 | oui |
| carnet_contacts | non | 7 556 | non |
| client_notes | non | 30 | oui |
| clients | non | 123 | oui |
| dossier_etapes_historique | non | 194 | non |
| dossier_financement | non | 11 | oui |
| dossier_financement_historique | non | 20 | non |
| dossier_note_taches | non | 41 | oui |
| dossier_notes | non | 328 | oui |
| dossiers | non | 134 | oui |
| fichiers | non | 97 | oui |
| materiel | non | 4 | oui |
| pipeline_snapshots | non | 646 | oui |
| produits | non | 8 009 | non |
| rappels | non | 106 | oui |
| rapport_hebdo | non | 10 | non |
| loupe_memoire (1 politique de lecture publique, à revoir) | déjà active | 63 | non |
| loupe_runs (aucune politique : fermée) | déjà active | 183 | non |

Stockage : bucket privé `documents` (25 Mo max) — 3 politiques `storage.objects` ouvertes à `anon` et `authenticated` (envoi, lecture, suppression).
Widget : proposition de jeton dédié dans `widget_jeton.sql` (non appliquée) pour pouvoir retirer `execute` à `anon`.
Fonctions SQL : toutes en `security invoker` (donc soumises à RLS avec le rôle de l'appelant), sauf `widget_chiffres_board()` (security definer).

## Politique proposée (identique pour toutes les tables)
```sql
alter table public.<table> enable row level security;
create policy "<table>_bruce" on public.<table> for all to authenticated
  using (public.est_bruce()) with check (public.est_bruce());
```
`public.est_bruce()` = l'e-mail du jeton est `titaniumblack17@gmail.com`. `anon` n'a plus aucun droit sur ces tables.

## Ordre de bascule (du moins critique au plus critique)
1. `produits` — catalogue (8 009 lignes), lecture seule côté app
2. `carnet_contacts` — carnet d'adresses importé (7 556 lignes)
3. `rapport_hebdo` — rapports générés
4. `pipeline_snapshots` — instantané quotidien du pipeline (écrit par un déclencheur / tâche planifiée)
5. `dossier_etapes_historique` — journal des étapes, écrit par déclencheur
6. `dossier_financement_historique` — journal du financement, écrit par déclencheur
7. `materiel` — matériel installé par cabinet
8. `captures` — dictées / captures
9. `client_notes` — notes de fiche client
10. `dossier_note_taches` — tâches des notes
11. `rappels` — rappels (liés à Todoist)
12. `dossier_notes` — notes de dossier
13. `dossier_financement` — financements (temps réel)
14. `fichiers` — documents (+ bucket de stockage « documents »)
15. `clients` — fiches clients
16. `dossiers` — dossiers (cœur : à basculer en dernier)
17. Stockage `documents` (avec la bascule de `fichiers`, ou juste après).

**À chaque étape :**
1. Exécuter la section de la table dans `appliquer_par_table.sql` (une seule table à la fois).
2. Vérifier l'accès fermé : `node scripts/verifier-rls.mjs <table>` (clé publique seule, `limit=1`) → doit répondre `[]` (RLS filtre) ou une erreur, jamais des lignes. Écrit, **non exécuté** à ce jour.
3. Vérifier l'accès ouvert : dans l'app connectée (Mac puis iPhone), l'écran qui lit/écrit cette table fonctionne ; le temps réel de la table continue d'arriver.
4. Suite e2e complète (avec clé de service pour les fixtures) à 390 et 1280.
5. Si un doute : section correspondante de `retour_arriere.sql`, puis analyse.
6. Attendre une journée d'usage réel avant la table suivante pour les tables des étapes 7 à 16.

## Points d'attention connus
- **Temps réel** : avec RLS, les événements `postgres_changes` ne sont délivrés qu'aux connexions dont le jeton passe la politique ; le client envoie déjà le jeton de l'utilisateur (temps A). Un jeton périmé hors ligne : le rejeu de la file renouvelle d'abord le jeton (déjà fait au temps A).
- **Déclencheurs et fonctions `security invoker`** (journaux, recalcul du montant, instantané) s'exécutent avec le rôle de l'appelant : leurs tables cibles doivent avoir leur politique (c'est pourquoi les journaux sont inclus). L'instantané quotidien (`prendre_instantane_pipeline`) tourne sous un rôle de service/cron : à vérifier au moment de `pipeline_snapshots`.
- **`dashboard_chiffres()`** (invoker) lit presque toutes les tables : à basculer en dernier avec `dossiers`/`clients`, sinon le Pilotage affiche des zéros pendant la transition.
- **Appel hors ligne sans session** : impossible une fois RLS active (l'app exige une session locale — c'est le comportement du temps A).
- **Retour arrière** : `retour_arriere.sql` (par table). Il ne touche à aucune donnée.
