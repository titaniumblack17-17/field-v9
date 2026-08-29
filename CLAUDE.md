# Field V9

CRM personnel de Bruce Da Silva, commercial indépendant en équipement dentaire
en Île-de-France (18 marques pour Bailleul et So Dental, objectif annuel 5 M€
TTC). Utilisé debout, sur iPhone, entre deux cabinets — chaque décision
d'interface se juge à cette aune : rapide à lire, rapide à taper d'une main.

**Avant de travailler sur ce dépôt, lire `PASSATION.md`** — schéma complet,
fonctions edge, chiffres à jour, chantiers ouverts. Ce fichier-ci ne contient
que les règles à respecter à chaque session ; PASSATION.md est la référence
qui se met à jour au fil du travail.

## Stack

React 18 + Vite 5 + Tailwind 3 · Supabase `qgbdhwkdbmplvpflsgdt` (eu-west-3,
RLS désactivée — usage strictement personnel, assumé) · déploiement Vercel
automatique sur push `main` → https://field-v9.vercel.app

## Workflow

- Push direct sur `main`. Pas de branches, pas de PR — décision assumée pour
  un projet à un seul contributeur.
- Après un push : vérifier le déploiement par le hash de bundle
  (`curl` sur `assets/index-*.js`), puis **par le chemin réel que Bruce
  emprunte** dans un navigateur — jamais seulement en curl. Trois fonctions
  Edge sont restées mortes une journée entière (en-tête CORS `x-client-info`
  manquant) alors que tous les tests curl passaient.
- `npm run build` lance ESLint avant Vite : un `no-undef` bloque le déploiement
  — un appel vers une fonction disparue ne peut plus partir.

## Règles de travail avec Bruce

- **Pas de réponse de complaisance.** Il demande des avis francs et les suit
  quand ils sont argumentés.
- **Toujours confirmer une suppression** en nommant précisément ce qui part.
- **Livrer créer + modifier + supprimer ensemble**, sans attendre la demande —
  il a déjà dû réclamer l'édition d'un rappel qui n'existait qu'en création.
- **Listes temps réel : traiter INSERT, UPDATE et DELETE.** L'oubli d'UPDATE a
  déjà frappé deux fois ; une table nouvelle n'entre pas d'elle-même dans la
  publication `supabase_realtime`, à l'ajouter explicitement.
- **Répondre toujours en français dans le chat.**
- Il dicte souvent au clavier ou à la voix — attendre des fautes de frappe et
  des transcriptions approximatives dans ses messages, comprendre l'intention
  plutôt que de buter sur la forme.

## Décisions structurantes du produit

- **Todoist n'est pas un CRM, c'est le réveil-matin.** On ne recopie vers
  Todoist que les rappels — jamais de logique métier dupliquée là-bas.
- **La nomenclature de fichiers de Bruce fait autorité** :
  `NOM_PRODUIT_RÉFÉRENCE` (référence à 9 chiffres). Le bouton « Renommer » ne
  s'affiche pas sur ces noms-là, seulement sur les scans et photos.
- **L'objectif se referme au 31 décembre.** Un dossier réglé appartient à
  l'exercice de son règlement ; un dossier ouvert, à l'exercice courant — ce
  qui n'est pas réglé bascule seul au 1ᵉʳ janvier suivant.
- **Un devis remplace, il n'additionne pas**, sauf case « devis complémentaire »
  cochée.
- **Code couleur des échéances : rouge en retard, orange sous 8 jours, bleu
  au-delà. Jamais de vert**, qui se lirait à tort comme « réglé ».
- **Un rappel ne tombe jamais un week-end ni un jour férié par défaut** — sauf
  volonté explicite de Bruce (il pose parfois des rappels tôt le matin pour
  joindre des fournisseurs avant le rush, ce n'est pas une erreur à corriger).
- **Enrichir sans écraser.** Toute source secondaire (carnet d'adresses,
  recherche web, dictée qui complète une fiche existante) ne remplit que les
  champs vides ; une valeur déjà saisie par Bruce fait autorité et n'est
  jamais recouverte.
