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
| `client-web-lookup` | `{client_id}` recherche web (spécialités, adresse, associés…), écrit directement les champs vides trouvés avec confiance ; déclenchée en tâche de fond par `capture-intake` à chaque création de client, et sur demande depuis le bouton « Chercher sur le web » de la fiche | true |

Secrets : `FIELD_EDGE_API_KEY` (Anthropic), `TODOIST_TOKEN`.

> Les règles de travail avec Bruce et les décisions structurantes du produit
> vivent désormais dans `CLAUDE.md` (chargé automatiquement à chaque session),
> pas ici — pour ne pas les maintenir à deux endroits.

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
