# Catalogue produits — pilote Planmeca Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un écran Catalogue dans Field V9 où Bruce retrouve le prix d'un produit Planmeca (conseillé + offre en cours) sans ouvrir Excel, alimenté par un script d'import qu'on relance à la main.

**Architecture:** Une table Supabase `produits` (RLS désactivée, comme le reste du projet). Un script Node autonome (hors du bundle Vite) parse le classeur Excel Planmeca feuille par feuille et remplace entièrement les produits de la marque à chaque exécution. Un nouvel écran React lit cette table en lecture seule (pas d'abonnement temps réel : la donnée ne change que par réimport), avec recherche côté client et une vue détail repliée dans le même composant.

**Tech Stack:** React 18, Vite 5, Tailwind 3, Supabase (Postgres + supabase-js), Node 24 (`node:test` intégré, aucune nouvelle dépendance de test), `xlsx` (SheetJS) pour la lecture du classeur, `dotenv` pour charger `.env` dans le script.

## Global Constraints

- Spec source : [docs/superpowers/specs/2026-08-25-catalogue-produits-pilote-planmeca-design.md](../specs/2026-08-25-catalogue-produits-pilote-planmeca-design.md)
- Pilote sur **Planmeca uniquement** — ne rien construire pour les 17 autres marques.
- Prix affichés : **conseillé net et offre en cours côte à côte**, jamais un seul choisi arbitrairement.
- Réimporter **remplace entièrement** les produits de la marque (vidage puis réinsertion), pas de mise à jour ligne par ligne, pas d'historique de versions.
- Pas de lien vers un dossier ou un devis, pas de rapprochement avec le matériel installé, pas de surveillance automatique de dossier — hors périmètre de ce pilote.
- Ce projet n'a **aucune suite de tests existante** (pas de Jest/Vitest, `package.json` ne liste aucun outil de test). Ne pas en introduire pour l'app React : suivre la convention établie dans PASSATION.md — vérification par le chemin réel emprunté (build, déploiement Vercel, clic dans l'app), documentée explicitement à chaque tâche. Seule la logique pure d'extraction Excel (Task 2) est testée, avec le test runner intégré à Node (`node:test`), sans nouvelle dépendance.
- RLS reste désactivée sur la nouvelle table, comme sur `clients`, `dossiers`, `fichiers` (vérifié : `relrowsecurity = false` sur les trois).
- Couleurs et styles : uniquement les tokens Tailwind existants (`fond`, `carte`, `carte-douce`, `texte`, `texte-doux`, `texte-faible`, `texte-fantome`, `separateur`, `bordure`, `accent`, `alerte`, `erreur`), définis dans `tailwind.config.js` / `src/index.css`. Ne pas introduire de nouvelle couleur.
- `npm run build` lance `eslint src` puis `vite build` : `src/` doit rester propre au lint. Le dossier `scripts/` n'est pas couvert par ce lint (hors du glob `src/**/*.{js,jsx}`), donc pas de contrainte ESLint dessus, mais le code doit rester lisible et cohérent avec le reste du dépôt (commentaires en français, uniquement pour le POURQUOI non évident).

---

## Task 1: Table `produits` sur Supabase

**Files:**
- Aucun fichier local — le schéma de ce projet est géré en direct via l'outil MCP Supabase `apply_migration` (pas de dossier `supabase/migrations/` suivi dans ce dépôt ; vérifié : `find supabase -type d` ne montre que `supabase/functions/`).

**Interfaces:**
- Produit : table `produits` avec les colonnes `id, marque, modele, code, designation, instruction, prix_conseille, prix_offre, offre_periode, fichier_source, importe_le`.
- Consommée par : Task 3 (script d'import, écrit dedans) et Task 4 (écran Catalogue, lit dedans).

- [ ] **Step 1: Appliquer la migration**

Via l'outil MCP Supabase `apply_migration` (project_id `qgbdhwkdbmplvpflsgdt`, name `creer_table_produits`) ou l'éditeur SQL Supabase, exécuter :

```sql
create table public.produits (
  id uuid primary key default gen_random_uuid(),
  marque text not null,
  modele text not null,
  code text not null,
  designation text not null,
  instruction text,
  prix_conseille numeric not null,
  prix_offre numeric,
  offre_periode text,
  fichier_source text not null,
  importe_le timestamptz not null default now()
);

create index produits_marque_idx on public.produits (marque);
```

- [ ] **Step 2: Vérifier que la table existe et que RLS reste désactivée**

Via l'outil MCP Supabase `execute_sql` (project_id `qgbdhwkdbmplvpflsgdt`) :

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'produits'
order by ordinal_position;

select relrowsecurity from pg_class where relname = 'produits';
```

Expected: 11 colonnes listées correspondant exactement à la liste ci-dessus, et `relrowsecurity = false`.

- [ ] **Step 3: Commit**

Rien à committer dans le dépôt git pour cette tâche (changement appliqué directement sur Supabase, comme le reste du schéma du projet). Passer à la tâche suivante.

---

## Task 2: Logique pure d'extraction des lignes produits (TDD)

**Files:**
- Create: `scripts/lib/extraire-produits.mjs`
- Test: `scripts/lib/extraire-produits.test.mjs`

**Interfaces:**
- Produces: `extraireProduitsDeFeuille(lignes: Array<Array<string|number|null>>) => Array<{ code: string, designation: string, instruction: string|null, prixConseille: number, prixOffre: number|null, offrePeriode: string|null }>`
- Consumed by: Task 3 (`scripts/importer-catalogue-planmeca.mjs`).

Cette fonction ne dépend d'aucune bibliothèque externe (elle prend un tableau de tableaux déjà en mémoire, pas un fichier) : elle se teste avec `node:test`, intégré à Node 24, sans installer de framework de test.

Format des lignes réel (vérifié sur le fichier Planmeca de Bruce, feuille "Planmeca Viso G1") : après une ligne d'en-tête `['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre valable du ... au ...', ...]`, chaque ligne produit a son code en colonne 0 et son prix conseillé en colonne 4 (index 0-based). Les lignes de titre de section (ex. `['1. Supports du patient supplémentaires']`) et la ligne de totaux juste après l'en-tête n'ont pas de prix en colonne 4 : elles doivent être ignorées.

- [ ] **Step 1: Écrire les tests (ils doivent échouer, le fichier source n'existe pas encore)**

Créer `scripts/lib/extraire-produits.test.mjs` :

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extraireProduitsDeFeuille } from './extraire-produits.mjs'

test('extrait une ligne produit simple avec prix conseillé et offre', () => {
  const lignes = [
    ['DEVIS '],
    [],
    [
      'Code',
      'Désignation',
      'Instruction',
      'Qté',
      'Tarif des prix de revente conseillés net',
      'Offre valable du 01/07/2026 au 30/09/2026',
    ],
    ['FE005246', 'Planmeca Viso G1', null, null, 97737, 45850],
  ]
  const produits = extraireProduitsDeFeuille(lignes)
  assert.deepEqual(produits, [
    {
      code: 'FE005246',
      designation: 'Planmeca Viso G1',
      instruction: null,
      prixConseille: 97737,
      prixOffre: 45850,
      offrePeriode: 'Offre valable du 01/07/2026 au 30/09/2026',
    },
  ])
})

test('une ligne sans offre en cours a un prix et une période nuls', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    ['FE004204', 'Résolution endodontique', null, null, 4486, null],
  ]
  const [produit] = extraireProduitsDeFeuille(lignes)
  assert.equal(produit.prixOffre, null)
  assert.equal(produit.offrePeriode, null)
})

test('garde l’instruction quand elle est présente', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    [
      'FE005247',
      'Céphalostat Planmeca ProCeph A',
      'Prix valable uniquement avec achat de matériel neuf',
      null,
      39895,
      16920,
    ],
  ]
  const [produit] = extraireProduitsDeFeuille(lignes)
  assert.equal(produit.instruction, 'Prix valable uniquement avec achat de matériel neuf')
})

test('ignore les lignes de titre de section sans code ni prix', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    ['Planmeca Viso G1', null, null, null, null, null],
    ['1. Supports du patient supplémentaires', null, null, null, null, null],
    ['FE004174', 'Planmeca CALM', null, null, 1855, null],
  ]
  const produits = extraireProduitsDeFeuille(lignes)
  assert.equal(produits.length, 1)
  assert.equal(produits[0].code, 'FE004174')
})

test('ignore la ligne de totaux sans code juste après l’en-tête', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    [null, null, null, null, null, null, 0, 0, 0, 0],
    ['FE004174', 'Planmeca CALM', null, null, 1855, null],
  ]
  const produits = extraireProduitsDeFeuille(lignes)
  assert.equal(produits.length, 1)
})

test('accepte un code numérique (Excel sans zéro non significatif)', () => {
  const lignes = [
    ['Code', 'Désignation', 'Instruction', 'Qté', 'Tarif des prix de revente conseillés net', 'Offre'],
    [30006504, 'Tabouret Planmeca Lumo', 'Prix spécial avec l’unit 3D', null, 1166, null],
  ]
  const [produit] = extraireProduitsDeFeuille(lignes)
  assert.equal(produit.code, '30006504')
})

test('renvoie un tableau vide si aucune ligne d’en-tête « Code » n’est trouvée', () => {
  const lignes = [
    ['Offre_Reprise', 'G1'],
    ['Oui', 45385],
    ['Non', 48462],
  ]
  assert.deepEqual(extraireProduitsDeFeuille(lignes), [])
})
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `node --test scripts/lib`
Expected: FAIL — `Cannot find module './extraire-produits.mjs'` (ou équivalent), 7 tests en erreur.

- [ ] **Step 3: Implémenter la fonction**

Créer `scripts/lib/extraire-produits.mjs` :

```js
// Une ligne compte comme un produit si elle porte un code (colonne 0) ET un
// prix conseillé numérique (colonne 4) — les lignes de titre de section
// (« 1. Supports du patient supplémentaires ») et la ligne de totaux juste
// après l'en-tête n'ont ni l'un ni l'autre, et sont donc ignorées sans règle
// spéciale : le même filtre les exclut naturellement.
export function extraireProduitsDeFeuille(lignes) {
  const indexEntete = lignes.findIndex((ligne) => String(ligne?.[0] ?? '').trim() === 'Code')
  if (indexEntete === -1) return []

  const periodeOffreBrute = lignes[indexEntete][5]
  const periodeOffreTexte =
    typeof periodeOffreBrute === 'string' && periodeOffreBrute.trim()
      ? periodeOffreBrute.trim()
      : null

  const produits = []
  for (const ligne of lignes.slice(indexEntete + 1)) {
    const code = ligne?.[0]
    const prixConseille = ligne?.[4]
    if (code == null || String(code).trim() === '') continue
    if (typeof prixConseille !== 'number' || !Number.isFinite(prixConseille)) continue

    const prixOffre =
      typeof ligne[5] === 'number' && Number.isFinite(ligne[5]) ? ligne[5] : null

    produits.push({
      code: String(code).trim(),
      designation: String(ligne[1] ?? '').trim() || String(code).trim(),
      instruction:
        ligne[2] != null && String(ligne[2]).trim() ? String(ligne[2]).trim() : null,
      prixConseille,
      prixOffre,
      offrePeriode: prixOffre != null ? periodeOffreTexte : null,
    })
  }
  return produits
}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `node --test scripts/lib`
Expected: PASS — 7 tests réussis, 0 échec.

- [ ] **Step 5: Ajouter un script npm pour relancer ces tests facilement**

Modifier `package.json` — dans `"scripts"`, ajouter une entrée `test` :

```json
  "scripts": {
    "dev": "vite",
    "build": "eslint src && vite build",
    "preview": "vite preview",
    "lint": "eslint src",
    "test": "node --test scripts/lib"
  },
```

Run: `npm test`
Expected: même résultat que Step 4 (7 tests réussis).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/extraire-produits.mjs scripts/lib/extraire-produits.test.mjs package.json
git commit -m "feat: extraction pure des lignes produits d'une feuille de tarif Planmeca"
```

---

## Task 3: Script d'import CLI

**Files:**
- Create: `scripts/importer-catalogue-planmeca.mjs`
- Modify: `package.json` (ajout des dépendances `xlsx` et `dotenv`)

**Interfaces:**
- Consumes: `extraireProduitsDeFeuille` de `scripts/lib/extraire-produits.mjs` (Task 2) ; table `produits` (Task 1) ; `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` du fichier `.env` existant (déjà utilisé par `src/lib/supabaseClient.js`, RLS désactivée donc la clé publique suffit en écriture).
- Produces: lignes dans la table `produits` avec `marque = 'Planmeca'`.

- [ ] **Step 1: Installer les dépendances**

```bash
npm install --save-dev xlsx@^0.18.5 dotenv@^17.4.2
```

Expected: `package.json` gagne ces deux lignes dans `devDependencies`, `package-lock.json` est mis à jour, aucune erreur d'installation.

- [ ] **Step 2: Écrire le script d'import**

Créer `scripts/importer-catalogue-planmeca.mjs` :

```js
#!/usr/bin/env node
import { basename } from 'node:path'
import 'dotenv/config'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { extraireProduitsDeFeuille } from './lib/extraire-produits.mjs'

const MARQUE = 'Planmeca'
// Feuille de métadonnées internes (barème remise/reprise), sans ligne de
// produit — la faire analyser ne casserait rien (extraireProduitsDeFeuille
// renverrait []), mais l'ignorer explicitement évite un avertissement inutile
// dans le résumé affiché en fin d'import.
const FEUILLES_IGNOREES = new Set(['Ressource'])

const cheminFichier = process.argv[2]
if (!cheminFichier) {
  console.error(
    'Usage : node scripts/importer-catalogue-planmeca.mjs "<chemin du fichier tarif>.xlsx"'
  )
  process.exit(1)
}

const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env
if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
  console.error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définis (fichier .env).')
  process.exit(1)
}

const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)

const classeur = XLSX.readFile(cheminFichier)
const importeLe = new Date().toISOString()
const nomFichier = basename(cheminFichier)

const produits = []
const resumeParFeuille = []

for (const nomFeuille of classeur.SheetNames) {
  if (FEUILLES_IGNOREES.has(nomFeuille)) continue
  const feuille = classeur.Sheets[nomFeuille]
  const lignes = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: null })
  const extraits = extraireProduitsDeFeuille(lignes)
  resumeParFeuille.push([nomFeuille, extraits.length])
  for (const p of extraits) {
    produits.push({
      marque: MARQUE,
      modele: nomFeuille,
      code: p.code,
      designation: p.designation,
      instruction: p.instruction,
      prix_conseille: p.prixConseille,
      prix_offre: p.prixOffre,
      offre_periode: p.offrePeriode,
      fichier_source: nomFichier,
      importe_le: importeLe,
    })
  }
}

console.log(
  `${produits.length} produits extraits de ${classeur.SheetNames.length - FEUILLES_IGNOREES.size} feuilles :`
)
for (const [feuille, n] of resumeParFeuille) {
  console.log(n === 0 ? `  ⚠ ${feuille} : aucun produit (à vérifier si inattendu)` : `  ${feuille} : ${n}`)
}

if (produits.length === 0) {
  console.error('Aucun produit extrait — rien à importer, arrêt sans toucher à la base.')
  process.exit(1)
}

// Réimporter remplace entièrement les produits de la marque (vidage puis
// réinsertion) plutôt qu'une mise à jour ligne par ligne : un produit disparu
// du nouveau tarif disparaît aussi du catalogue, sans laisser de fiche
// périmée invisible.
const { error: erreurSuppression } = await supabase.from('produits').delete().eq('marque', MARQUE)
if (erreurSuppression) {
  console.error('Échec de la suppression des produits existants :', erreurSuppression.message)
  process.exit(1)
}

const TAILLE_LOT = 500
for (let i = 0; i < produits.length; i += TAILLE_LOT) {
  const lot = produits.slice(i, i + TAILLE_LOT)
  const { error } = await supabase.from('produits').insert(lot)
  if (error) {
    console.error(`Échec de l'import du lot ${Math.floor(i / TAILLE_LOT) + 1} :`, error.message)
    process.exit(1)
  }
}

console.log(`Import terminé : ${produits.length} produits Planmeca en base.`)
```

- [ ] **Step 3: Lancer l'import sur le vrai fichier de Bruce**

Run:
```bash
node scripts/importer-catalogue-planmeca.mjs "/Users/brucedasilva/Library/Mobile Documents/com~apple~CloudDocs/Bailleul (IcD)/Configurateur/PLANMECA/2026/TARIF PM 2026 - V01072026.xlsx"
```
Expected: le résumé par feuille s'affiche (une ligne par onglet, ex. `Planmeca Viso G1 : 7`), suivi de `Import terminé : N produits Planmeca en base.` avec N > 0. Toute feuille à `0` avec `⚠` n'est pas forcément une erreur (ex. "Planmeca Romexis subscription" peut n'avoir aucune ligne chiffrée) — la lire pour confirmer que ce n'est pas un format inattendu.

- [ ] **Step 4: Vérifier dans Supabase**

Via l'outil MCP Supabase `execute_sql` (project_id `qgbdhwkdbmplvpflsgdt`) :

```sql
select count(*) as total, count(distinct modele) as modeles from produits where marque = 'Planmeca';
select modele, code, designation, prix_conseille, prix_offre from produits where marque = 'Planmeca' and code = 'FE005246';
```

Expected: `total` > 0 ; la seconde requête renvoie la ligne "Planmeca Viso G1" avec `prix_conseille = 97737` et `prix_offre = 45850`.

- [ ] **Step 5: Commit**

```bash
git add scripts/importer-catalogue-planmeca.mjs package.json package-lock.json
git commit -m "feat: script d'import du catalogue Planmeca depuis le tarif Excel"
```

---

## Task 4: Écran Catalogue et navigation

**Files:**
- Create: `src/screens/Catalogue.jsx`
- Modify: `src/screens/ClientList.jsx` (ajout du bouton et de la prop `onCatalogue`)
- Modify: `src/App.jsx` (ajout de la route `catalogue` et de l'import)

**Interfaces:**
- Consumes: table `produits` (Task 1/3), `supabase` de `src/lib/supabaseClient.js`.
- Produces: composant `Catalogue({ onBack })`, monté par `App.jsx` sur `view.name === 'catalogue'`.

- [ ] **Step 1: Créer l'écran Catalogue**

Créer `src/screens/Catalogue.jsx` :

```jsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const normalize = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const formaterPrix = (n) => `${new Intl.NumberFormat('fr-FR').format(n)} €`

export default function Catalogue({ onBack }) {
  const [produits, setProduits] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [ouvert, setOuvert] = useState(null)

  // Le catalogue ne change que par réimport manuel (script), jamais depuis
  // l'app : un chargement unique suffit, pas d'abonnement temps réel.
  useEffect(() => {
    let actif = true
    supabase
      .from('produits')
      .select('*')
      .order('designation', { ascending: true })
      .then(({ data }) => {
        if (actif) {
          setProduits(data ?? [])
          setLoading(false)
        }
      })
    return () => {
      actif = false
    }
  }, [])

  const resultats = useMemo(() => {
    const termes = normalize(query).split(/\s+/).filter(Boolean)
    if (termes.length === 0) return produits
    return produits.filter((p) => {
      const champs = normalize(
        [p.designation, p.code, p.modele, p.marque].filter(Boolean).join(' ')
      )
      return termes.every((t) => champs.includes(t))
    })
  }, [produits, query])

  const produitOuvert = produits.find((p) => p.id === ouvert) ?? null

  if (produitOuvert) {
    return (
      <div className="min-h-screen bg-fond">
        <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-3">
          <button
            onClick={() => setOuvert(null)}
            className="text-accent text-sm font-medium h-11 -ml-2 px-2 inline-flex items-center"
          >
            ← Catalogue
          </button>
        </header>
        <main className="px-4 pb-8">
          <div className="bg-carte rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-separateur">
              <p className="text-xs font-semibold text-accent uppercase tracking-wide">
                {produitOuvert.marque} · {produitOuvert.modele}
              </p>
              <h1 className="text-lg font-semibold text-texte mt-0.5">
                {produitOuvert.designation}
              </h1>
              <p className="text-xs text-texte-faible mt-0.5 tabular-nums">{produitOuvert.code}</p>
            </div>
            <div className="flex gap-5 px-4 py-3 border-b border-separateur">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-texte-faible">
                  Prix conseillé
                </p>
                <p className="text-base font-semibold text-texte tabular-nums mt-0.5">
                  {formaterPrix(produitOuvert.prix_conseille)}
                </p>
              </div>
              {produitOuvert.prix_offre != null && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-accent/80">
                    Offre en cours
                  </p>
                  <p className="text-base font-semibold text-accent tabular-nums mt-0.5">
                    {formaterPrix(produitOuvert.prix_offre)}
                  </p>
                </div>
              )}
            </div>
            {produitOuvert.offre_periode && (
              <p className="text-xs text-texte-faible px-4 py-2 border-b border-separateur">
                {produitOuvert.offre_periode}
              </p>
            )}
            {produitOuvert.instruction && (
              <p className="text-sm text-texte-doux px-4 py-3 border-b border-separateur">
                {produitOuvert.instruction}
              </p>
            )}
            <p className="text-xs text-texte-faible px-4 py-2 bg-carte-douce">
              Importé de « {produitOuvert.fichier_source} » le{' '}
              {new Date(produitOuvert.importe_le).toLocaleDateString('fr-FR')}
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-fond">
      <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-3">
        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            onClick={onBack}
            className="text-accent text-sm font-medium h-11 -ml-2 px-2 inline-flex items-center"
          >
            ← Clients
          </button>
          <h1 className="text-xl font-semibold text-texte">Catalogue</h1>
          <span className="w-11" aria-hidden="true" />
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="Nom, code ou modèle…"
          aria-label="Rechercher un produit"
          className="w-full bg-carte rounded-xl shadow-sm px-4 py-3 text-texte outline-none placeholder:text-texte-faible"
        />
      </header>

      <main className="px-4 pb-8">
        {loading && <p className="text-texte-faible text-sm">Chargement…</p>}

        {!loading && produits.length === 0 && (
          <p className="text-texte-faible text-sm mt-8 text-center">
            Aucun produit importé pour l'instant.
          </p>
        )}

        {!loading && produits.length > 0 && resultats.length === 0 && (
          <p className="text-texte-faible text-sm mt-8 text-center">
            Aucun produit pour « {query} ».
          </p>
        )}

        {query && resultats.length > 0 && (
          <p className="text-xs text-texte-faible mb-2 px-1">
            {resultats.length} résultat{resultats.length > 1 ? 's' : ''}
          </p>
        )}

        <ul className="space-y-2">
          {resultats.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setOuvert(p.id)}
                className="w-full text-left bg-carte rounded-xl px-4 py-3 shadow-sm active:scale-[0.98] transition flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-texte truncate">{p.designation}</p>
                  <p className="text-xs text-texte-faible mt-0.5 tabular-nums">{p.code}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-texte font-semibold tabular-nums">
                    {formaterPrix(p.prix_conseille)}
                  </p>
                  {p.prix_offre != null && (
                    <p className="text-xs text-accent font-semibold tabular-nums mt-0.5">
                      {formaterPrix(p.prix_offre)} en offre
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Ajouter le bouton Catalogue sur l'écran Clients**

Dans `src/screens/ClientList.jsx`, modifier la signature du composant (ligne 11) :

```jsx
export default function ClientList({ onSelect, onCreate, onCapture, onPipeline, onBrief, onCatalogue }) {
```

Puis, dans le bloc de boutons de l'en-tête (juste après le bouton "Capture", avant le bouton "+"), ajouter :

```jsx
            <button
              onClick={onCapture}
              className="px-4 h-11 rounded-full bg-carte text-accent text-sm font-medium shadow"
            >
              Capture
            </button>
            <button
              onClick={onCatalogue}
              className="px-4 h-11 rounded-full bg-carte text-accent text-sm font-medium shadow"
            >
              Catalogue
            </button>
            <button
              onClick={onCreate}
```

(Le bloc `onClick={onCapture}...Capture` existe déjà : seul le nouveau bouton `Catalogue` est ajouté entre lui et le bouton `+`.)

- [ ] **Step 3: Brancher la route dans App.jsx**

Dans `src/App.jsx`, ajouter l'import en haut du fichier, juste après celui de `BriefSoir` :

```jsx
import BriefSoir from './screens/BriefSoir'
import Catalogue from './screens/Catalogue'
```

Ajouter le bloc de route, juste après le bloc `if (view.name === 'pipeline') { ... }` et avant `if (view.name === 'dossier-create') { ... }` :

```jsx
  if (view.name === 'catalogue') {
    return <Catalogue onBack={back} />
  }

```

Enfin, passer la prop `onCatalogue` au `<ClientList>` final :

```jsx
  return (
    <ClientList
      onSelect={(client) => push({ name: 'detail', client })}
      onCreate={() => push({ name: 'create' })}
      onCapture={() => push({ name: 'capture' })}
      onPipeline={() => push({ name: 'pipeline' })}
      onBrief={() => push({ name: 'brief' })}
      onCatalogue={() => push({ name: 'catalogue' })}
    />
  )
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `eslint src` ne relève aucune erreur (des avertissements préexistants sans rapport peuvent subsister), `vite build` réussit et produit `dist/`.

- [ ] **Step 5: Vérifier en conditions réelles sur l'app déployée**

```bash
git add src/screens/Catalogue.jsx src/screens/ClientList.jsx src/App.jsx
git commit -m "feat: écran Catalogue produits, pilote Planmeca"
git push
```

Attendre le redéploiement Vercel (poll `https://field-v9.vercel.app/` jusqu'à ce que le nom du bundle JS change), puis dans le navigateur :
1. Ouvrir `https://field-v9.vercel.app`, vérifier que le bouton **Catalogue** apparaît à côté de Brief/Pipeline/Capture.
2. Le toucher, vérifier que la liste des produits Planmeca s'affiche avec les deux prix.
3. Taper "viso" dans la recherche, vérifier que les résultats se filtrent.
4. Toucher un produit ayant une offre en cours (ex. code `FE005246`), vérifier que la fiche détail affiche marque, modèle, code, les deux prix, la période de l'offre, et la source d'import.
5. Toucher « ← Catalogue » puis « ← Clients », vérifier le retour à l'écran Clients.

Expected: chaque étape se comporte comme décrit, sans erreur dans la console du navigateur.

---

## Self-Review

**1. Couverture de la spec** — chaque section de [docs/superpowers/specs/2026-08-25-catalogue-produits-pilote-planmeca-design.md](../specs/2026-08-25-catalogue-produits-pilote-planmeca-design.md) a une tâche :
- Donnée par produit → Task 1 (schéma) + Task 3 (remplissage)
- Import manuel, remplacement complet par marque → Task 3
- Écran Catalogue (recherche, deux prix, fiche détail, bouton de navigation) → Task 4
- Hors périmètre (17 autres marques, devis, matériel installé, automatisation, historique) → aucune tâche ne les couvre, conforme à l'intention.

**2. Repérage de placeholders** — aucun "TBD"/"TODO" dans le plan ; chaque étape de code est complète et exécutable telle quelle.

**3. Cohérence des types/noms** — `extraireProduitsDeFeuille` (Task 2) renvoie `{ code, designation, instruction, prixConseille, prixOffre, offrePeriode }` (camelCase, JS) ; Task 3 les mappe explicitement vers les colonnes snake_case de la table (`prix_conseille`, `prix_offre`, `offre_periode`) au moment de l'insertion — pas de confusion entre les deux conventions de nommage. Les noms de colonnes utilisés dans `Catalogue.jsx` (Task 4) correspondent exactement à ceux du schéma (Task 1) : `marque, modele, code, designation, instruction, prix_conseille, prix_offre, offre_periode, fichier_source, importe_le`.
