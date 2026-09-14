# Widget Field V9 — iPhone et Mac

Widget qui affiche en permanence les 4 chiffres du Board (Dossiers actifs,
Objectif 2026, À traiter, SAV ouverts) sans ouvrir l'app. Lecture seule,
rafraîchi périodiquement, tap → ouvre directement Field V9 (pas Safari).

**Configuration côté appareil, rien à déployer** — ce document est à suivre
une fois sur ton iPhone et une fois sur ton Mac. Rien ici n'est dans le dépôt
Git de l'app (à part ce fichier de référence).

---

## Comment ça marche

Un seul point d'entrée côté serveur : la fonction `widget_chiffres_board()`,
créée le 14/09 dans Supabase. Elle ne renvoie **que** ces 4 nombres — jamais
de nom de client, jamais de montant par dossier. Testée en conditions
réelles avec ta clé publique (`anon`) : résultat identique au Board affiché
dans l'app au moment du test (92 dossiers actifs, 12 %, 21 à traiter,
7 SAV ouverts). Documentée dans `PASSATION.md`.

Le tap sur le widget n'ouvre **pas** un lien `https://` direct — iOS et
macOS ouvriraient alors Safari, pas la PWA installée. À la place, le widget
appelle un petit Raccourci nommé **« Ouvrir Field V9 »** dont la seule
action est « Ouvrir l'app » sur Field V9 — c'est ce Raccourci qui sait
ouvrir l'app installée plutôt que le navigateur.

---

## Partie 1 — iPhone (Scriptable)

### 1.1 — Installer Scriptable

Si ce n'est pas déjà fait : App Store → **Scriptable** (gratuite, éditeur
Simon B. Støvring). Aucun compte à créer.

### 1.2 — Créer le Raccourci d'ouverture (à faire en premier)

1. Ouvre l'app **Raccourcis** sur ton iPhone.
2. Onglet **Raccourcis** → bouton **+** (nouveau raccourci).
3. Renomme-le exactement **`Ouvrir Field V9`** (appuie sur le nom en haut,
   ou ⋯ → Renommer). Le nom doit être exact — le widget s'en sert pour le
   retrouver.
4. Ajoute une action : cherche **« Ouvrir l'app »** (« Open App »).
5. Dans cette action, choisis l'app **Field V9** dans la liste — elle doit
   y apparaître si tu l'as déjà ajoutée à l'écran d'accueil depuis Safari
   (bouton Partager → Sur l'écran d'accueil). Si elle n'apparaît pas dans
   la liste des apps du Raccourci, ajoute-la d'abord à l'écran d'accueil,
   puis reviens ici.
6. Enregistre (Terminé, en haut à droite). Pas besoin de la lancer
   manuellement, le widget s'en charge.

### 1.3 — Coller le script dans Scriptable

1. Ouvre **Scriptable** → bouton **+** en haut à droite → nouveau script.
2. Efface le contenu par défaut, colle le script ci-dessous en entier.
3. Renomme le script (en haut) : par exemple **`Field V9 Board`**.
4. Appuie sur ▶ (lecture) en bas pour tester — un aperçu du widget doit
   s'afficher avec les 4 chiffres. Si tu vois un message d'erreur à la
   place, vérifie ta connexion et relance.

```javascript
// Field V9 — Widget Board (Scriptable)
// Affiche les 4 chiffres du Board (Dossiers actifs, Objectif 2026,
// À traiter, SAV ouverts) via la fonction RPC Supabase dédiée
// widget_chiffres_board() — lecture seule, aucune donnée nominative.
// Voir PASSATION.md (dépôt field-v9) pour le détail côté serveur.

const SUPABASE_URL = "https://qgbdhwkdbmplvpflsgdt.supabase.co"
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnYmRod2tkYm1wbHZwZmxzZ2R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDMwMDgsImV4cCI6MjEwMjcxOTAwOH0.NyZTbKkPnHpIiTENp9bYOwztjTTF5yDAGS6fUjJNZEE"

// Nom exact du Raccourci créé dans l'app Raccourcis (partie 1.2) — c'est lui
// qui ouvre Field V9 en app installée, pas Safari, au tap sur le widget.
const NOM_RACCOURCI_OUVERTURE = "Ouvrir Field V9"

// Suggestion de fréquence à iOS — pas une garantie : iOS lisse le
// rafraîchissement des widgets selon la batterie et l'usage réel de
// l'app. 45 min ménage l'API et la batterie sans être trop rare.
const MINUTES_RAFRAICHISSEMENT = 45

const COULEUR_FOND = new Color("#15161B")
const COULEUR_ACCENT_VIF = new Color("#22D3EE") // même cyan que l'app
const COULEUR_TEXTE = new Color("#F2F2F7")
const COULEUR_TEXTE_FAIBLE = new Color("#9A9AA5")

async function chargerChiffres() {
  const req = new Request(`${SUPABASE_URL}/rest/v1/rpc/widget_chiffres_board`)
  req.method = "POST"
  req.headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    "Content-Type": "application/json",
  }
  req.body = "{}"
  const json = await req.loadJSON()
  if (!Array.isArray(json) || !json[0]) throw new Error("Réponse inattendue")
  return json[0]
}

function formatHeure(d) {
  const h = String(d.getHours()).padStart(2, "0")
  const m = String(d.getMinutes()).padStart(2, "0")
  return `${h}:${m}`
}

function tuile(pile, titre, valeur, couleurValeur) {
  const colonne = pile.addStack()
  colonne.layoutVertically()

  const txtTitre = colonne.addText(titre.toUpperCase())
  txtTitre.font = Font.mediumSystemFont(10)
  txtTitre.textColor = COULEUR_TEXTE_FAIBLE

  colonne.addSpacer(2)

  const txtValeur = colonne.addText(String(valeur))
  txtValeur.font = Font.boldSystemFont(26)
  txtValeur.textColor = couleurValeur ?? COULEUR_TEXTE
}

async function construireWidget() {
  const widget = new ListWidget()
  widget.backgroundColor = COULEUR_FOND
  widget.url = `shortcuts://run-shortcut?name=${encodeURIComponent(NOM_RACCOURCI_OUVERTURE)}`
  widget.setPadding(14, 16, 14, 16)

  const entete = widget.addText("FIELD V9 — BOARD")
  entete.font = Font.semiboldSystemFont(11)
  entete.textColor = COULEUR_ACCENT_VIF

  widget.addSpacer(10)

  try {
    const c = await chargerChiffres()

    const ligne1 = widget.addStack()
    ligne1.layoutHorizontally()
    tuile(ligne1, "Dossiers actifs", c.dossiers_actifs)
    ligne1.addSpacer()
    tuile(ligne1, "Objectif 2026", `${c.objectif_pourcent} %`)

    widget.addSpacer(10)

    const ligne2 = widget.addStack()
    ligne2.layoutHorizontally()
    tuile(ligne2, "À traiter", c.a_traiter, c.a_traiter > 0 ? COULEUR_ACCENT_VIF : COULEUR_TEXTE)
    ligne2.addSpacer()
    tuile(ligne2, "SAV ouverts", c.sav_ouverts, c.sav_ouverts > 0 ? COULEUR_ACCENT_VIF : COULEUR_TEXTE)

    widget.addSpacer(8)
    const maj = widget.addText(`Mis à jour ${formatHeure(new Date())}`)
    maj.font = Font.regularSystemFont(9)
    maj.textColor = COULEUR_TEXTE_FAIBLE
  } catch (e) {
    const erreur = widget.addText("Impossible de charger le Board")
    erreur.font = Font.mediumSystemFont(12)
    erreur.textColor = COULEUR_TEXTE_FAIBLE
    widget.addSpacer(4)
    const detail = widget.addText(String(e.message ?? e).slice(0, 80))
    detail.font = Font.regularSystemFont(9)
    detail.textColor = COULEUR_TEXTE_FAIBLE
  }

  widget.refreshAfterDate = new Date(Date.now() + MINUTES_RAFRAICHISSEMENT * 60 * 1000)
  return widget
}

const widget = await construireWidget()

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  // Lancé depuis l'app Scriptable (bouton ▶), pas depuis le widget lui-même :
  // aperçu à l'écran pour tester avant de le poser sur l'écran d'accueil.
  await widget.presentMedium()
}
Script.complete()
```

### 1.4 — Poser le widget sur l'écran d'accueil

1. Appui long sur l'écran d'accueil → **+** en haut à gauche.
2. Cherche **Scriptable** → choisis la taille **Medium**.
3. Ajoute-le, puis appuie dessus une fois posé (mode édition, appui long
   puis « Modifier le widget ») :
   - **Script** → `Field V9 Board`
   - **When Interacting** → `Run Script` (ou laisse la valeur par défaut si
     cette option n'apparaît pas — selon la version de Scriptable, le
     comportement au tap suit directement `widget.url` défini dans le
     script)
4. Range-le où tu veux (écran d'accueil, ou écran verrouillé sur iOS 16+ en
   taille adaptée).

---

## Partie 2 — Mac (Raccourcis, macOS Sonoma et plus)

**Prérequis Mac** : Field V9 ajouté au Dock comme app web (Safari → menu
**Fichier → Ajouter au Dock…** sur la page Field V9 déjà ouverte). Une fois
fait, elle apparaît comme une vraie app dans Raccourcis.

### 2.1 — Créer le Raccourci qui récupère les 4 chiffres

1. Ouvre l'app **Raccourcis** sur le Mac.
2. **Nouveau Raccourci**, renomme-le **`Field V9 — Board`**.
3. Ajoute une seule action : **« Exécuter un script Shell »** (Run Shell
   Script) — cherche-la dans le panneau de droite. Shell : `/bin/zsh`.
4. Colle ce script dans la zone de texte de l'action :

```bash
curl -s -X POST "https://qgbdhwkdbmplvpflsgdt.supabase.co/rest/v1/rpc/widget_chiffres_board" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnYmRod2tkYm1wbHZwZmxzZ2R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDMwMDgsImV4cCI6MjEwMjcxOTAwOH0.NyZTbKkPnHpIiTENp9bYOwztjTTF5yDAGS6fUjJNZEE" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnYmRod2tkYm1wbHZwZmxzZ2R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDMwMDgsImV4cCI6MjEwMjcxOTAwOH0.NyZTbKkPnHpIiTENp9bYOwztjTTF5yDAGS6fUjJNZEE" \
  -H "Content-Type: application/json" \
  -d '{}' | /usr/bin/python3 -c "
import json, sys
d = json.load(sys.stdin)[0]
print('Dossiers actifs : ' + str(d['dossiers_actifs']))
print('Objectif 2026 : ' + str(d['objectif_pourcent']) + ' %')
print('À traiter : ' + str(d['a_traiter']))
print('SAV ouverts : ' + str(d['sav_ouverts']))
"
```

5. Ferme l'éditeur (le script Shell est la dernière et seule action : sa
   sortie devient automatiquement le résultat du Raccourci).
6. Teste tout de suite avec le bouton ▶ en haut à droite de l'éditeur — les
   4 lignes doivent s'afficher dans le panneau de résultat.

### 2.2 — Ajouter le widget au centre de notifications

1. Clique sur l'horloge (coin supérieur droit) pour ouvrir le **Centre de
   notifications**, puis **Modifier les widgets** en bas.
2. Cherche **Raccourcis** dans la liste à gauche.
3. Choisis la taille (petite ou moyenne), fais-le glisser dans le centre de
   notifications.
4. Clique sur le widget ajouté pour le configurer → sélectionne le
   Raccourci **`Field V9 — Board`**.
5. macOS rafraîchit ces widgets automatiquement à intervalle géré par le
   système (pas réglable précisément, de l'ordre de 15 à 60 min selon
   l'usage) — cohérent avec la même logique de ménagement que sur iPhone.

### 2.3 — Ouvrir Field V9 en un clic

Le comportement exact d'un clic sur un widget Raccourcis dans le Centre de
notifications macOS (relance le Raccourci vs. ouvre l'app Raccourcis)
dépend de la version de macOS et n'a pas pu être vérifié ici, faute d'accès
à un Mac pendant cette session — **à vérifier par toi en conditions
réelles**. Si le clic n'ouvre pas Field V9 directement : l'app étant déjà
épinglée au Dock (prérequis 2.1), elle reste de toute façon accessible en
un clic depuis là, ce qui couvre le même besoin sur Mac (contrairement à
l'iPhone, où l'app n'est pas à portée d'écran en permanence).

---

## Limites connues

- **Les 4 chiffres sont dupliqués côté serveur.** `widget_chiffres_board()`
  recopie la même logique que `bilan` dans `BriefSoir.jsx`, en SQL, plutôt
  que d'appeler le code existant — plus sûr pour une fonction exposée avec
  la clé publique (elle ne peut structurellement renvoyer que ces 4
  nombres), mais ça veut dire que si tu changes un jour la définition d'un
  de ces chiffres dans l'app (nouveau statut, nouvelle règle), il faudra
  répercuter le changement dans la fonction SQL à la main — elle ne se
  met pas à jour toute seule.
- **La partie 2 (Mac) n'a pas pu être testée en conditions réelles** dans
  cette session — seule la fonction RPC elle-même (partie serveur) l'a été,
  avec des résultats vérifiés contre le Board en production. Les étapes
  Scriptable et Raccourcis sont écrites d'après leur fonctionnement
  documenté, mais c'est à toi de les valider une fois posées sur tes
  appareils.
