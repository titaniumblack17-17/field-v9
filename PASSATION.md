# Field V9 — passation

À coller au début d'une nouvelle conversation. État au 22 août 2026.

## Qui et pourquoi

Bruce Da Silva, commercial indépendant en équipement dentaire en Île-de-France.
18 marques pour Bailleul et So Dental. Objectif annuel 5 M€ TTC.
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
les 17 autres marques restent à faire. Réimport manuel via
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

**Déclencheurs**
- `refleter_prochain_rappel` — recopie le prochain rappel non fait sur le dossier
- `horodater_cloture` — pose `closed_at` au passage en finition ou perdu
- `recalculer_montant_dossier` — montant = dernier devis non cumulé + cumulés

## Fonctions Edge

| Nom | Rôle | verify_jwt |
|---|---|---|
| `capture-intake` | analyse une dictée, crée ou complète un client (comble aussi depuis `carnet_contacts`) | false (iOS Shortcuts) |
| `todoist-rappel` | `{rappelId}` synchronise · `{action:'reconcilier'}` rapatrie | true |
| `devis-montant` | `{fichierId}` lit le total TTC d'un devis PDF | true |

Secrets : `FIELD_EDGE_API_KEY` (Anthropic), `TODOIST_TOKEN`.

## Décisions structurantes

- **Todoist n'est pas un CRM, c'est le réveil-matin.** Ses projets « Pipeline
  actif » et « Plans & remboursements » contenaient un CRM complet en double,
  importé dans Field le 21/08. On ne recopie vers Todoist que les rappels.
- **La nomenclature de fichiers de Bruce fait autorité.** `NOM_PRODUIT_RÉFÉRENCE`
  avec référence à 9 chiffres. Le bouton « Renommer » ne s'affiche pas sur ces
  noms-là, seulement sur les scans et photos.
- **L'objectif se referme au 31 décembre.** Un dossier réglé appartient à
  l'exercice de son règlement, un dossier ouvert à l'exercice courant : ce qui
  n'est pas réglé bascule seul au 1er janvier.
- **Un devis remplace, il n'additionne pas**, sauf case cochée.
- **Rouge pour un retard, orange sous huit jours, bleu au-delà.** Jamais de vert,
  qui se lirait « réglé ».

## Règles de travail avec Bruce

- **Toujours confirmer une suppression** en nommant ce qui part.
- **Livrer créer + modifier + supprimer ensemble.** Il a dû réclamer l'édition
  des rappels ; ne pas attendre la demande.
- **Vérifier par le chemin qu'il emprunte**, pas en curl. Trois fonctions Edge
  ont été mortes une journée entière — en-tête CORS `x-client-info` manquant —
  alors que tous les tests curl passaient.
- **Listes temps réel : traiter INSERT, UPDATE et DELETE.** L'oubli d'UPDATE a
  frappé deux fois, et une table nouvelle n'entre pas d'elle-même dans la
  publication `supabase_realtime`.
- **Pas de réponse de complaisance.** Il demande des avis francs et les suit
  quand ils sont argumentés.
- `npm run build` lance ESLint avant Vite. `no-undef` en erreur : un appel vers
  une fonction disparue ne peut plus être déployé.

> Deux sessions Claude ont travaillé sur ce dépôt le 22/08. Vérifier
> `git log` avant de reprendre : la fusion de fiches et la décision SAV
> viennent d'une branche parallèle.

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
   Restent les 17 autres marques du catalogue et la génération de devis
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
