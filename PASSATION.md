# Field V9 — passation

À coller au début d'une nouvelle conversation. État au 22 août 2026.

## Qui et pourquoi

Bruce Da Silva, commercial indépendant en équipement dentaire en Île-de-France.
27 marques pour Bailleul et So Dental. Objectif annuel 5 M€ TTC.
Field V9 est son CRM personnel, utilisé debout, sur iPhone, entre deux cabinets.

Il a une double casquette : vendeur (ses propres affaires) et technicien
(il produit des plans d'implantation pour d'autres commerciaux, facturés
500 € TTC pièce).

## Stack et accès

- React 18 + Vite 5 + Tailwind 3 — dépôt `~/field-v9`, GitHub `titaniumblack17-17/field-v9`
- Déploiement Vercel automatique à chaque push sur `main` → https://field-v9.vercel.app
- Supabase `qgbdhwkdbmplvpflsgdt` (eu-west-3) : Postgres, Realtime, Storage, Edge Functions
- RLS désactivée — application à usage strictement personnel, assumé
- Serveur de dev : **port 5180**. Attention, `.claude/launch.json` du répertoire de
  travail pointe vers l'ancien projet `field-capture` sur le 5173.

## Ce que l'application fait

**Clients** — liste avec recherche (nom, cabinet, ville), fiche directement
éditable sans mode édition, associés et assistantes, matériel installé,
pièces jointes, informations annexes, journal des captures, suppression, et
fusion de deux fiches en une (dossiers, matériel, pièces jointes et journal
rebasculés, notes et associés concaténés, fiche source supprimée).

**Capture** — dictée ou clavier, analysée par `capture-intake` (Claude Haiku).
Crée une fiche, la complète, ou rattache une note à un client existant. Les
captures non rattachées se relient à la main. Raccourci iOS pour le vocal.

**Dossiers** — trois types : Projet (vente), SAV, Plan. Le type se change en
cours de route. Un projet peut porter un plan d'implantation intégré.

**Pipeline** — Kanban 15 étapes, glisser-déposer et bouton « Déplacer ».
Barre d'étapes cliquable en tête (13 étapes peuplées = 2 700 px de large).
Étapes vides masquées, dossiers perdus repliés.

**Brief soir** — SAV ouverts, rappels échus, rappels à venir, plans à produire,
règlements de plans à encaisser, jauge d'objectif, liste « à chiffrer ».

**Rappels** — plusieurs par dossier, date + heure facultative + objet. Clôture
avec commentaire. Historique consultable. Synchronisés avec Todoist.

**Devis PDF** — un PDF joint à un dossier est lu par `devis-montant`
(Claude Sonnet) qui en extrait le montant TTC, la référence et la date. Le
montant du dossier suit. Un devis remplace par défaut, il ne s'additionne que
si la case « devis complémentaire » est cochée.

**Catalogue** — recherche de produits par nom, code ou modèle. Prix conseillé
et offre en cours côte à côte. Pilote sur la marque Planmeca (2629 produits) ;
les autres marques du portefeuille (27 au total, voir « Qui et pourquoi »)
restent à faire — mais toutes n'ont pas un fichier tarif structuré comme
Planmeca, donc le nombre de marques réellement important-ables au même
format n'est pas encore déterminé. Réimport manuel via
`node scripts/importer-catalogue-planmeca.mjs <chemin du fichier tarif>`.

## Schéma

- `clients` — praticien, cabinet, adresse, téléphones, e-mails, `associes` et
  `assistantes` en jsonb, notes
- `dossiers` — type (projet|sav|plan), statut, montant_estime, date_installation,
  remuneration_type, commercial, plan_statut, bloque_par, closed_at,
  et les reflets `rappel_date` / `rappel_heure` / `rappel_note`
- `rappels` — dossier_id, date, heure, note, fait_at, commentaire, todoist_task_id
- `dossier_notes`, `captures`, `materiel`, `fichiers`
- `produits` — catalogue tarifaire (pilote Planmeca) : marque, modèle, code,
  désignation, instruction, prix conseillé et prix d'offre + sa période,
  fichier source et date d'import ; réimport = remplacement complet de la
  marque, pas d'historique de versions
- `carnet_contacts` — carnet d'adresses Mac (export vCard de Contacts.app)
  importé une fois pour toutes via `scripts/peupler-carnet.mjs` (remplace
  tout le contenu à chaque réimport) ; `capture-intake` s'en sert pour
  compléter automatiquement les fiches créées par dictée. Comblement
  ponctuel des fiches déjà existantes via `scripts/importer-contacts-mac.mjs`
  (aperçu par défaut, `--appliquer` pour écrire) — logique de parsing
  vCard partagée dans `scripts/lib/vcard.mjs`
- Dépôt `documents` (privé, 25 Mo, PDF et images), liens signés 60 s
- `loupe_runs` / `loupe_memoire` — journal d'exécution et mémoire d'erreurs
  des « loupes » (automatisations planifiées type `loupe-dossiers-dormants`).
  `loupe_runs` : RLS activée sans policy (`service_role` uniquement, jamais
  lue par le client). `loupe_memoire` : RLS activée avec une policy SELECT
  ouverte à `anon`/`authenticated` (depuis le 12/09, lue par la section
  « Anomalies détectées » de BriefSoir.jsx) mais **aucune policy d'écriture**
  — le passage à « traité » (`correction_appliquee`) passe par la fonction
  Edge `loupe-memoire-resoudre` (clé `service_role`), jamais une écriture
  directe depuis l'app
- `rapport_hebdo` — semaine (lundi), contenu (texte), cree_le ; sortie de
  `loupe-rapport-hebdo`, **lue par l'app** (BriefSoir à terme) donc RLS
  désactivée comme le reste du schéma applicatif — contrairement à
  `loupe_runs`/`loupe_memoire` ci-dessus, jamais lues côté client

**Déclencheurs**
- `refleter_prochain_rappel` — recopie le prochain rappel non fait sur le dossier
- `horodater_cloture` — pose `closed_at` au passage en finition ou perdu
- `recalculer_montant_dossier` — montant = dernier devis non cumulé + cumulés

## Fonctions Edge

| Nom | Rôle | verify_jwt |
|---|---|---|
| `capture-intake` | analyse une dictée, crée ou complète un client (comble aussi depuis `carnet_contacts`) | false (iOS Shortcuts) |
| `todoist-rappel` | `{rappelId}` synchronise · `{action:'reconcilier'}` rapatrie | true |
| `todoist-tache` | Sous-tâches de note (`dossier_note_taches`) dans Todoist, uniquement au passage en retard (jamais à la création, pour ne pas inonder l'agenda quand plusieurs sous-tâches naissent d'une même note). `{tacheId}` aligne une tâche sur son état actuel : crée si en retard et pas encore liée, ferme si cochée et liée. `{action:'reconcilier'}` rapatrie ce qui a été coché côté Todoist (appelée à l'ouverture de Brief Soir). `{action:'balayer'}` réconcilie puis crée — appelée une fois par jour (6h UTC) par un job `pg_cron` (`todoist-taches-echues-quotidien`, via `pg_net`), le mécanisme fiable qui ne dépend pas de l'ouverture de l'app ; Brief Soir fait en plus un aller immédiat côté client pour un retour instantané. | false (appelée aussi par pg_cron, sans session utilisateur) |
| `devis-montant` | `{fichierId}` lit le total TTC d'un devis PDF | true |
| `client-web-lookup` | `{client_id}` recherche web (spécialités, adresse, associés…), écrit directement les champs vides trouvés avec confiance ; déclenchée en tâche de fond par `capture-intake` à chaque création de client, et sur demande depuis le bouton « Chercher sur le web » de la fiche | true |
| `entreprise-lookup` | `{q, ville, client_id?}` API publique Recherche d'Entreprises (INSEE/SIRENE, gratuite, sans clé) — adresse/CP/ville. Sans `client_id` : liste de candidats (`ClientForm`, `ClientDetail`) — ville exacte suffit, Bruce reste juge. Avec `client_id` (écriture automatique et silencieuse) : ville exacte sans concurrent **ET** NAF candidat commençant par `86.2` (dentaire) — la ville seule ne suffit plus depuis le faux positif « HENRI MARTIN » (location de logements à Saint-Quentin, NAF 68.20B, homonyme par pur hasard d'un vrai praticien). **`capture-intake` n'appelle PAS cette fonction** : un self-call Edge→Edge lancé sous `EdgeRuntime.waitUntil` restait bloqué ~13 s puis échouait sans trace ; la dictée interroge donc l'API gouv en direct (même logique de score et même filtre NAF, dupliqués à dessein, à garder synchro) | true |
| `loupe-dossiers-dormants` | Première des « loupes » (automatisations planifiées, journalisées dans `loupe_runs`/`loupe_memoire`). Détecte les dossiers Projet actifs sans note ni changement d'étape depuis 14 jours (exclut ceux déjà couverts par un rappel ouvert), pose pour chacun un rappel (prochain jour ouvré, jours fériés FR compris — même règle que partout ailleurs) + une note de journal, puis synchronise vers Todoist. `{}` ou tout corps sans `dryRun:false` = **dry-run par défaut** (identifie et journalise dans `loupe_runs`, n'écrit rien) ; `{dryRun:false}` = écriture réelle. Job `pg_cron` quotidien (`loupe-dossiers-dormants-quotidien`, 7h UTC, via `pg_net`, même pattern que `todoist-taches-echues-quotidien`) — **actuellement en dry-run** (`body: {"dryRun": true}`) le temps que Bruce valide quelques jours de log avant de passer à l'écriture réelle | false (appelée par pg_cron, sans session utilisateur) |
| `loupe-relances-echues` | Filet indépendant de l'ouverture de l'app pour les rappels ouverts (`fait_at` null) dont la date est déjà passée : crée leur tâche Todoist via `todoist-rappel` (pas de doublon si `todoist_task_id` déjà posé) **sauf** si le dossier parent est déjà fermé (`termine`/`perdu` pour un projet, `clos` pour un SAV, `solde` pour un plan — vocabulaire par type, `constants/dossiers.js`) : ce cas-là (« rappel orphelin ») n'est jamais corrigé automatiquement, seulement journalisé dans `loupe_memoire` (déduplication par rappel, une seule ligne tant que non traité) pour que Bruce le voie avant toute suppression — même classe de bug que le rappel fantôme de `DossierForm.jsx` (corrigé le 11/09). `{}` = dry-run par défaut pour la création Todoist uniquement (la détection et le journal des orphelins tournent toujours, même en dry-run — c'est une lecture, jamais destructrice) ; `{dryRun:false}` = crée réellement. **Pas de job dédié** : ajoutée au job existant `todoist-taches-echues-quotidien` (6h UTC) comme second `net.http_post`, à la demande de Bruce — écriture réelle validée sur dossiers de test isolés (tâche créée sur le dossier ouvert, absente sur le SAV clos, orphelin journalisé) ; **actuellement en dry-run** dans ce job (`body: {"dryRun": true}`) le temps que Bruce valide quelques jours de log avant de passer à l'écriture réelle sur les données de production | false (appelée par pg_cron, sans session utilisateur) |
| `loupe-rapport-hebdo` | Synthèse texte hebdomadaire du pipeline **Projet uniquement** (pas Plan, pas SAV — première version) : retards (score « jours de retard équivalent » identique à la carte Priorité du jour de BriefSoir — rappel/tâche/devis, pas de SAV ici), dossiers dormants (réutilise `_shared/dormants.ts`, le même module que `loupe-dossiers-dormants` — jamais réécrit), top 3 par valeur, pipeline par étape (les 14 étapes actives, hors `termine`/`perdu`/`sav`), progression vers l'objectif 5 M€ (même logique d'exercice fiscal que BriefSoir). `{}` = dry-run (calcule et renvoie le texte, journalise dans `loupe_runs`, n'écrit pas dans `rapport_hebdo`) ; `{dryRun:false}` = écrit réellement. **Activée en écriture réelle le 12/09** après validation du contenu par Bruce — job `pg_cron` dédié (`loupe-rapport-hebdo-lundi`, lundi 6h UTC, `body: {"dryRun": false}`). Consultée depuis BriefSoir.jsx (section « Rapport hebdo », carte + chevron comme les 7 sections détaillées, dernière ligne de `rapport_hebdo` seulement, pas de temps réel) | false (appelée par pg_cron, sans session utilisateur) |

| `loupe-audit-integrite` | Cinq contrôles de cohérence hebdomadaires, aucune correction automatique — seulement journalisés dans `loupe_memoire` (dédupliqué par objet concerné, une ligne tant que non résolue) : (1) rappels sans dossier parent valide (FK) ; (2) `dossiers.todoist_task_id` (colonne historique, antérieure au passage sur `rappels.todoist_task_id`) pointant vers une tâche Todoist supprimée — vérifie `is_deleted: true` dans le corps de la réponse, **pas** le statut HTTP (Todoist répond 200 même pour une tâche supprimée, jamais 404 — bug corrigé le 12/09, voir plus bas) ; (3) captures avec suggestion SAV/Projet/Plan jamais rattachée depuis plus de 48h ; (4) dossiers Plan sans `remuneration_type` valide (facture/integre/partage) ; (5) rappels encore ouverts dont la date est antérieure à la création de leur dossier (artefact d'import type Gahnassia-Lewin, cf. audit manuel du 12/09 — ceux déjà refermés par un usage normal ne sont pas remontés). `{}` = dry-run (calcule et compte, journalise le résumé dans `loupe_runs`, n'écrit rien dans `loupe_memoire`) ; `{dryRun:false}` = journalise réellement. Testé en dry-run contre les vraies données : **4 anomalies (dossier_todoist_zombie)**, vérifiées indépendamment par requêtes directes à l'API Todoist — les 4 références sont mortes mais sans impact fonctionnel (colonne jamais lue par le code actuel). Les contrôles 1/3/4/5 à 0, vérifiés par SQL direct. Job `pg_cron` dédié (`loupe-audit-integrite-dimanche`, dimanche 6h UTC) — **actuellement en dry-run**. Consultée depuis BriefSoir.jsx (section « Anomalies détectées », carte + chevron, bouton « Marquer comme traité » par anomalie) | false (appelée par pg_cron, sans session utilisateur) |
| `loupe-memoire-resoudre` | `{id}` marque une ligne de `loupe_memoire` comme traitée (`correction_appliquee`). N'existe que parce que `loupe_memoire` reste fermée en écriture à `anon`/`authenticated` (RLS lecture seule, voir Schéma) — le bouton « Marquer comme traité » de BriefSoir.jsx passe par cette fonction plutôt qu'une écriture directe, plus prudent qu'une policy d'écriture anon ouverte sur une table pensée pour l'audit | true (appelée uniquement par l'app) |

Secrets : `FIELD_EDGE_API_KEY` (Anthropic), `TODOIST_TOKEN`.

**Bug `todoist-rappel` corrigé le 12/09** : la fermeture d'un rappel avalait silencieusement l'échec du `DELETE` Todoist (`.catch(() => {})` sans vérifier le statut) — `rappels.todoist_task_id` était remis à `null` côté Field même quand la suppression réelle avait échoué, sans aucun signal. Correctif : le statut de la réponse `DELETE` est vérifié (200/204/404 = vraiment supprimée, sinon `todoist_task_id` n'est **pas** nettoyé et l'échec est journalisé dans `loupe_memoire`, `type_erreur = 'todoist_delete_echoue'`, dédupliqué par rappel). Testé bout-en-bout sur un rappel de test réel : création + clôture + vérification indépendante de la suppression Todoist (`is_deleted: true`).

**Correction d'une fausse piste (même session, 12/09)** : l'investigation initiale du bug ci-dessus avait conclu à 4 tâches Todoist « encore actives » (Anca Pricop, Janier/Benhacoun, Elhaik, Gahnassia-Lewin) sur la seule base d'un statut HTTP 200 sur `GET /tasks/{id}` — erreur de lecture (réponse tronquée dans le test). En réalité l'API Todoist ne renvoie **jamais** 404 pour une tâche supprimée : elle répond 200 avec `is_deleted: true` (soft delete). Les 4 tâches étaient bel et bien supprimées, juste jamais relues jusqu'au bout. **Aucune tâche fantôme active** — rien à nettoyer côté Todoist. Corollaire : le contrôle `dossier_todoist_zombie` de `loupe-audit-integrite` avait le même défaut (ne testait que le statut HTTP, jamais `is_deleted`) et rapportait toujours 0 quelle que soit la réalité — corrigé le même jour. Une fois corrigé, il détecte correctement les 4 références mortes dans `dossiers.todoist_task_id` (colonne historique, jamais lue par le code actuel — impact fonctionnel nul, pure dette de données).

**Faux positif « Aussi à traiter » signalé le 13/09 (dossier Sultan) — pas un bug** : Bruce a signalé une sous-tâche « Faire devis » affichée en retard alors que le devis avait déjà été envoyé. Audit complet de la chaîne (`BriefSoir.jsx` → `dossier_note_taches`/`dossiers`/`rappels`) : le chargement filtre bien `fait=false` côté requête, un canal temps réel couvre `dossiers` et `dossier_note_taches` (INSERT/UPDATE/DELETE), et `lireAvecCache` ne retombe sur le cache qu'hors ligne — aucune source de donnée périmée trouvée dans le pipeline. Vérification en base et sur l'API Todoist : la sous-tâche est réellement encore ouverte (`fait: false`) et sa tâche Todoist liée est réellement encore active (`checked: false, is_deleted: false`) — c'est un oubli de coche de Bruce après l'envoi du devis, pas un bug d'affichage.

**Bug réel trouvé pendant cet audit, corrigé le 13/09** : le correctif du 12/09 sur `todoist-rappel` n'avait traité que le sens Field → Todoist (fermeture d'un rappel) ; son `reconcilier()` (sens Todoist → Field, appelé à l'ouverture de Brief Soir) avait le même défaut originel — ne testait que `checked`/`is_completed`/`completed_at`/404, jamais `is_deleted`. Une tâche **supprimée** (pas cochée) directement dans Todoist restait donc invisible pour Field indéfiniment. Même défaut, jamais corrigé, dans `todoist-tache` (sous-tâches de note) : à la fois son `reconcilier()` (même trou `is_deleted`) et sa fermeture individuelle (`.catch(() => {})` muet, identique au bug d'origine de `todoist-rappel`). Les quatre points corrigés d'un coup, même pattern que le 12/09 (statut de la réponse vérifié, échec journalisé dans `loupe_memoire` sans avaler, dédupliqué). Testé bout-en-bout sur un rappel ET une sous-tâche de test réels : création → fermeture réelle (DELETE vérifié) → ré-liaison simulant l'état périmé → `reconcilier()` détecte bien `is_deleted:true` et clôt côté Field.

### Loupe « mailscan » — manuelle, pas de fonction Edge

Contrairement aux deux loupes ci-dessus, `mailscan` (matching des échanges
email avec les clients existants, extraction décisions/actions/urgences)
n'est **pas** construite en fonction Edge — décision du 11/09 après un
dry-run manuel de validation (30 j, comptes `bruce.dasilva@societe-bailleul.fr`
+ `bruce.societe.bailleul@gmail.com`, via le connecteur Spark) :

- Un faux positif d'appariement ici écrit une note dans le dossier du
  mauvais praticien (constaté : un email de « Fabrice MATHEU »
  <fabrice.matheu@sodental.fr>, collègue SoDental, a failli être attribué au
  client *Fabrice Matheu-Cohen* par simple ressemblance de nom) — pas le
  même niveau de risque qu'une requête SQL rejouable et sans conséquence
  relationnelle comme sur `dossiers-dormants`/`relances-echues`.
- Nature différente des deux premières loupes : celles-ci sont
  déterministes (une requête SQL a une seule bonne réponse), `mailscan`
  demande un jugement (LLM) par email — un vrai risque d'interprétation à
  chaque exécution.
- Coût réel (chantier OAuth Google côté fonction Edge + appel LLM par
  email) à payer avant de savoir si ça vaut le coup, alors que la valeur est
  déjà obtenue via une passe manuelle.

**Pattern retenu** : dry-run manuel via connecteur de chat (Spark ou
équivalent), écriture uniquement dans `loupe_runs`/`loupe_memoire` — jamais
directement sur un dossier ni sur Todoist. À la demande, ou en tâche
programmée Cowork hebdomadaire (remonte la liste à valider, n'écrit rien
seule). Réévaluer l'infra OAuth serveur seulement si cette passe devient une
corvée régulière et que le matching reste fiable dans le temps.

**Liste d'exclusion collègues/fournisseurs** (à réutiliser telle quelle,
manuel ou Cowork — trouvée en croisant les emails les plus fréquents du
dry-run avec les clients existants) :
- Domaines internes : `@societe-bailleul.fr`, `@sodental.fr`
- Personnes : Alexandra Coulaud, Joël Morgado, Kevin Saez, Federica Grotto,
  Pascolini Laurent, Stéphane Do Rego
- Piège à retenir : un nom de collègue peut ressembler à s'y méprendre à un
  nom de client (Fabrice Matheu vs Matheu-Cohen) — toujours vérifier le
  domaine d'envoi et la signature complète du corps du message, jamais
  seulement le display-name de l'en-tête.

## Fonctions RPC

| Nom | Rôle | Appelable avec |
|---|---|---|
| `widget_chiffres_board()` | Sans paramètre, renvoie **uniquement** les 4 agrégats déjà affichés en tête de BriefSoir.jsx (`dossiers_actifs`, `objectif_pourcent`, `a_traiter`, `sav_ouverts`) — jamais de nom de praticien, de montant par dossier, ni aucune autre donnée nominative. Créée le 14/09 pour le widget iPhone/Mac (Scriptable + Raccourcis, voir plus bas). Logique **recopiée à dessein** depuis `bilan` (BriefSoir.jsx) en SQL plutôt qu'appelée depuis le client : dupliquer ici évite d'exposer une fonction générique qui pourrait un jour renvoyer plus que ces 4 nombres. `SECURITY DEFINER`, `search_path` fixé (pratique standard pour ce type de fonction). Vérifié le 14/09 : RLS désactivée sur `dossiers`/`dossier_note_taches`/`clients` (`relrowsecurity = false` sur les trois) — sans effet aujourd'hui, mais si le chantier RLS documenté plus bas active un jour des policies restrictives sur ces tables, cette fonction continue de fonctionner sans qu'il faille lui ajouter une policy `anon` par table. Testé en conditions réelles via `POST /rest/v1/rpc/widget_chiffres_board` avec la clé `anon` publique (aucune session requise) : résultat comparé chiffre par chiffre au Board affiché en production, identique (92 / 12 % / 21 / 7 au moment du test). | clé `anon` publique (`grant execute ... to anon, authenticated`) — safe : l'output ne contient aucune donnée sensible, contrairement à un accès direct aux tables (déjà possible aujourd'hui avec la même clé, voir chantier RLS) |

## Widget iPhone/Mac (Scriptable + Raccourcis)

Board résumé en 4 chiffres, en widget natif — pas d'app tierce à ouvrir pour voir où en est la journée. Appelle `widget_chiffres_board()` (ci-dessus) en lecture seule, rafraîchi périodiquement (30-60 min), tap → ouvre la PWA installée (pas Safari, via un Raccourci "Ouvrir l'app" plutôt qu'un lien https direct). Livré à Bruce en document séparé (script Scriptable + étapes d'installation iPhone/Mac) — configuration côté appareil, rien à déployer ici. Si les 4 chiffres du Board changent un jour de définition (nouveau statut, nouveau type de dossier...), `widget_chiffres_board()` doit être mise à jour en miroir de `bilan` dans BriefSoir.jsx — les deux logiques sont dupliquées par choix, pas synchronisées automatiquement.

> Les règles de travail avec Bruce et les décisions structurantes du produit
> vivent désormais dans `CLAUDE.md` (chargé automatiquement à chaque session),
> pas ici — pour ne pas les maintenir à deux endroits.

> Deux sessions Claude ont travaillé sur ce dépôt le 22/08. Vérifier
> `git log` avant de reprendre : la fusion de fiches et la décision SAV
> viennent d'une branche parallèle.

## Bugs de perte/corruption de données corrigés le 07/09/2026

- **File d'attente hors-ligne (`executerActionEnFile`, App.jsx)** — les cas
  `'note'` et `'etape'` n'ont jamais vérifié l'erreur retournée par Supabase.
  `insert`/`update` de supabase-js ne lèvent jamais (réseau coupé, contrainte
  violée…) — la promesse se résout avec `{ error }` plutôt que de rejeter.
  `viderFile` comptait donc l'action comme traitée et la sortait de la file
  même quand rien n'était écrit en base : une note tapée par Bruce a disparu
  ainsi, sans bandeau ni trace ensuite. Corrigé par une simple vérification
  `if (error) throw error` dans les deux cas — l'action reste désormais en
  file (bandeau visible, nouvelle tentative au prochain retour réseau) tant
  qu'elle n'a pas vraiment réussi.
- **Échéance de tâche affichée "Aujourd'hui" au lieu de la date choisie**
  (`TexteModifiable.jsx`) — les champs `type="date"`/`"time"` s'enregistraient
  automatiquement à chaque `onChange`. La roue native iOS déclenche un
  `onChange` par cran de défilement, chacun avec une valeur complète et
  valide du point de vue du navigateur, pas seulement au choix final :
  plusieurs écritures concurrentes partaient en parallèle, et l'ordre
  d'arrivée des réponses réseau (pas l'ordre d'envoi) décidait quelle date
  restait en base. Corrigé en retirant l'enregistrement automatique — le
  brouillon se met à jour au défilement, seul un appui explicite sur ✓ (ou
  Entrée) enregistre. S'applique à tous les champs date/heure du composant
  (échéances de tâches, dates de rappels).

## Chiffres au 22/08/2026

76 clients · 56 projets, 18 plans, 1 SAV · 8 rappels ouverts · 17 pièces
jointes dont 12 devis lus · 74 notes.
Projection 1 092 239 € · Signé 230 290 € · **37 projets encore sans montant.**

## Ce qui reste ouvert

0. **Sécurité — clé `anon` publique, aucune donnée protégée derrière** (signalé
   le 12/09, pas urgent ce soir mais à ne pas reporter indéfiniment). RLS
   désactivée sur tout le schéma applicatif (`dossiers`, `clients`, `rappels`…)
   veut dire, concrètement, que noms de praticiens, e-mails et montants de
   devis sont lisibles par quiconque trouve l'URL de l'app et regarde le
   bundle JS — sans compte, sans connexion (vérifié en direct : `curl` avec
   la clé `anon` publique retourne les vraies données). Ce n'est pas nouveau
   ni propre à `rapport_hebdo` — c'est la posture assumée du projet entier —
   mais il s'agit de données de patients/cabinets dentaires (France, RGPD).
   Chantier à part entière (RLS + policy sur tout le schéma, pas un correctif
   ponctuel sur une seule table), pas dans le scope d'une session normale.
0bis. **Artefacts d'import à auditer** (signalé le 12/09, bon candidat pour
   l'audit d'intégrité prévu en Phase 7) — l'import du 20/08/2026 a créé
   plusieurs dossiers avec un rappel dont la `date` est antérieure à la
   création du dossier lui-même (reprise telle quelle de la date de suivi de
   l'ancien système, jamais actualisée). 6 rappels identifiés par une requête
   ponctuelle (`date(rappels.created_at) = date(dossiers.created_at) AND
   rappels.date < date(dossiers.created_at)`) : Gahnassia-Lewin, Mamouni,
   Anca Pricop, Mr Farge (dossier perdu), Janier / Benhacoun, Elhaik.
   **Vérifié le 12/09 : aucune décision en attente.** Gahnassia-Lewin était
   le seul encore ouvert (clos ce jour-là, sans commentaire, rien recréé —
   devis non reconfirmé d'actualité). Les 5 autres s'étaient déjà refermés
   d'eux-mêmes via l'usage normal de Bruce (Janier/Benhacoun même remplacé
   par un vrai rappel le 24/08, avec commentaire) — colonnes reflet
   `dossiers.rappel_date` vérifiées cohérentes sur les 5, aucun bug annexe.
   Reste utile pour la Phase 7 : détecter ce pattern d'import à l'avenir,
   pas un correctif à faire aujourd'hui.
1. **Décisions qui appartiennent à Bruce**
   - Doublons `Matheu` / `Matheu-Cohen` et `Alakian` / `Patrice Alakian` — l'outil
     de fusion existe désormais, l'appariement reste à valider cas par cas
   - Cumuls de devis à cocher : Pricop affiche 995 € au lieu de 193 635 €
     (Anthos 192 640 + Dental Art 995), Alakian 8 290 au lieu de 9 440
   - Vider ou non les deux projets Todoist recopiés dans Field
2. **Alimentation du SAV** — un seul dossier pour 76 clients équipés. Bruce en
   gère davantage mais ils n'entrent pas dans Field. Canal tranché le 22/08 :
   la **Capture rapide au clavier**, dont la dictée native suffit — le Raccourci
   iOS est abandonné (conflit NordVPN, absent du Mac). Reste à construire le
   mode guidé de saisie d'un SAV.
3. **5 devis non lus** par la fonction, tous à raison : ils proposent plusieurs
   variantes chiffrées (Grunberg 4 études, Mimoune 3, Alakian 2 fois) et le
   modèle refuse de choisir. Montants à saisir à la main.
4. **Reste de la spec** : phase 3 (pilote catalogue Planmeca) est faite.
   Restent les autres marques du catalogue (nombre exact à déterminer —
   27 marques au total dans le portefeuille, mais toutes n'ont pas de
   fichier tarif structuré comme Planmeca) et la génération de devis
   (phase 4). Les fichiers tarifs source vivent dans
   `~/Library/Mobile Documents/com~apple~CloudDocs/Bailleul (IcD)/Configurateur/<MARQUE>/<ANNÉE>/`.
   macOS refuse souvent la lecture directe de ce chemin iCloud depuis le
   script (`Operation not permitted`) : copier le fichier tarif dans
   `scripts/` d'abord (ignoré par git, voir `.gitignore`) puis pointer
   l'import dessus.

## Pièges d'environnement

- NordVPN Threat Protection bloque le domaine Supabase — faux positif d'anti-hameçonnage.
- Les variables Vercel marquées « Sensitive » ne sont pas injectées au build.
- Les dictées iOS se coupent : régler « Arrêter d'écouter » sur « Sur pression »
  dans le raccourci.
- **Rotation de l'écran pendant une dictée (Capture rapide) — limitation iOS,
  pas un bug Field, distincte du Wake Lock déjà corrigé.** Signalé le 13/09 :
  la dictée s'arrête dès le premier changement d'orientation (pas seulement
  au second comme observé avant). Audit du code (13/09) : aucun écouteur
  `resize`/`orientationchange`, aucune hauteur en `vh`/`vw` recalculée,
  aucune media query CSS qui basculerait de composant selon l'orientation —
  confirmé inchangé depuis les derniers commits touchant `Capture.jsx`/
  `useWakeLock.js`, donc pas une régression de code. La dictée native iOS
  n'étant pas pilotable en JS (voir commentaire en tête de `Capture.jsx`),
  impossible de reproduire ou d'instrumenter le mécanisme depuis Field —
  confirmé à la place par une recherche externe : iOS interrompt la saisie
  vocale (dictée comme Mémos vocaux) au changement d'orientation, un
  comportement système documenté qui touche aussi des apps natives avec
  plein accès à `AVAudioSession` (ex. Signal iOS
  [#4359](https://github.com/signalapp/Signal-iOS/issues/4359),
  [#5692](https://github.com/signalapp/Signal-iOS/issues/5692)) — donc
  indépendant de toute app tierce, Field inclus. « Premier changement cette
  fois, second la fois précédente » s'explique probablement par un test
  précédent qui n'exerçait pas vraiment le cas (rotation partielle,
  dictée pas encore démarrée), pas par une régression : aucun code
  susceptible de causer ça n'a changé entre les deux observations. Aucun
  correctif possible côté Field (le texte déjà dicté n'est jamais perdu,
  seule la suite l'est) — seule parade utilisateur : verrouiller
  l'orientation avant de dicter. Amélioration UX possible mais non
  implémentée : détecter la perte de focus du champ juste après une
  rotation et prévenir Bruce visuellement plutôt que de le laisser parler
  dans le vide — à faire s'il la juge utile.
- **Collage de pièce jointe (Cmd+V / Coller iOS) — implémenté le 15/09,
  parité Mac/iPhone réelle seulement pour une image.** Demandé plus tôt
  dans le projet mais jamais construit (vérifié le 15/09 : aucune trace
  dans le code ni dans l'historique git avant ce jour). `src/lib/fichiers.js`
  centralise l'envoi (mêmes chemin de stockage et rattrapage anti-orphelin
  que le bouton « + Ajouter » existant) et l'extraction d'un fichier depuis
  un événement `paste`. Deux points d'entrée : `PiecesJointes.jsx` (champ
  dédié, focusable, dans la section Pièces jointes d'un dossier ou d'une
  fiche client — nécessaire pour qu'iOS propose « Coller », qui n'apparaît
  que sur un élément éditable/focalisé, jamais sur une simple zone de
  dépôt) et `Capture.jsx` (collage direct dans le champ de saisie ; si un
  fichier est détecté, ouvre `ChoixClient` pour choisir à qui le rattacher
  avant l'envoi — texte normal laissé au comportement par défaut du champ).
  Compatibilité vérifiée avant d'écrire le code (recherche externe, pas
  supposée) :
  - `navigator.clipboard.read()` (API Clipboard asynchrone) n'accepte
    qu'un ensemble restreint de types — `text/plain`, `text/html`,
    `image/png` (+ `text/uri-list` sur Safari seulement) — **aucun type de
    fichier générique** (PDF, etc.) n'y est autorisé, sur aucun
    navigateur. D'où le choix de l'événement `paste` classique
    (`clipboardData.items`) plutôt que cette API : plus ancien, mais seul
    à transmettre un vrai fichier générique.
  - Sur iOS Safari, le geste « Coller » natif n'apparaît que sur un
    élément éditable/focalisé (texte sélectionné → bulle « Coller », ou
    suggestion au-dessus du clavier) — jamais sur une zone non éditable.
    D'où le champ texte dédié dans `PiecesJointes.jsx`, pas un simple
    `<div>` de dépôt.
  - **Coller une image (photo, capture d'écran) : fiable sur Mac et
    iPhone** — c'est le cas d'usage principal, testé bout-en-bout (voir
    plus bas).
  - **Coller un fichier générique copié ailleurs (ex. un PDF copié dans
    Fichiers/Finder) : fiable sur Mac, mais pas garanti sur iPhone** — le
    mécanisme de copier-coller de fichier natif d'iOS ne transmet pas de
    façon fiable un vrai objet `File` exploitable au `paste` d'une page
    web pour un type non-image (limitation de plateforme documentée, pas
    un bug de ce code). **Non vérifiable en conditions réelles** : cette
    session n'a accès ni à un iPhone ni à Safari iOS — testé uniquement
    dans un navigateur de type Chromium (représentatif du comportement
    Mac), avec un événement `paste` synthétique reproduisant fidèlement
    ce qu'envoie un vrai clipboard (image PNG et PDF généré). Les deux
    chemins (image → dossier, fichier → client via Capture) confirmés en
    base et dans le dépôt de stockage : fichier bien créé, une seule fois,
    avec le bon `dossier_id`/`client_id`, nom auto-généré à partir du type
    MIME quand le presse-papiers ne fournit pas de nom exploitable. À
    valider par Bruce sur son iPhone réel pour le cas fichier générique.
- **Adresse tapée puis disparue sur une fiche client (Ponsart, Rouach
  Sandra) — course entre `client-web-lookup` et l'enregistrement manuel,
  corrigée le 17/09.** Bruce avait d'abord signalé le cas Ponsart, puis
  élargi (« toutes mes fiches semblent touchées »). Mesure en base : 64 %
  des 98 clients ont une adresse, ~100 % pour tout ce qui date d'après le
  24/08 — les 33 fiches sans adresse sont presque toutes l'import en masse
  du 17-21/08, pas un symptôme du bug. Le problème n'est donc pas
  systémique au sens où Bruce le craignait, mais bien réel et récurrent :
  reconstitué par preuve dans les logs Edge (`edge_logs`, séquences PATCH
  horodatées par User-Agent) sur Ponsart ET Rouach Sandra, avec l'ordre de
  la course inversé entre les deux cas — même cause dans les deux sens.
  Root cause : **TOCTOU (time-of-check-to-time-of-use)**. `client-web-lookup`
  lit l'état des champs une seule fois au début, fait une recherche web
  lente (Claude + `web_search`, 10-60+ s observées), puis écrit en se basant
  sur cette lecture périmée — sans revérifier juste avant d'écrire. Une
  sauvegarde manuelle de Bruce pendant cette fenêtre est écrasée (ou
  l'inverse), en violation directe de la règle « enrichir sans écraser ».
  Deux correctifs complémentaires, chacun ferme un sens de la course :
  1. **`client-web-lookup` (Edge, hors dépôt, v5)** — relit les champs
     juste avant d'écrire et n'écrit un champ que s'il est encore vide à ce
     moment-là (`encoreVide.<champ>` en plus de `reponse.<champ>`). Testé
     avec une fonction de debug déployée à part (délai fixe 15 s + réponse
     inventée au lieu de l'appel Claude réel, pour un test déterministe) :
     écriture manuelle injectée pendant la fenêtre → la fonction a bien vu
     la valeur manuelle à la relecture et n'a rien écrasé
     (`ecrit:false`). Fonction de debug neutralisée après test (stub
     410, aucun outil de suppression de fonction Edge disponible).
  2. **`ClientDetail.jsx` `save()`** — n'envoie plus le formulaire entier
     mais seulement les champs qui diffèrent réellement de `client` (le
     même diff que `dirty`). Un envoi complet réaffirmait la valeur encore
     en mémoire pour un champ jamais touché, écrasant au passage un
     enrichissement arrivé entre-temps. Découverte en testant ce
     correctif : l'abonnement temps réel `client-${client.id}` (ligne
     ~580) faisait `Object.assign(client, nouveau)` avec **tout** le
     payload distant reçu, alors que `values` n'est mis à jour que pour
     les champs vides localement — désynchronisant `client` (la référence
     du diff) de `values`, ce qui faisait percevoir à tort un champ jamais
     touché comme modifié et le renvoyait avec sa valeur locale périmée,
     écrasant exactement la donnée concurrente que le diff devait
     protéger. Corrigé en ne reportant sur `client` que les champs
     effectivement appliqués à `values` (même filtre « encore vide »).
  Deux lacunes demandées séparément par Bruce, aussi corrigées dans
  `save()` : remise en file (`mettreEnFile`) si l'écriture échoue
  (cohérent avec le reste de l'app, ne porte que les champs modifiés — pas
  le formulaire entier), et message d'erreur affiché juste au-dessus du
  bouton Enregistrer plutôt que seulement dans le bandeau sticky du bas,
  facile à manquer. Testé en base avec un client dédié : édition d'un seul
  champ pendant qu'un autre change en base en parallèle (simulation d'une
  écriture concurrente) → le champ concurrent survit, seul le champ tapé
  part en écriture ; coupure réseau simulée (fetch patché) → erreur
  visible immédiatement, entrée en file avec les seuls champs modifiés,
  rejouée correctement au retour du réseau. Client et données de test
  supprimés après vérification.
- **Téléphone/e-mail affichés vides sur une fiche ouverte depuis la
  recherche rapide du Board — corrigé le 21/09, rien à voir avec le
  prénom.** Bruce avait rapporté le symptôme comme lié au prénom (vide →
  champs disparus, retapé → réapparus sans recharger), mais l'audit a
  montré que ce n'est qu'une coïncidence de calendrier : la vraie cause
  est la recherche rapide de `BriefSoir.jsx`, qui charge la liste
  complète des clients en une fois avec un `select` volontairement
  restreint (`id, prenom_praticien, nom_praticien, nom_cabinet, ville`
  — nécessaire pour filtrer en local à chaque frappe sans réinterroger
  la base) et passait cet objet tronqué **directement** à `ClientDetail`
  au clic, sans jamais relire la fiche complète. `values` héritait donc
  de cet objet incomplet : téléphone, e-mail, adresse, associés — tout
  champ hors de ce `select` — s'affichait vide en ouverture, quel que
  soit l'état du prénom. Confirmé faux négatif en base à chaque étape
  (`execute_sql` direct) : les données n'ont jamais bougé de
  `clients`, seul l'écran mentait. La « réapparition sans recharger »
  que Bruce observait tenait à un autre mécanisme déjà en place :
  l'abonnement temps réel de la fiche (`client-${id}`, voir l'entrée du
  17/09 plus haut) ne comble que les champs *vides localement* à partir
  du payload distant reçu à chaque UPDATE — un simple enregistrement
  (retaper le prénom, ou n'importe quel autre champ) renvoie la ligne
  complète par ce canal et comble alors après coup téléphone/e-mail,
  faisant croire à un lien de cause à effet avec le prénom qui n'existe
  pas. Corrigé en relisant la fiche complète (`select('*')`) au moment
  du clic sur un résultat de recherche rapide, avant d'ouvrir
  `ClientDetail` — repli sur l'objet tronqué si la relecture échoue
  (hors ligne), pour ne jamais bloquer la navigation. La liste de
  recherche elle-même reste sur son `select` restreint : élargir à `*`
  là aurait alourdi pour rien le chargement initial de tous les
  clients. Le prénom reste volontairement facultatif au niveau base et
  fiche (`ClientDetail.save()` n'exige que nom du praticien OU nom du
  cabinet) — un centre/SCM sans praticien nommé est un cas réel et
  déjà géré ; `ClientForm.jsx` (création) suit la même règle, à
  vérifier séparément si Bruce veut la resserrer côté création.
- **Fiche client : dossiers terminaux repliés dans « Historique (N) » —
  24/09.** `ClientDetail.jsx` séparait mal l'actif de l'ancien sur les
  clients à long historique : tout était dans une seule liste. Désormais
  « Dossiers actifs · N » d'abord, puis un lien « Historique (N) » (même
  style que « Voir les N autres » du Board) replié par défaut, qui déplie
  les dossiers terminaux — projet `termine`/`perdu`, plan `solde`, SAV
  `clos`, le même vocabulaire que les compteurs du Pipeline. Rien n'est
  retiré : simple répartition d'une même liste, ordre chronologique
  (récent d'abord) conservé dans chaque bloc, état replié non mémorisé.
  Calcul dérivé de `dossiers` : un dossier clos en direct (temps réel)
  passe seul de l'actif à l'historique. Testé sur un client dédié (2 actifs,
  4 terminaux couvrant les 4 statuts, dates étalées), supprimé ensuite.
- **Rappels « vides » (date ou rappel absent, par intermittence) — diagnostic
  du 29/09, aucune cause trouvée en base, pas de correctif engagé.** Deuxième
  passe sur ce signalement (déjà investigué le 24/09 avec la même conclusion) :
  requêtes directes sur la base de production, aucune ne remonte quoi que ce
  soit —
  - Cohérence `dossiers.rappel_date/heure/note` vs le calcul du trigger
    `refleter_prochain_rappel` (prochain rappel ouvert du dossier) : **0
    écart** sur les 103 dossiers.
  - Rappels sans dossier existant (cascade de suppression ratée) : **0**.
  - Dossiers avec `rappel_date` renseigné mais aucune ligne dans `rappels`
    (même close) : **0**.
  - Rappels ouverts en double sur un même dossier (pourrait perturber le
    calcul du trigger) : **0**.
  - Rappels antérieurs à la création de leur dossier : 6 cas, mais tous déjà
    clos (`fait_at` non nul, un seul via Todoist) et datés du 20/08 —
    l'artefact déjà documenté de l'import en masse du 17-21/08, sans lien
    avec ce signalement (ne pèse pas sur le reflet, réservé aux rappels
    ouverts).
  - `rappels.date` est `NOT NULL` au niveau du schéma — aucun des 3 chemins
    de création (`ajouterRappel()`, réconciliation Todoist→Field, fusion
    rappel/note de `cloreRappel()`) ne peut physiquement écrire une date
    vide ; le formulaire de saisie (`Rappels.jsx`) désactive lui-même le
    bouton tant qu'il n'y a pas de date.
  - Répartition Todoist/Field : **100 %** des 15 rappels actuellement ouverts
    portent un `todoist_task_id` (`ajouterRappel()` synchronise
    systématiquement à la création) — impossible de distinguer un pattern
    « plutôt Todoist » quand la quasi-totalité des rappels vivants passe par
    Todoist de toute façon.
  - Fonction Edge `todoist-rappel` testée en direct (`{action:'reconcilier'}`)
    : répond `200`, fonctionne normalement.
  Conclusion : si le symptôme est réel, ce n'est pas une perte ou une
  corruption de donnée — la base est saine à chaque contrôle. Piste non
  confirmée, à vérifier séparément si le signalement se reproduit :
  [Rappels.jsx](src/components/Rappels.jsx:60) n'a aucun état de
  chargement — `liste` démarre vide et le reste tant que le fetch n'a pas
  répondu, rendant "Aucun rappel en cours." indiscernable d'un dossier
  réellement sans rappel sur une connexion lente (même piège que celui déjà
  corrigé côté `Pipeline.jsx`, voir son commentaire). N'explique pas la
  partie « date vide » d'un rappel par ailleurs affiché — aucun mécanisme
  trouvé dans le code pour ce cas précis. Pas de correctif tant que la vraie
  cause n'est pas confirmée en base au moment du signalement — il faudrait,
  la prochaine fois que ça se reproduit, le nom du dossier concerné et
  l'écran exact pour requêter la base à ce moment-là.
- **Board : « Aussi à traiter » regroupé par fenêtre temporelle — 29/09.**
  La liste plate (rappels + SAV actionnables + tâches + devis, triés par
  urgence, tronqués à 6 avec « Voir les N autres ») masquait arbitrairement
  des retards réels dès qu'il y en avait plus de 6, tous types confondus.
  Le tri par urgence (`elementsUrgents`, décroissant sur `joursRetard`)
  reste la seule règle de classement — non remplacé par un groupage par
  type — mais la liste se découpe maintenant en sous-groupes visuels : **En
  retard** (rouge/`text-erreur`, jamais tronqué), **Aujourd'hui**
  (orange/`text-alerte`), **Cette semaine** (orange/`text-alerte`), puis
  « Voir les N autres » replié comme avant pour le reste. Chaque item garde
  son tag de type (Rappel/SAV/Tâche/Devis) et sa clôture ✓ directe,
  inchangés. `LIMITE_AUSSI_A_TRAITER` (l'ancienne limite fixe à 6) retirée,
  devenue sans objet.
  **Découverte en testant avec les vraies données de Bruce** (pas de jeu de
  test pour la vérification finale) : les groupes « Cette semaine » et
  « Plus tard » ne peuvent aujourd'hui jamais se peupler. `aRappeler`
  (source des rappels de cette liste) est filtré à `rappel_date <=
  aujourd'hui`, `tachesEnRetard` à `etatEcheanceTache(...).echu` — les deux
  excluent déjà tout ce qui n'est pas en retard ou dû aujourd'hui ; les SAV
  et devis n'ont pas de notion de date future dans ce calcul. Confirmé en
  ajoutant un dossier de test avec un rappel à +4 jours puis +15 jours (élément de test créé,
  vérifié absent des deux groupes, puis supprimé) : rien n'apparaît tant que
  la source de données elle-même n'inclut pas le futur proche. Les rappels à
  venir vivent déjà dans une section séparée, « À venir » (`bilan.aVenir`,
  capée à 5, non urgente) — élargir la fenêtre de `aRappeler` pour peupler
  « Cette semaine » ferait doublon avec cette section et gonflerait le
  compteur « 29 »/la tuile KPI « À traiter » (qui réutilise `aRappeler`).
  Décision non prise unilatéralement : à trancher avec Bruce avant tout
  élargissement de la source de données — le regroupement visuel livré ici
  fonctionne correctement sur ce qui existe déjà (`En retard`/`Aujourd'hui`),
  seuls ces deux groupes se peupleront en pratique jusqu'à cette décision.
- **`Rappels.jsx` : état de chargement ajouté — 29/09, suite du diagnostic
  du même jour.** Cause non prouvée du signalement « rappels vides » (la
  base reste saine à chaque contrôle), mais bug latent réel trouvé au
  passage et corrigé quand même, validé par Bruce : `liste` démarrait vide
  et le restait tant que le fetch n'avait pas répondu, rendant « Aucun
  rappel en cours. » indiscernable d'un fetch encore en vol — même piège
  que celui déjà corrigé côté `Pipeline.jsx`. Ajout d'un état `chargement`
  (affiche « Chargement… » tant que la réponse n'est pas arrivée, posé à
  `false` dans les deux branches succès/échec du fetch, sans condition).
  Testé en conditions réelles : fetch `/rest/v1/rappels` retardé
  artificiellement (8 s) sur un vrai dossier avec un rappel en cours
  (Goual, « Point sur le devis », en retard de 27 jours) — « Chargement… »
  s'affiche pendant le délai, puis le rappel apparaît correctement une fois
  la réponse arrivée. N'explique pas à lui seul le symptôme rapporté par
  Bruce (toujours à confirmer en base la prochaine fois que ça se
  reproduit, avec l'écran exact et le dossier concerné) — mais ferme ce
  risque d'affichage précis, sans corriger sur hypothèse la cause du
  signalement lui-même.
- **Pipeline.jsx : colonnes terminales unifiées sous « Historique (N) » —
  29/09.** Modification restée non commitée plusieurs sessions (repérée en
  `git status`, jamais perdue). Même pattern que la fiche client et le
  Board : un seul lien repliable remplace les deux toggles séparés
  `montrerPerdus`/`montrerTermines` (qui n'existaient que pour Projet) —
  désormais `historiqueDeplie`, un état partagé unique pour les trois vues
  (Projet : Terminé+Perdu, SAV : Clos, Plan : Soldé), volontairement non
  mémorisé entre sessions. Testée en navigateur avec les vraies données
  avant commit : bouton « Pipeline » du Board → kanban Projet peuplé
  normalement (pas de régression sur le fix du 18/09) ; « Historique (20) »
  déplie bien Terminé (14) + Perdu (6) en Projet ; « Historique (3) » en
  SAV révèle Clos ; « Historique (3) » en Plan révèle Soldé ; tuile KPI
  « SAV ouverts » (vueInitiale='sav') toujours correcte. Le partage d'un
  seul `historiqueDeplie` entre les trois vues est voulu, pas un bug :
  changer de vue avec l'historique déjà déplié le garde déplié, confirmé
  au passage lors du test.
- **Board : les 9 accordéons détaillés regroupés en 4 en-têtes — 30/09.**
  `SAV ouverts`/`Devis sans réponse`/`À rappeler`/`Tâches en retard`/
  `Rappels à venir`/`Plans à produire`/`Règlements de plans à encaisser`/
  `À chiffrer`/`Anomalies détectées` s'enchaînaient à plat, sans hiérarchie
  visuelle. Regroupés sous 4 en-têtes discrets (texte gris uppercase, pas
  de carte englobante, même style que « Aussi à traiter ») : **À traiter**
  (SAV ouverts, Devis sans réponse, À rappeler, Tâches en retard),
  **Production** (Rappels à venir, Plans à produire, À chiffrer),
  **Financier** (Règlements de plans à encaisser), **Qualité des données**
  (l'encart d'alerte « X dossiers sur Y signés sans montant », déplacé de
  son ancienne position flottante entre Règlements et À chiffrer vers le
  haut de ce groupe, + Anomalies détectées). Contenu, tri et comportement
  accordéon de chaque section strictement inchangés — seuls l'ordre
  d'affichage et le regroupement visuel bougent.
  **Rappels à venir n'était explicitement assigné à aucun des 4 groupes
  dans la demande** (seuls 8 des 9 accordéons y figuraient) : rattaché à
  Production de ma propre initiative — rien n'y est en retard, même statut
  « travail programmé, pas urgence » que Plans à produire/À chiffrer, pas
  assez de volume pour un 5ᵉ en-tête à lui seul. À corriger si Bruce voit
  ça autrement.
  Couleur des compteurs alignée sur la sémantique demandée : orange/accent
  réservé à SAV ouverts, Devis sans réponse, À rappeler, Tâches en retard,
  Anomalies détectées (déjà correctement dynamiques, aucun n'a eu besoin
  d'être touché) ; Règlements de plans à encaisser repasse en neutre
  (`urgent={...}` retiré — c'était le seul écart réel : orange dès qu'un
  plan avait `reglement_demande`, alors que c'est un volume de travail,
  pas un blocage). Rappels à venir/Plans à produire/À chiffrer étaient déjà
  neutres, rien à changer. `Rapport hebdo` non touché, hors périmètre de
  la demande (pas dans la liste des 9 accordéons) — reste après les 4
  groupes comme avant.
  Testé en navigateur avec les vraies données de Bruce (23 SAV/tâches
  affichés, encart de couverture faible bien repositionné en tête de
  « Qualité des données »).
- **Board : les 4 accordéons de « À traiter » s'ouvraient par défaut,
  dupliquant « Aussi à traiter » — corrigé le 30/09.** Bruce constatait en
  vidéo réelle un défilement de 13s+ et les mêmes dossiers affichés 2-3
  fois (ex. Youssef Jacques, Sharif Shayann visibles à la fois dans
  « Aussi à traiter → En retard » et en détail dans « SAV ouverts » plus
  bas). Cause confirmée précisément, pas de persistance en jeu : simple
  bug d'état initial — `useState({ sav: true, devis: true, rappeler: true,
  taches: true })`, un objet littéral, aucun `localStorage`/
  `sessionStorage` impliqué. Décision délibérée à l'origine (« les
  décisions les plus urgentes du soir doivent se voir sans taper »),
  jamais reconsidérée quand « Aussi à traiter » a été ajouté plus tard et
  s'est mis à couvrir les mêmes dossiers en détail — les deux blocs
  affichaient alors la même chose en double. Corrigé en repliant les 9
  accordéons détaillés par défaut (`useState({})`), sans exception : les 5
  autres (Rappels à venir, Plans à produire, Règlements, À chiffrer,
  Anomalies détectées) étaient déjà correctement repliés, seuls
  SAV/Devis/À rappeler/Tâches en retard avaient le bug. « Aussi à traiter »
  non touché, continue d'afficher les noms de dossiers par défaut comme
  prévu. Testé en navigateur avec les vraies données de Bruce : chaque nom
  de dossier (Youssef Jacques, Sharif Shayann) n'apparaît plus qu'une
  seule fois sur la page au chargement, les 4 accordéons montrent
  chevron ▸ + nom + compteur, rien de plus, tant qu'on n'a pas tapé
  dessus.
- **Board : refonte Option B (validée sur maquette) — 01/10.** Quatre
  chantiers en un, chacun testé séparément avec les vraies données de
  Bruce avant ce commit unique :
  1. **Total remonté** — le chiffre affiché à côté du header « Aussi à
     traiter » (`board.aussiATraiter.length`, inchangé) est monté sous la
     grille KPI : « N actions en attente aujourd'hui », centré. Plus
     dupliqué à côté du header, qui garde juste son titre.
  2. **Tri continu, repli à 3** — retour à un tri unique par ancienneté
     (`joursRetard` décroissant, tous types confondus), sous-groupement
     temporel En retard/Aujourd'hui/Cette semaine du 30/09 retiré. « Voir
     les N autres » replie désormais après 3 éléments (contre 6
     auparavant) — le total étant repris en tête de page, plus besoin d'en
     montrer beaucoup ici.
  3. **Dédoublonnage « Relance devis »** — un rappel dont le dossier est en
     étape `devis_envoye`/`relance`, ou dont la note contient « devis »,
     est désormais tagué `Relance devis` au lieu de `Rappel`, et porte les
     deux informations (« Xj sans réponse » ajouté à côté de l'échéance du
     rappel). Le dossier correspondant est retiré de `devisSansReponse`
     avant construction de `elementsUrgents`
     (`devisRestants = devisSansReponse.filter(d => !relanceDevisIds.has(d.id))`)
     — plus de doublon entre l'entrée manuelle et l'entrée automatique sur
     un même dossier. `bilan.devisSansReponse` (le compte brut, non
     dédupliqué) reste inchangé pour le compteur de la ligne de navigation
     « Devis sans réponse » plus bas. Tags visuellement distincts (couleur,
     tokens existants uniquement) : `rappel` en accent, `relance_devis`/
     `devis` en alerte, `sav`/`tache` neutres — `TAG_STYLES`, nouveau, dans
     `BriefSoir.jsx`. **Vérifié avec un cas réel en base** : dossier Goual
     Laura, statut `relance` depuis le 01/09 (30j pile), rappel ouvert
     noté « Point sur le devis » — apparaissait avant en double, n'apparaît
     plus qu'une fois, tagué Relance devis, avec les deux informations
     affichées.
  4. **Accordéons → navigation** — les 8 sections détaillées (SAV ouverts,
     Devis sans réponse, À rappeler, Tâches en retard, Rappels à venir,
     Plans à produire, Règlements, À chiffrer) ne se déplient plus sur le
     Board : chaque ligne est un lien (nouveau composant `LigneNavigation`,
     chevron `›`) qui ouvre directement Pipeline sur la vue et — quand une
     seule colonne correspond — l'étape pertinente (nouvelle prop
     `etapeInitiale` sur `Pipeline.jsx`, propagée depuis `App.jsx`, même
     mécanisme que `vueInitiale`). Seule **Anomalies détectées** reste un
     accordéon classique (nature différente : incohérences à corriger sur
     place via son bouton « Traité », pas des dossiers à ouvrir ailleurs).
     Cibles retenues (les 3 sans colonne Pipeline unique sont des
     approximations documentées, à revoir si Bruce préfère autre chose) :
     - SAV ouverts → Pipeline vue SAV (exact)
     - Devis sans réponse → Pipeline vue Projet, étape Devis envoyé (les
       deux étapes qualifiantes sont Devis envoyé + Relance, verrouillé
       sur la première par Bruce)
     - Règlements → Pipeline vue Plan, étape Règlement demandé (exact,
       même logique de choix de colonne que Devis)
     - À chiffrer → Pipeline vue Projet (exact : `bilan.sansMontant` est
       à 100 % de type Projet)
     - **À rappeler et Tâches en retard** → pas de colonne Pipeline
       possible (rappel/tâche cross-type) : redirigent vers « Aussi à
       traiter » plus haut sur le même Board (`allerAAussiATraiter`),
       cible exacte plutôt qu'approximative — ces mêmes dossiers y sont
       déjà listés en détail.
     - **Plans à produire et Rappels à venir** → Pipeline vue Plan/Projet
       respectivement — approximation (Plans à produire mélange des plans
       intégrés à un Projet et des dossiers Plan à part ; Rappels à venir
       n'a aucune notion de vue).
     Pastilles de saut (`pastilles`, `allerASection`, `sectionRefs`)
     retirées avec les accordéons qu'elles ciblaient, devenues sans objet.
     `Section` (composant) retiré, plus aucun appelant.
     Testé en navigateur avec les vraies données : chaque lien vérifié un
     par un (vue et étape actives confirmées par script), Anomalies
     détectées confirmée toujours accordéon.

## Phase 1 — typage des documents (branche `feat/phase1-typage-documents`, non fusionnée)

- `fichiers` gagne `type_doc` (devis/cdc/plan/autre), `version_doc`, `variantes` (jsonb `[{libelle, montant_ttc}]`), `variante_retenue` (index base 0) et `a_trancher_raison` (colonne ajoutée en plus des quatre demandées : motif d'un HT/TTC douteux). Migration additive : `supabase/migrations/20261009_fichiers_type_doc.sql` (déjà appliquée en base).
- Analyse : nouvelle fonction Edge `devis-montant-v2` (déjà déployée). L'ancienne `devis-montant` reste en place, plus appelée par le front de cette branche. Une fois la branche fusionnée et vérifiée, `devis-montant` peut être retirée.
- Le montant d'un devis à offres exclusives reste vide tant que Bruce n'a pas retenu une offre (un tap) ; le déclencheur existant recalcule alors le dossier. Les offres ne s'additionnent jamais.
- Retirer à un devis chiffré son statut de devis (changement de type) remet son `montant_ttc` à vide **mais ne remet pas `montant_estime` du dossier à zéro** : le déclencheur `recalculer_montant_dossier` laisse le montant en place quand plus aucun fichier n'est chiffré (comportement antérieur, valable aussi à la suppression d'un fichier).
- Les deux textes « n'a pas été reconnu comme un devis » encore en base sur les CDC V3 (Antoun) et V4 (Sharif) ne sont pas réécrits (migration additive) ; l'écran ne montre l'erreur d'analyse que pour un devis.
- La sonde réseau (`src/lib/reseau.js`) portait un 401 en console : elle envoie maintenant l'apikey vers `/rest/v1/clients?select=id&limit=1` (la racine `/rest/v1/` répond 401 même avec la clé publique).
- Un devis déposé sur une **fiche client** (hors dossier) n'est jamais analysé : Goual, Dahan, Laban (…020B) et Pagazani sont dans ce cas. À rattacher à leur dossier pour être lus.
- Tests de parcours : `npm run e2e` (Playwright, devDependency, viewport 390x844). Ils créent un client `ZZTEST-E2E` sur la base réelle et le suppriment à la fin.
- En attente de la maquette `docs/maquette-board.html` (absente du dépôt) pour la bande « À appeler » et les pastilles « En attente » (sous-point d).

### Complément 2 (phase 1)

- Montant « à chiffrer » : migration `20261009_montant_a_chiffrer.sql` (appliquée). Quand le dernier devis chiffré d'un dossier est retiré (retenue annulée, changement de type, suppression), `montant_estime` passe à NULL. Seul ce retrait déclenche la remise à vide (variable de session `field.vider_si_vide` posée par `sur_changement_devis`) : déposer une photo ou un PDF non chiffré laisse la saisie manuelle intacte. Retour arrière : `supabase/rollback/20261009_montant_a_chiffrer_rollback.sql`.
- `devis-montant-v2` accepte `dryRun: true` (lit sans écrire, y compris pour un PDF encore sur une fiche client). Les erreurs d'analyse (PDF illisible…) s'écrivent toutefois même en dry-run.
- Rattachés à leur dossier unique : Goual, Dahan, Pagazani (leur `montant_estime` égalait déjà une des offres lues). **Laban …020B reste sur la fiche client** : 4 offres (20 675 – 28 115 €) alors que le dossier porte 13 472 € (révision C déjà chiffrée).
- Un devis dont `montant_estime` est vide s'affiche « À chiffrer » (carte Pipeline, fiche client, champ du dossier) pour les projets, jamais 0 €.
- Catalogue : plus aucun chemin dans l'interface (la pilule de nav a été retirée) ; seule la route `catalogue` de App.jsx existe.
- Synchro Todoist : `todoist-rappel` a répondu 429 (limite de débit Todoist) à tous les essais du 09/10 en soirée ; non vérifiée de bout en bout.
- `npm run e2e` : e2e/phase1.spec.js et e2e/smoke.spec.js.

### Complément 4 (phase 1) — Board : bande « À appeler », feuilles, pastilles

- `BandeAppeler` remplace le bloc « Priorité du jour » (mêmes données : `board.prioriteJour`, `board.disponibles`, « Plus tard » inchangé). Le nombre affiché est celui des éléments non ignorés du tri unique ; la feuille liste chacun (le premier porte la mention « Priorité du jour ») puis la section « Aussi à traiter » entière. Le bouton « Appeler » est un lien `tel:` (même geste qu'avant) ; sans numéro, il ouvre la fiche.
- `FeuilleBasse` : dialogue modal réutilisable (focus piégé, Échap, fond, « Fermer »). Servie aussi par la tuile « En attente » et par la ligne « Devis à trancher · N devis · M dossiers ».
- « En attente » (tuile et pastille ⏳) : uniquement `statut = en_attente`. Les devis envoyés/relancés n'en reçoivent plus ; le SAV « nouveau » Kahloun, qui porte un `bloque_par` en texte libre (« Diagnostic Joël en attente »), n'a pas de pastille.
- Feuille « À appeler » : un contact = un dossier, une seule ligne (les autres éléments urgents du même dossier sont comptés « (+N) » dans le motif, « Plus tard » les ignore tous) ; « Aussi à traiter » dans la feuille ne répète pas ces dossiers.
- `PastilleAttente` (« ⏳ motif · N j ») sur les cartes Pipeline et les dossiers de la fiche client.
- Les couleurs de la spec correspondent aux tokens existants (carte #1B1D22, accent-vif #22D3EE, alerte, fond) : aucune nouvelle couleur.
- Todoist : la limite de débit (429, `retry_after` ≈ 21 min) persiste ; la tâche de test `6hj4XM476rG7XGvw` (« ZZTEST-SMOKE rappel de test — à supprimer ») est restée dans Todoist faute de pouvoir la supprimer.

### Correctifs 2 (phase 1) — règle : on ne retire aucune fonction

- Pipeline : la pastille « ⏳ réponse client — N j » (Devis envoyé / Relance, `joursEnAttente` + `classeAttente`) est restaurée à l'identique ; elle ne compte pour rien dans la tuile « En attente ».
- Tuile et pastilles ⏳ du Board : `estEnAttente` (constants/dossiers.js) = `bloque_par` renseigné et statut hors termine/clos/solde/perdu. Texte libre affiché tel quel, tronqué ; jours = `joursEnAttente`, sinon jours depuis `statut_changed_at`. Aujourd'hui : 3 (Youssef, Fellous, Kahloun).
- « Plus tard » : n'écarte à nouveau que l'élément concerné ; le contact reste représenté par son élément suivant.
- Écarts connus avec la carte « Priorité du jour » d'avant la bande (non corrigés, à décider) : plus d'étiquette de type (SAV / Rappel / Tâche…), plus de ligne « En retard de N jours / À traiter aujourd'hui », un tap de plus pour ouvrir le dossier (la bande ouvre la feuille), « Plus tard » désormais dans la feuille seulement.

## Phase 2 — historique des étapes (branche `feat/phase2-historique-etapes`, non fusionnée)

Voir `docs/phase2-historique.md` (état des lieux, définition de « signé », requête de contrôle, retours arrière). Migrations `20261010_historique_etapes.sql` et `20261010_pipeline_snapshots.sql`, déjà appliquées en base. Tests : `e2e/historique.spec.js`.
### Correctif 5 (phase 1) — cumul d'offres

- Migration `20261010_variantes_retenues.sql` (+ rollback) : colonne `fichiers.variantes_retenues integer[]` ; les choix déjà faits y sont recopiés. `variante_retenue` reste la première offre retenue (compatibilité), `montant_ttc` porte la somme. Un cumul se fait par « Cumuler » → cocher → « Valider le cumul » ; HT/TTC se précise par offre quand le devis porte un doute ; `montant_ht` n'est renseigné que si toutes les offres retenues sont lues en HT.
- `devis-montant-v2` (v3) : relire un devis dont les offres n'ont pas changé conserve le choix et le montant (y compris un cumul).
- Deux devis chiffrés sur un même dossier se remplacent toujours (règle du déclencheur inchangée) : le cumul d'offres est interne à un devis.

## Phase 3 — Dashboard (branche `feat/phase3-dashboard`, non fusionnée)

- Écran `src/screens/Dashboard.jsx`, pastille « Dashboard » sur le Board (qui reste l'accueil). Données : RPC `dashboard_chiffres()` (SECURITY INVOKER, agrégats seulement ; migrations `20261011_dashboard_chiffres.sql` et `…_realtime_pipeline_snapshots.sql`, rollbacks dans `supabase/rollback/`) + les mêmes lectures que le Board pour les listes (dossiers, tâches) et `fichiers`.
- Familles d'étapes (ordre du Pipeline) : Qualification (a_classer, prospect, prise_contact) · Devis (devis_a_faire, devis_envoye, relance) · Négociation (visite_local, negociation, confirmation) · Commande (financement, commande) · Chantier (reunion_chantier, installation) · Finition (finition, sav). « Projets actifs » = projets ni perdus ni terminés. Le regroupement vit dans `src/constants/dashboard.js` ET dans la RPC ; `e2e/dashboard.spec.js` compare la RPC à un recalcul indépendant.
- Définitions : signé = celle de l'Objectif (désormais exportée de `constants/dossiers.js`, utilisée par le Board et le Dashboard) ; en retard = éléments de « Aussi à traiter » ; en attente = `bloque_par` renseigné et statut non terminal ; incomplets = devis manquant (étape ≥ Devis envoyé, aucun fichier de type devis) ou cahier des charges manquant (plan intégré sans fichier de type CDC) — définition proposée, à valider ; à trancher = devis à plusieurs offres ou HT/TTC douteux, sans montant.
- Segment « À trancher » de l'anneau Objectif = somme, sur les devis à trancher des dossiers non encore signés, de l'offre la plus basse (« ≥ ») : ce n'est pas un montant acquis.
- « À chiffrer » (RPC `a_chiffrer`) : seulement à partir de Devis envoyé ; jamais « 0 € ».
- Série d'évolution : `pipeline_snapshots` ; signé par statut (sans la règle d'exercice) ; courbe affichée à partir de 7 jours de données.
- Une table nouvelle doit être ajoutée à la publication realtime : `pipeline_snapshots` ne l'était pas, et l'abonnement ENTIER du Dashboard échouait sans erreur visible (corrigé).

## Décisions par devis (branche `feat/decisions-devis`, depuis `feat/phase3-dashboard`, non fusionnée)

- Colonnes `fichiers.decision` (a_trancher par défaut | retenu | alternative | remplace | mis_de_cote), `remplace_par`, `mis_de_cote_le`, `date_reprise`, et `decision_le` (ajoutée : date de chaque décision, sert à « Remplacé le… »). Migrations `20261012_decisions_devis.sql` et `20261012_dashboard_decisions.sql`, rollbacks dans `supabase/rollback/`.
- Calcul (`recalculer_montant_dossier`) : montant du dossier = somme des devis `retenu` ; des devis existent mais aucun n'est retenu → NULL ; aucun devis du tout → saisie manuelle intacte (sauf retrait d'un devis chiffré). La règle « deux devis chiffrés se remplacent toujours » et la case « devis complémentaire » (colonne `cumule`, conservée mais sans effet) sont supprimées.
- Remplissage : le devis le plus récent de chaque dossier (et les cumulés) → retenu ; les autres devis chiffrés que l'ancienne règle ignorait → remplacé (remplace_par = le devis retenu) ; devis sans montant → à trancher. Aucun montant modifié.
- Numéro de devis : `parserReference` (racine = NOM_PRODUIT, numéro = 9 chiffres + lettre de révision). Proposition seulement quand la racine est identique et le rang plus élevé.
- « Reportés » : dossier avec un devis mis de côté et aucun retenu ; hors signé et hors à trancher dans la RPC `dashboard_chiffres()` (clé `reportes`).
- L'analyse (`devis-montant-v2`, v4) ne décide jamais : un devis analysé reste « à trancher » jusqu'à un tap (ou une saisie manuelle du montant, qui le retient).

## Décision par offre et « Potentiel ouvert » (branche `feat/decision-offres`, depuis `main`, non fusionnée)

- État par offre dans le jsonb `fichiers.variantes` : `etat` (retenue | a_trancher | ecartee | reportee), `projet` (étiquette ≤ 30 car.), `date_reprise`, `base` (ht | ttc). Aucune colonne ajoutée ; `variantes_retenues` / `variante_retenue` restent la mémoire des offres retenues. Migration `20261013_offres_etat.sql` (+ rollback) : offres déjà retenues → retenue, les autres → a_trancher ; aucun montant touché.
- Montant : `montant_ttc` du devis = somme des offres retenues (HT converti par la TVA), la décision du devis en découle (une offre retenue → retenu ; sinon à trancher ; sinon mis de côté ; sinon alternative) ; le déclencheur existant additionne les devis retenus. Un devis sans offres compte pour une offre dont l'état suit sa décision.
- RPC `dashboard_chiffres()` : nouvelle clé `potentiel` (a_trancher : offres · devis · dossiers · montant_min ; reportees : offres · devis · dossiers · montant). Les clés historiques (a_trancher par devis, reportes) sont conservées : le site déjà en production lit les mêmes chiffres. Segment « À trancher » de l'anneau = plancher (offre la plus basse par devis) ; « Reporté » = somme des offres reportées.
- Analyse (`devis-montant-v2`, v5) : relire un devis dont les offres n'ont pas changé ne touche plus aux états, étiquettes, dates ni au montant.
- Le cumul par case à cocher et la retenue « en un tap » d'une offre sont remplacés par le choix d'état par offre (même résultat : plusieurs offres retenues = cumul).

## Nettoyage du potentiel : « Écarter les autres »

- Fiche : quand une offre est « retenue » et que d'autres du même devis restent « à trancher », un bouton « Écarter les autres offres de ce devis (n) » apparaît. Jamais automatique, annulable 8 s. Seul `variantes[].etat` change : aucun montant, aucune décision de devis.
- Dashboard › Potentiel ouvert › « Nettoyer » : liste les devis concernés, bouton « Écarter les autres » par devis, bouton global avec confirmation (nombre d'offres, devis, montant retiré du plancher « À trancher »). Rien n'est écrit avant confirmation.
- « Décision requise » en tête (devis à montant retenu mais aucune offre retenue — cas Ponsart) : signalement seul, aucune action, aucune écriture.
- Helpers : `devisANettoyer`, `champsEcarterAutres`, `decisionsRequises` (`src/lib/documents.js`). Test : `e2e/nettoyage.spec.js` (fixtures ZZTEST-NET).

## Accueil unique (feat/accueil-unique, non fusionné)

- `/` = `screens/Accueil.jsx` : « Aujourd'hui » (le Board) puis « Pilotage » (le Dashboard, `Dashboard integre`). L'ancien Board (`screens/BriefSoir.jsx`) est conservé derrière « Ancien accueil » (pied de page) en attendant la validation de `docs/inventaire-accueil.md`.
- Un seul calcul : `lib/bilanBoard.js` (calculerBilan / calculerBoard / calculerEnAttente / calculerATrancherPar), état et gestes dans `hooks/useBoardData.js`, affichage dans `components/BoardAffichage.jsx` et `BoardBlocs.jsx`. Ne plus dupliquer ce calcul.
- `App.jsx` : pile initiale `[accueil]` ; retour d'arrière-plan > 30 min → accueil (`DELAI_RETOUR_ACCUEIL_MS`), sauf fiche modifiée ; le recul dans l'historique est absorbé par `ignorerPopRef`.
- Pastilles d'en-tête à 44 px ; pastille Dashboard retirée ; tuile « En attente » du Dashboard masquée dans l'accueil.
- Hors-ligne à froid : 6 à 12 s de réconciliation avant l'affichage du cache (comportement de l'ancien Board, inchangé).
- Dette connue : perte de mise à jour intermittente sur deux gestes rapprochés d'offres (écho temps réel d'une écriture précédente) — tâche ouverte, voir `e2e/offres.spec.js` / `decisions.spec.js`.
