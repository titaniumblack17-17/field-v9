# Catalogue produits — pilote Planmeca

25/08/2026. Phase 3 de la spec initiale. Voir [PASSATION.md](../../../PASSATION.md).

## Pourquoi

Bruce retrouve un prix produit en ouvrant un des ~50 fichiers Excel de tarifs
fabricants (`~/Library/Mobile Documents/com~apple~CloudDocs/Bailleul (IcD)/Configurateur/`),
un par marque et par année, avec plusieurs versions par an. Objectif : un
prix à jour depuis Field, sans ouvrir Excel.

## Ce que l'exploration a montré

Les tarifs de ses 18 marques n'ont pas un format commun :

- **Anthos** — un classeur par bon de commande, un onglet par modèle de
  fauteuil, ~800 lignes par onglet (Description, Code, Prix €, Quantité).
  Structure propre.
- **Planmeca** — un onglet par ligne de produit (ex. « Planmeca Viso G1 »),
  chaque ligne portant plusieurs colonnes de prix : prix conseillé net,
  offre commerciale en cours avec ses dates de validité, et des colonnes de
  calcul (achat dépôt, vente client HT/TTC) vides tant qu'une remise n'est
  pas saisie à la main pour une affaire précise — pas des prix fixes.
- **Melag** — export interne du distributeur (NAV), onglets en allemand,
  codes SAV internes, journal de modifications. Pas un tarif client.

Un importeur unique pour les 18 marques n'est pas réaliste en un chantier :
trois formats, trois logiques. Décidé avec Bruce : un pilote sur une seule
marque d'abord, pour valider tout le circuit avant d'investir sur les
formats compliqués.

**Marque pilote : Planmeca.** Fichier de référence :
`Configurateur/PLANMECA/2026/TARIF PM 2026 - V01072026.xlsx` (celui que
Bruce a désigné comme actuel, pas le dernier par date de fichier — plusieurs
versions coexistent par an dans son dossier).

## Ce que ça couvre

### Donnée par produit

- Marque (`Planmeca`, fixe pour ce pilote)
- Modèle — nom de l'onglet source (ex. « Planmeca Viso G1 »)
- Code produit (ex. `FE005246`)
- Désignation
- Instruction / précision (ex. « Prix valable uniquement avec achat de
  matériel neuf »)
- Prix conseillé net
- Prix de l'offre en cours (si présent) + son texte de période de validité
- Fichier source + date d'import (traçabilité : d'où vient ce prix)

### Import

Un script qu'on relance à la main (pas de surveillance automatique de
dossier — fragile sur un chemin iCloud, et sans intérêt tant qu'une seule
marque est couverte). Il lit chaque onglet produit du classeur, ignore les
lignes sans code + sans prix (titres de section comme
« 1. Supports du patient supplémentaires »), et enregistre le reste dans une
table `produits` sur Supabase.

Relancer l'import pour une marque **remplace entièrement** ses produits
existants (on vide puis on réinsère), plutôt que de mettre à jour ligne par
ligne : un produit disparu du nouveau fichier disparaît aussi du catalogue,
au lieu de laisser une fiche périmée invisible. Pas d'historique de
versions pour ce pilote — la donnée n'existe que dans l'état courant.

### Écran Catalogue

Nouveau bouton « Catalogue » à côté de Brief / Pipeline / Capture.

- Recherche par nom, code ou modèle
- Résultat : liste avec les deux prix côte à côte (conseillé + offre en
  cours, quand elle existe)
- Fiche détail au tap : marque, modèle, code, les deux prix, la période de
  l'offre, l'instruction si présente, et la source d'import

Maquette validée par Bruce le 25/08 :
https://claude.ai/code/artifact/0d9492e4-702a-46cf-9082-cb9298942c49

## Hors périmètre pour ce pilote

- Les 17 autres marques (Anthos, Melag, Castellini, Acteon, etc.)
- Génération de devis (phase 4) — le catalogue reste une référence de
  consultation, pas encore relié à un dossier ou un devis
- Rapprochement avec le matériel déjà installé chez un client
- Toute automatisation de récupération des fichiers (surveillance de
  dossier, synchronisation iCloud)
- Historique de versions de prix

## Décisions à retenir

- **Ne pas tenter un importeur universel.** Chaque marque a son format ;
  traiter marque par marque, en commençant par la plus simple à comprendre
  et à maintenir.
- **Le prix affiché n'est jamais une seule colonne devinée.** Planmeca a
  plusieurs colonnes de prix par ligne — conseillé et offre en cours sont
  tous deux réels et utiles, pas de choix arbitraire de l'un plutôt que
  l'autre.
- **La traçabilité de la source prime sur l'automatisation.** Savoir de
  quel fichier et de quelle date vient un prix compte plus, à ce stade, que
  de rendre l'import automatique.
