import React, { useState } from 'react'
import { nomClient } from '../lib/client'
import {
  TYPE_LABELS,
  styleDossier,
  PLAN_SANS_COMMERCIAL,
} from '../constants/dossiers'

// Objectif annuel de la spec (§1) : 5 M€ TTC.

export const euros = (n) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €'

// Même normalisation que ClientList.jsx/ChoixClient.jsx : insensible aux
// accents et à la casse, pour que « poirot » retrouve « Poirot ».
export const normaliser = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export const TAG_LABELS = {
  rappel: 'Rappel',
  sav: 'SAV',
  tache: 'Tâche',
  devis: 'Devis',
  relance_devis: 'Relance devis',
}
// Couleur par type de tag dans « Aussi à traiter », où plusieurs familles se
// mélangent dans une même liste triée par urgence — le texte seul (« Rappel »
// vs « Tâche ») ne suffisait pas à distinguer au premier coup d'œil. Tokens
// déjà en place, aucune couleur ajoutée : accent pour un rappel simple,
// alerte pour tout ce qui touche un devis (même famille visuelle que le
// « j sans réponse » déjà en alerte), neutre pour SAV/Tâche — leur propre
// ligne (statut, échéance) porte déjà l'information de gravité.
const TAG_STYLES = {
  rappel: 'text-accent bg-accent-doux',
  relance_devis: 'text-alerte bg-alerte/10',
  devis: 'text-alerte bg-alerte/10',
  sav: 'text-texte-faible bg-carte-douce',
  tache: 'text-texte-faible bg-carte-douce',
}

export function Ligne({ dossier, onOuvrir, droite, droiteClasse, alerte, onFait, sousTitre, ligneSecondaire, tag }) {
  const s = styleDossier(dossier)
  const [enCours, setEnCours] = useState(false)

  const fait = async (e) => {
    e.stopPropagation()
    setEnCours(true)
    await onFait(dossier)
    setEnCours(false)
  }

  return (
    <li
      style={{ borderColor: s.bordure }}
      className="bg-carte rounded-xl shadow-sm border-l-[7px] flex items-stretch"
    >
      <button
        onClick={() => onOuvrir(dossier)}
        className="flex-1 min-w-0 text-left px-4 py-3 active:scale-[0.98] transition flex items-center gap-3"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-texte truncate">
            {/* Tag de type (Rappel/SAV/Tâche/Devis) : seulement dans la liste
                fusionnée « Aussi à traiter », où plusieurs familles se
                mélangent — inutile dans les 7 sections détaillées plus bas,
                déjà homogènes chacune sur son propre type. */}
            {tag && (
              <span
                className={`inline-block align-middle text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 mr-1.5 ${TAG_STYLES[tag] ?? 'text-texte-faible bg-carte-douce'}`}
              >
                {TAG_LABELS[tag] ?? tag}
              </span>
            )}
            {nomClient(dossier.clients) ?? '—'}
          </p>
          <p className="text-sm text-texte-doux truncate">
            {dossier.commercial ? `${dossier.commercial} · ` : ''}
            {/* Le titre du dossier est souvent vide ou générique
                (« Projet de vente ») : sur un rappel, ce qui compte, c'est
                l'objet de l'appel, pas le type du dossier. */}
            {ligneSecondaire || dossier.titre || TYPE_LABELS[dossier.type]}
          </p>
          {sousTitre && <p className="text-xs text-alerte mt-0.5">{sousTitre}</p>}
          {PLAN_SANS_COMMERCIAL(dossier) && (
            <p className="text-xs text-alerte mt-0.5">Commercial à préciser</p>
          )}
        </div>
        {droite && (
          // Une couleur fournie l'emporte : un retard doit rester rouge même
          // dans une section dont le défaut est orange.
          <span
            className={`text-sm flex-shrink-0 text-right ${
              droiteClasse ?? (alerte ? 'text-alerte font-medium' : 'text-texte-doux')
            }`}
          >
            {droite}
          </span>
        )}
      </button>
      {onFait && (
        <button
          onClick={fait}
          disabled={enCours}
          aria-label="Marquer comme traité"
          title="Traité"
          className="w-14 flex-shrink-0 flex items-center justify-center text-texte-fantome text-xl active:text-accent disabled:opacity-40 border-l border-separateur"
        >
          {enCours ? '…' : '✓'}
        </button>
      )}
    </li>
  )
}

// En-tête de Section : chevron ▶ (rotate-90 à l'ouverture), titre, compteur
// coloré à droite — la même carte repliable pour les 7 sections de la page,
// jamais l'une qui détonne visuellement des autres. Toujours affiché, même
// à 0 : le chevron ne se cache pas selon le contenu, seul le corps change.
export function EnTeteCarte({ titre, compte, urgent, ouverte, onToggle }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-3 text-left">
      <span
        className={`text-texte-faible text-[10px] flex-shrink-0 transition-transform ${ouverte ? 'rotate-90' : ''}`}
        aria-hidden="true"
      >
        ▶
      </span>
      <span className="flex-1 text-sm font-medium text-texte truncate">{titre}</span>
      <span className={`text-sm font-semibold flex-shrink-0 ${urgent ? 'text-alerte' : 'text-texte-doux'}`}>
        {compte}
      </span>
    </button>
  )
}

// Remplace l'accordéon pour les sections dont le détail vit ailleurs
// (Pipeline, ou « Aussi à traiter » plus haut sur ce même Board) : chevron
// › de navigation, jamais de contenu déplié sur place — un simple nom +
// compteur, comme EnTeteCarte, mais qui part au tap au lieu de s'ouvrir.
export function LigneNavigation({ titre, compte, urgent, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-4 py-3 text-left bg-carte rounded-xl shadow-sm active:scale-[0.98] transition"
    >
      <span className="flex-1 text-sm font-medium text-texte truncate">{titre}</span>
      <span className={`text-sm font-semibold flex-shrink-0 ${urgent ? 'text-alerte' : 'text-texte-doux'}`}>
        {compte}
      </span>
      <span className="text-texte-faible text-base flex-shrink-0" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

// Tuile compacte de la grille 2x2 : un chiffre à lire d'un coup d'œil, pas de
// détail — le détail, c'est le board et « Aussi à traiter » juste en dessous.
export function TuileKPI({ titre, valeur, sousTitre, urgent, onClick, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`bg-carte rounded-xl shadow-sm px-3 py-3 text-left active:scale-[0.98] transition min-w-0 ${className}`}
    >
      <p className="text-xs text-texte-doux truncate">{titre}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${urgent ? 'text-alerte' : 'text-texte'}`}>{valeur}</p>
      {sousTitre && <p className="text-xs text-texte-faible mt-0.5 truncate">{sousTitre}</p>}
    </button>
  )
}

// Carte « Priorité du jour » : le seul élément (tous types confondus) au
// retard le plus long. Accent ambre = le token `alerte` existant de l'app
// (déjà l'orange du code couleur des échéances), pas une couleur importée —
// cohérent avec le reste de l'interface plutôt qu'une nouvelle teinte.
// Anomalies détectées (loupe-audit-integrite, table loupe_memoire) : une
// ligne par anomalie non résolue, avec un bouton pour la marquer traitée une
// fois vérifiée à la main — jamais de correction automatique, cette loupe ne
// fait que journaliser.
const LIBELLES_ANOMALIE = {
  rappel_fk_invalide: 'Rappel sans dossier valide',
  dossier_todoist_zombie: 'Tâche Todoist disparue',
  capture_suggestion_orpheline: 'Suggestion de capture jamais rattachée',
  plan_remuneration_manquante: 'Plan sans rémunération valide',
  rappel_date_anterieure_import: 'Rappel antérieur à son dossier',
}

const resumeAnomalie = (a) => {
  const c = a.contexte || {}
  switch (a.type_erreur) {
    case 'rappel_fk_invalide':
      return `Rappel ${c.rappel_id} — dossier introuvable (${c.dossier_id_manquant})`
    case 'dossier_todoist_zombie':
      return `${c.titre || 'Sans titre'} — tâche ${c.todoist_task_id} absente de Todoist`
    case 'capture_suggestion_orpheline':
      return `Capture « ${(c.texte || '').slice(0, 60) || '—'} » — suggestion ${c.type} jamais rattachée`
    case 'plan_remuneration_manquante':
      return `${c.titre || 'Sans titre'} — rémunération : ${c.remuneration_type ?? '—'}`
    case 'rappel_date_anterieure_import':
      return `${c.titre || 'Sans titre'} — rappel du ${c.rappel_date}, dossier créé le ${String(c.dossier_created_at).slice(0, 10)}`
    default:
      return JSON.stringify(c)
  }
}

export function CarteAnomalies({ anomalies, ouverte, onToggle, onResoudre }) {
  return (
    <section className="mt-6 bg-carte rounded-xl overflow-hidden">
      <EnTeteCarte
        titre="Anomalies détectées"
        compte={anomalies.length}
        urgent={anomalies.length > 0}
        ouverte={ouverte}
        onToggle={onToggle}
      />
      {ouverte && (
        <div className="px-4 pb-3">
          {anomalies.length === 0 ? (
            <p className="text-texte-faible text-sm">Aucune anomalie en attente.</p>
          ) : (
            <ul className="space-y-2">
              {anomalies.map((a) => (
                <li key={a.id} className="bg-carte-douce rounded-xl px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-alerte">
                      {LIBELLES_ANOMALIE[a.type_erreur] ?? a.type_erreur}
                    </p>
                    <p className="text-sm text-texte-doux mt-0.5 break-words">{resumeAnomalie(a)}</p>
                  </div>
                  <button
                    onClick={() => onResoudre(a.id)}
                    className="flex-shrink-0 text-xs text-accent font-semibold h-9 px-3 rounded-full bg-carte"
                  >
                    Traité
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

// Rapport hebdo (loupe-rapport-hebdo) : même carte repliable que les 7
// sections détaillées (EnTeteCarte réutilisé tel quel), simplement avec un
// contenu texte préformaté au lieu d'une liste de dossiers — la synthèse
// n'a pas de « ligne » à afficher une par une.
export function CarteRapportHebdo({ rapport, ouverte, onToggle }) {
  const dateLabel = rapport
    ? new Date(rapport.semaine + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    : '—'
  return (
    <section className="mt-6 bg-carte rounded-xl overflow-hidden">
      <EnTeteCarte titre="Rapport hebdo" compte={dateLabel} urgent={false} ouverte={ouverte} onToggle={onToggle} />
      {ouverte && (
        <div className="px-4 pb-4">
          {rapport ? (
            <pre className="text-sm text-texte-doux whitespace-pre-wrap font-sans leading-relaxed">
              {rapport.contenu}
            </pre>
          ) : (
            <p className="text-texte-faible text-sm">Aucun rapport disponible pour l'instant.</p>
          )}
        </div>
      )}
    </section>
  )
}
