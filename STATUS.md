# Field V9 — état

Dernière relecture : 21/08/2026.

## Ce qui tourne

- **Clients / dossiers** — liste, recherche, fiche toujours éditable, suppression.
- **Pipeline** — Kanban 16 étapes, glisser-déposer et bouton « Déplacer ».
- **Capture** — dictée iOS ou clavier → Edge Function `capture-intake`.
  Rapproche un praticien déjà enregistré au lieu d'en créer un second.
- **Dossiers** — Projet / SAV / Plan, avec le cycle de vie des plans
  (à planifier → en cours → envoyé → installé → règlement demandé → soldé)
  et le commercial pour qui le plan est fait.
- **Pièces jointes** — PDF et images, dépôt privé, liens signés.
- **Devis** — Edge Function `devis-montant` lit le total TTC d'un PDF joint à
  un dossier ; un déclencheur recalcule le montant du dossier.
- **Todoist** — les rappels partent et reviennent (`todoist-rappel`),
  réconciliation à l'ouverture du Brief soir.
- **Brief soir** — rappels, plans, règlements, jauge d'objectif annuel.

## Bugs connus non résolus

### 🟡 Homonymes fusionnés à la capture
`capture-intake` rapproche sur le nom quand l'un des deux prénoms est absent.
Beaucoup de fiches n'ont pas de prénom : deux praticiens de même nom peuvent
être fusionnés à tort. Resserrer coûterait l'inverse — recréer des doublons
sur une dictée refaite. À trancher quand le cas se présentera.

### 🟡 Cibles tactiles de l'en-tête
Les pastilles Brief / Pipeline / Capture / + font 36 px de haut, sous les 44 px
recommandés. Larges, donc utilisables, mais à revoir si des ratés surviennent.

### 🟢 Montant figé quand le dernier devis part
`recalculer_montant_dossier` ne remet pas le montant à null si tous les devis
chiffrés sont retirés : la saisie manuelle est préservée, mais un montant venu
d'un devis supprimé subsiste.

### 🟢 Lecture d'un devis : une à deux minutes
Sur un PDF de plusieurs mégaoctets. L'écran n'affiche qu'un « Lecture du
devis… » sans progression.

## Données à compléter

- **5 devis en abstention motivée** (Grunberg, Mimoune, Alakian ×2,
  Perez-Grassano Viso) : plusieurs scénarios chiffrés, aucun désigné.
  Le montant retenu est à saisir à la main.
- **Cumul à cocher** — Pricop (Anthos 192 640 € écrasé par Dental Art 995 €)
  et Alakian (1 150 + 8 290).
- **5 clients signés sans dossier sur le disque** : CHSF, Magalhaes,
  MonOrtho Argenteuil, MonOrtho Champigny, Oliveira.
- **Doublons de fiches** : Najm (celle de 13:53:57 est vide), Matheu vs
  Matheu-Cohen, Alakian vs Patrice Alakian.

## Non fait, volontairement

- **Pas de tableau de bord.** Cinq graphiques sur cinq dossiers chiffrés
  auraient l'air sérieux sans rien apprendre.
- **Projets Todoist « 🎯 Pipeline actif » et « 📐 Plans & remboursements »
  laissés intacts.** Leur contenu est importé dans Field ; les vider attend
  un accord explicite.
