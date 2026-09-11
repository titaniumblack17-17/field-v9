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
  des « loupes » (automatisations planifiées type `loupe-dossiers-dormants`) ;
  RLS activée sans policy sur les deux (accès `service_role` uniquement,
  contrairement au reste du schéma où la RLS est désactivée par choix assumé)

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

Secrets : `FIELD_EDGE_API_KEY` (Anthropic), `TODOIST_TOKEN`.

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
