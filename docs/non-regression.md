# Non-régression — à rejouer à la fin de chaque phase

Viewport iPhone 390 × 844. Console sans erreur. Aucun défilement horizontal. Cibles tactiles ≥ 44 px.

## 0. Build
- [ ] `npm run build` : ESLint + Vite passent sans erreur ni avertissement bloquant.

## 1. Board / accueil (BriefSoir)
- [ ] Total remonté, accordéons « À traiter » fermés par défaut ; chaque chiffre mène à l'écran filtré correspondant, Retour revient.
- [ ] Brief du soir et rapport hebdo s'ouvrent.
- [ ] Rappels du jour : clôture d'un rappel (avec commentaire) fonctionne.

## 1 bis. Dashboard (phase 3)
- [ ] Pastille « Dashboard » sur le Board ; « ← Brief » ramène au Board.
- [ ] Anneaux Objectif et Pipeline ; chaque segment et chaque ligne de légende ouvre la bonne liste / le Pipeline filtré (« Famille : X », « Tout afficher »).
- [ ] Tuiles À trancher, Incomplets, En attente, En retard : liste = chiffre ; une ligne ouvre la fiche ; retour = Dashboard.
- [ ] « En retard » = « N actions à traiter aujourd'hui » du Board ; jamais « 0 € » pour un montant vide.
- [ ] Hors-ligne : dernières valeurs connues signalées ; temps réel INSERT / UPDATE / DELETE.

## 2. Pipeline
- [ ] 14 étapes visibles, colonnes Terminé / Perdu repliées et comptées.
- [ ] Glisser-déposer d'une carte change l'étape ; l'annulation la restaure.
- [ ] SAV en attente : pastille motif + « depuis N j » (couleurs bleu / orange / rouge, jamais vert).

## 3. Clients
- [ ] Liste + recherche (nom, société, ville).
- [ ] Création / édition client ; complétion carnet sans écraser une valeur saisie.
- [ ] Recherche d'adresse.
- [ ] Fiche client : dossiers, notes, rappels, matériel, pièces jointes.

## 4. Dossiers
- [ ] Création / édition / suppression (avec confirmation nommant l'élément).
- [ ] Projet : changement d'étape ; SAV : statut + motif « en attente de qui » ; Plan : statut, commercial.
- [ ] Journal : ajout, édition, suppression de note ; tâches et sous-tâches.
- [ ] Rappels : création, édition, clôture, suppression ; pas de week-end / férié par défaut.
- [ ] Synchro Todoist des rappels (création / clôture).

## 5. Pièces jointes et devis
- [ ] Dépôt PDF / photo, ouverture (URL signée), renommage (absent sur NOM_PRODUIT_RÉFÉRENCE 9 chiffres), suppression avec confirmation.
- [ ] Coller une image depuis le presse-papiers.
- [ ] Analyse devis → montant TTC ; saisie manuelle ; case « devis complémentaire » ; un devis remplace, ne s'additionne pas.
- [ ] Montant dossier = trigger `recalculer_montant_dossier` ; `montant_estime` manuel préservé sans devis chiffré.

## 5 bis. Décisions par devis (retenu / alternative / remplacé / mis de côté)
- [ ] Défaut « À trancher » : aucun devis ne compte ; montant du dossier NULL = « À chiffrer », jamais 0 €.
- [ ] Les 4 boutons (≥ 44 px) changent la décision en un tap ; « Annuler » rétablit.
- [ ] Montant du dossier = somme des devis « retenu » (cumul entre devis ET entre offres d'un même devis).
- [ ] « Mis de côté » : date de reprise facultative → rappel ; groupe « Reportés » ; remplacés grisés avec la date.
- [ ] Proposition « Ce devis remplace-t-il le précédent ? » (même racine, numéro plus élevé) : Oui / Non, alternative / Non, cumul — jamais d'automatisme.
- [ ] Ligne de temps des devis (n°, date, montant, décision) ; dossiers reportés exposés sous « reportes » (RPC).

## 6. Capture / dictée
- [ ] Capture texte et dictée créent la capture ; suggestion de dossier ; lien capture → dossier.

## 7. Matériel, Catalogue, recherche
- [ ] Matériel installé : ajout / édition / suppression.
- [ ] Catalogue s'ouvre, recherche produit.
- [ ] Recherche globale.

## 8. Hors-ligne
- [ ] Couper le réseau, éditer un dossier (étape, note, champ), indicateur de file > 0.
- [ ] Rétablir le réseau : file rejouée dans l'ordre, indicateur à 0, aucune écriture perdue, valeurs vérifiées en base.
- [ ] Recharger pendant la coupure : la file survit.

## 9. Temps réel
- [ ] INSERT, UPDATE et DELETE d'un fichier / dossier apparaissent dans l'écran ouvert sans recharger.

## 10. Données (lecture seule, comparaison avant / après)
- [ ] Dossiers par type × statut identiques.
- [ ] `fichiers` : même nombre (44), mêmes montants non modifiés ; seuls les nouveaux champs diffèrent.
- [ ] Somme `montant_estime` des dossiers inchangée sauf variantes retenues explicitement.
- [ ] Clients, notes, captures, matériel, rappels : mêmes comptes.

## 11. Sécurité (inchangé)
- [ ] RLS toujours désactivée, auth non touchée.
- [ ] `widget_chiffres_board` ne renvoie aucune donnée nominative.
