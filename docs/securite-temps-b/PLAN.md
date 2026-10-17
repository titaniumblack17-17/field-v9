# Sécurité — temps B (activer RLS) : plan, NON appliqué

État au 17/10/2026 : le temps A (connexion par code, session persistante) est livré sur `feat/auth-connexion-code-otp`.
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
5. **Consommateurs de la clé publique à migrer d'abord** (ils cesseront de fonctionner dès qu'une table qu'ils touchent sera protégée) :
   - `scripts/completer-fiches-web.mjs`, `lister-fiches-incompletes.mjs`, `peupler-carnet.mjs`, `importer-contacts-mac.mjs`, `importer-catalogue-planmeca.mjs`
     → passer à une clé de service (variable d'environnement locale, jamais commitée) ou à une session utilisateur ;
   - widget iPhone/Mac (Scriptable) : il appelle `widget_chiffres_board()` (security definer) — il n'est **pas** touché par RLS, à garder tel quel ;
   - tests e2e : ils lisent/écrivent la base avec la clé publique (fixtures ZZTEST) → il faudra une clé de service pour les tests (ou une session de test) avant la bascule de `clients`/`dossiers`.
   - Fonctions Edge : toutes utilisent la clé de service (`SUPABASE_SERVICE_ROLE_KEY`) → non concernées. `verify_jwt=false` sur les fonctions de webhook / loupes : à revoir au temps C (hors périmètre).

## Inventaire des tables (schéma `public`)
| Table | RLS aujourd'hui | Lignes ≈ | Temps réel |
|---|---|---|---|
| captures | non | 18 | oui |
| carnet_contacts | non | 7 556 | non |
| client_notes | non | — | oui |
| clients | non | 108 | oui |
| dossier_etapes_historique | non | 138 | non |
| dossier_financement | non | 6 | oui |
| dossier_financement_historique | non | 10 | non |
| dossier_note_taches | non | 30 | oui |
| dossier_notes | non | 265 | oui |
| dossiers | non | 114 | oui |
| fichiers | non | 66 | oui |
| materiel | non | — | oui |
| pipeline_snapshots | non | 103 | oui |
| produits | non | 8 009 | non |
| rappels | non | 79 | oui |
| rapport_hebdo | non | — | non |
| loupe_memoire (1 politique de lecture publique, à revoir) | déjà active | — | non |
| loupe_runs (aucune politique : fermée) | déjà active | — | non |

Stockage : bucket privé `documents` (25 Mo max) — 3 politiques `storage.objects` ouvertes à `anon` et `authenticated` (envoi, lecture, suppression).
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
2. Vérifier l'accès fermé : `curl` avec la clé publique seule sur `/rest/v1/<table>?select=id&limit=1` → doit répondre `[]` (RLS filtre) ou une erreur, jamais des lignes.
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
