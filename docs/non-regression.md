# Non-régression — à rejouer à la fin de chaque phase

Viewport iPhone 390 × 844. Console sans erreur. Aucun défilement horizontal. Cibles tactiles ≥ 44 px.

## 0. Build
- [ ] `npm run build` : ESLint + Vite passent sans erreur ni avertissement bloquant.

## 0 bis. Règle d'usage des tests e2e (trafic Supabase limité : offre gratuite, 5 Go de trafic sortant)
- **Pendant le développement : suite LÉGÈRE** — `E2E_LEGER=1 npm run e2e` (scénarios critiques : connexion lien/code, accueil, fiche, décisions, financement,
  file hors ligne, devis écarté, version, ajout de document, pré-vérifications CORS). **Suite COMPLÈTE seulement avant une fusion en production.**
  Jamais deux passes complètes d'affilée sans raison (une relance ne se justifie que par un échec sur délai de 15 s). Éviter `--repeat-each` sur la suite entière.
- Tous les specs importent `test` depuis `e2e/base.js` (jamais `@playwright/test`). Il court-circuite, SANS toucher à l'application, ce qui ne sert pas au scénario :
  `loupe_memoire`, `rapport_hebdo`, les fonctions Todoist (réponse vide : Todoist n'est plus jamais appelé) et le temps réel (serveur WebSocket de substitution,
  canaux abonnés mais aucun événement). Les requêtes de données (dossiers, fichiers, clients, RPC…) partent toujours vers la vraie base.
- Un scénario qui UTILISE une de ces ressources la réclame : étiquette de test (`{ tag: '@temps-reel' | '@loupe' | '@rapport-hebdo' | '@todoist' }`) ou, pour un
  fichier entier, `test.use({ autoriser: ['temps-reel'] })`. Pour une passe de diagnostic : `E2E_REEL=temps-reel,todoist`. Si un scénario échoue parce qu'il
  dépendait d'une de ces ressources, le signaler (ne pas ajouter l'étiquette en silence).
- Pré-vérifications CORS : tant que Playwright intercepte des requêtes, il répond lui-même aux OPTIONS du navigateur. `e2e/cors.spec.js` envoie donc de VRAIES
  pré-vérifications à Supabase (fonctions Edge appelées par l'app, API de données, stockage, authentification) avec les en-têtes du navigateur : c'est le garde-fou
  contre un défaut CORS masqué (cause de trois fonctions Edge mortes une journée). À ne jamais retirer des deux modes.
- Coupure du réseau vers Supabase dans un test : `page.route(RE_SUPABASE, …)` (importé de `./base.js`), jamais une adresse écrite en dur (le proxy de mesure change l'adresse).
- Fin de passe : le rapporteur affiche le total des requêtes Supabase (navigateur + aides de test), les octets et le top 5 des chemins ; alerte ROUGE au-dessus de
  **5 000 requêtes (léger)** ou **7 000 (complet)**, par largeur d'écran (une passe = une largeur : 390 ou 1280). La mesure serveur (tout compris) se fait avec
  le proxy de journalisation (voir PASSATION.md).

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

## 5 ter. Décision par offre et « Potentiel ouvert »
- [ ] Chaque offre d'un devis : 4 états en un tap (Retenue / À trancher / Écartée / Reportée), cibles ≥ 44 px, « Annuler » 8 s (retire aussi le rappel créé par un report).
- [ ] Étiquette « projet » facultative par offre ; sous-totaux par projet seulement quand des étiquettes existent ; aucun montant modifié par une étiquette.
- [ ] Montant du dossier = somme des offres retenues (entre offres ET entre devis) ; question HT/TTC par offre avec calcul de TVA ; dossier partiellement retenu = potentiel ouvert.
- [ ] Offre reportée : date de reprise facultative → rappel.
- [ ] Dashboard : « Potentiel ouvert » (À trancher / Reportées : offres · devis · dossiers + montants), anneau à 4 segments cliquables, listes avec motif par ligne.
- [ ] Board et Dashboard affichent le même signé ; la RPC égale un recalcul indépendant.

## 5 quater. Devis « Écarté » (refusé définitivement, le dossier reste actif)
- [ ] Parmi les décisions d'un devis (≥ 44 px) : « Écarté », avec motif facultatif (puces « Matériel non choisi », « Trop cher », « Concurrent », « Autre » + saisie libre). Devis à offres : bouton « Écarter ce devis ».
- [ ] Devis écarté : grisé, étiquette « Écarté », date et motif visibles, bouton « Remettre en jeu » (retour à « à trancher », motif et date effacés). « Annuler » 8 s.
- [ ] Le montant du dossier se recalcule tout de suite, hors ligne comme en ligne (somme des seuls devis « retenu »), puis la base le confirme au rejeu.
- [ ] Un devis écarté est exclu : du montant, de « Dossiers à trancher », du potentiel et des reportées (RPC dashboard_chiffres() ET listes), de « devis sans réponse » / « En attente du client » quand TOUS les devis du dossier sont écartés. Ses offres sont ignorées. Étape et statut du dossier inchangés.
- [ ] Tuile « À trancher » = feuille du Pilotage = filtre « Dossiers à trancher » de Projets = base.
- [ ] Le code précédent (production avant ce lot) charge fiche, accueil et Pilotage sans erreur face à un devis `ecarte`.

## 5 quinquies. Version affichée et mise à jour
- [ ] Pied de page de l'accueil, discret : « Version <commit court> · jj/mm hh:mm » (heure de Paris), injecté au build ; sans débordement.
- [ ] `version.json` (commit + heure du build) publié à chaque déploiement ; jamais mis en cache par le service worker ; lu avec `cache: no-store`.
- [ ] Vérification au démarrage, à chaque retour au premier plan, au retour du réseau et toutes les 10 minutes. Hors ligne ou erreur : aucun message, aucun faux bandeau, un bandeau déjà affiché reste.
- [ ] Version identique, ou publiée plus ANCIENNE (retour arrière) : aucun bandeau. Plus récente : « Nouvelle version disponible » + « Recharger » (≥ 44 px) qui vide le cache du service worker puis recharge.
- [ ] Écriture en attente dans la file hors ligne : « Recharger » attend son envoi (message explicite), la page ne bouge pas, puis se recharge d'elle-même. Même garde pour le rechargement automatique du changement de service worker.
- [ ] Adresse autre que field-v9.vercel.app (déploiement de test) : bandeau orange « Version de test, pas la production ». Poste de développement (localhost) : pas de bandeau.

## 5 sexies. Connexion par code (temps A, sans RLS)
- [ ] Sans session locale : écran de connexion seul, mode principal = LIEN : adresse pré-remplie, « Recevoir le lien » ; puis « Lien envoyé à <adresse>. Ouvrez-le sur cet appareil. », « Sur iPhone, ouvrez le lien dans Safari. », « Renvoyer le lien (N s) » (60 s) et le lien discret « J'ai reçu un code » ; aucun champ de code par défaut ; version affichée en pied.
- [ ] Le lien (flux implicite, `emailRedirectTo` = origine de l'app, production ou test) ouvre la session dans N'IMPORTE QUEL navigateur ; l'adresse est nettoyée ; une autre fenêtre du même navigateur se connecte aussi ; l'appareil qui a demandé le lien, s'il est dans un autre navigateur, reste en attente (le code le dépanne).
- [ ] Lien expiré, déjà utilisé ou invalide (erreur dans l'adresse) : message clair et « Renvoyer un lien » ; adresse nettoyée ; le message ne revient pas au rechargement.
- [ ] Mode code (« J'ai reçu un code ») : code à 6 chiffres (clavier numérique, remplissage automatique), validation au 6ᵉ chiffre.
- [ ] Erreurs en français : code incorrect, code expiré (plus d'une heure après l'envoi), trop de demandes, pas de réseau, adresse non autorisée ; « Renvoyer le code (N s) » bloqué 60 s avec décompte visible.
- [ ] Session persistante : conservée après rechargement et fermeture de l'app ; jeton renouvelé tout seul ; jamais de nouveau code tant que la session locale existe.
- [ ] Hors ligne avec session connue : l'app démarre normalement, jamais d'écran de connexion bloquant ; la file d'écritures se remplit ; au retour du réseau le jeton est renouvelé PUIS la file part, sans perte.
- [ ] Jeton de renouvellement refusé (révoqué) : retour à l'écran de connexion ; les écritures en file restent sur l'appareil.
- [ ] Réglages (lien en bas de l'accueil) : adresse connectée, « Se déconnecter » (confirmation qui mentionne les écritures en attente), version en pied.
- [ ] Le client envoie le jeton de l'utilisateur ; la base reste ouverte (RLS non activé) ; aucune table modifiée.
- [ ] Les tests automatiques ouvrent la porte uniquement sur le serveur de développement (VITE_E2E_SANS_CONNEXION=1) : jamais en production ; un test e2e sur le site publié exige désormais une vraie session.

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

## Stabilité de la suite (fix/offres-concurrence)

- Un seul passage de suite à la fois sur la machine : verrou global `e2e/verrou-global.js` (dossier `/tmp/field-v9-e2e.verrou`, repris si son processus est mort). Toutes les sessions partagent la même base Supabase.
- Fixtures de test à noms uniques par passage ; `nettoyage` et `non-devis` ne regardent que leurs propres lignes (aucun compteur global de la base).
- Attentes sur un état, jamais sur un délai fixe (`e2e/aides.js` : `ouvrirDocuments`, `versDashboard`, `annuler`, `rendu`, `attendreEchos`). Plafond d'attente 15 s par défaut.
- Reproductions déterministes des défauts d'écriture : `ecritures-concurrentes.spec.js` (écho périmé, échos dans le désordre), `rejeu-hors-ligne.spec.js` (deux gestes hors-ligne, deux ordres ; rejeu qui se retente), `lecture-bloquee.spec.js` (lecture qui ne revient pas), `annulation-differee.spec.js`.
- Suite répétée : `scripts/suite-repetee.sh <passages> <largeur>` (invalide un passage si une autre suite a tourné en parallèle). `DIAG=1` active le journal (`e2e/diag.js`) — il perturbe parfois les chargements, donc éteint par défaut.
- Seul test rouge attendu : `smoke.spec.js` « rappel : création, synchro Todoist, clôture » tant que Todoist répond 429.

## Accueil unique (feat/accueil-unique)

- `e2e/accueil.spec.js` : ouverture à froid, N identique (ancien Board = « Aujourd'hui »), un test par fonction de l'inventaire (`docs/inventaire-accueil.md`), retour d'arrière-plan 29 / 31 min, URL d'ouverture, hors-ligne, cibles ≥ 44 px, aucune erreur console.
- `board.spec.js` tourne désormais sur l'accueil (`/`) : chacun de ses tests est un test de fonction du Board retrouvée dans « Aujourd'hui ».
- `dashboard.spec.js`, `non-devis`, `offres`, `nettoyage` : le Dashboard est la zone « Pilotage » de `/` (plus de pastille « Dashboard »).

## Phase 4 — liste des projets et fiche projet (feat/phase4-projets)

- `e2e/projets.spec.js` (11 tests, 390 et 1280) : une ligne par projet actif ; compteur de chaque filtre = base = RPC `dashboard_chiffres()` (clé `projets`, migration additive `20261014_dashboard_projets.sql`) ; chaque filtre (famille, à trancher, reportés, en attente, incomplets) ; chaque tri (action, montant, étape, ancienneté) ; recherche ; ouverture d'une fiche et retour avec filtres, tri et position conservés ; points d'entrée (pastille « Projets », familles du Pilotage, ancien accueil) ; hors-ligne ; fiche (synthèse, documents typés, historique, SAV en attente de qui) avec un dossier ZZTEST jetable ; cibles ≥ 44 px, aucun débordement, aucune erreur console.
- Rien d'existant retiré : fiche client, Pipeline, Clients, Capture, accueil. La fiche dossier garde tous ses champs, rappels, notes, devis et décisions (`PiecesJointes`) ; elle gagne la synthèse, les documents typés et l'historique.
