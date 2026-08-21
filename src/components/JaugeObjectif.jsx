import React from 'react'

const MILLION = 1_000_000
const TRANCHES = 5

// La couleur dit à quelle tranche de million on est arrivé : on lit sa position
// dans l'année d'un coup d'œil, sans déchiffrer un nombre à sept chiffres.
const PALETTE = [
  { fond: '#64748B', nom: 'Sous le premier million' },
  { fond: '#3B82F6', nom: 'Premier million franchi' },
  { fond: '#0EA5E9', nom: 'Deuxième million franchi' },
  { fond: '#10B981', nom: 'Troisième million franchi' },
  { fond: '#F59E0B', nom: 'Quatrième million franchi' },
  { fond: '#EAB308', nom: 'Objectif atteint' },
]

const euros = (n) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n ?? 0) + ' €'

// Fraction de l'année écoulée. L'objectif est annuel : à mi-année, la moitié
// est due. C'est la seule notion de rythme dont on ait besoin — un commercial
// sait si son mois d'août ressemble à son mois de mars.
const partAnneeEcoulee = (maintenant = new Date()) => {
  const debut = new Date(maintenant.getFullYear(), 0, 1)
  const fin = new Date(maintenant.getFullYear() + 1, 0, 1)
  return (maintenant - debut) / (fin - debut)
}

// Part d'une tranche donnée couverte par un montant. Chaque segment vaut un
// million : le remplissage se calcule tranche par tranche, pas globalement.
const part = (valeur, i) =>
  Math.max(0, Math.min(1, (valeur - i * MILLION) / MILLION)) * 100

function Pastille({ couleur, opacite, libelle, montant }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ background: couleur, opacity: opacite }}
      />
      <span className="text-xs text-texte-doux flex-1">{libelle}</span>
      <span className="text-sm text-texte font-medium tabular-nums">{euros(montant)}</span>
    </div>
  )
}

/**
 * Avancement vers l'objectif annuel, en tranches d'un million.
 *
 * Trois montants superposés dans la même jauge plutôt que trois barres : ils
 * mesurent le même chemin à trois degrés de certitude, et les empiler montre
 * ce qui sépare l'espéré du réalisé.
 */
export default function JaugeObjectif({
  annee,
  projection,
  signe,
  facture,
  reportables = 0,
  objectif = 5 * MILLION,
}) {
  const franchis = Math.min(TRANCHES, Math.floor(signe / MILLION))
  const teinte = PALETTE[franchis]
  const pourcentage = Math.round((signe / objectif) * 100)

  // Repère de rythme : là où il faudrait en être aujourd'hui pour finir l'année
  // à l'objectif. Sans lui, la jauge dit où l'on est mais pas si l'on tient.
  const ecoule = partAnneeEcoulee()
  const attendu = objectif * ecoule
  const ecart = signe - attendu
  const trancheAttendue = Math.min(TRANCHES - 1, Math.floor(attendu / MILLION))
  const dansLaTranche = ((attendu % MILLION) / MILLION) * 100

  return (
    <div className="bg-carte rounded-xl shadow-sm px-4 py-4">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-2xl font-semibold text-texte tabular-nums">{euros(signe)}</span>
        <span className="text-sm text-texte-doux">
          sur {euros(objectif)}{annee ? ` en ${annee}` : ''}
        </span>
      </div>
      <p className="text-xs mb-3" style={{ color: teinte.fond }}>
        {teinte.nom} · {pourcentage} %
      </p>

      <div className="flex gap-1" role="img" aria-label={`${euros(signe)} signés sur ${euros(objectif)}`}>
        {Array.from({ length: TRANCHES }, (_, i) => (
          <div key={i} className="relative flex-1 h-3">
            <div className="absolute inset-0 rounded-full overflow-hidden bg-carte-douce">
            {/* Du plus incertain au plus sûr : la projection derrière, le
                facturé devant, pour que le réalisé reste toujours lisible. */}
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${part(projection, i)}%`, background: teinte.fond, opacity: 0.2 }}
            />
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${part(signe, i)}%`, background: teinte.fond, opacity: 0.55 }}
            />
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${part(facture, i)}%`, background: teinte.fond }}
            />
            </div>
            {/* Placé dans son propre segment plutôt que sur la largeur totale :
                les espaces entre tranches décaleraient le repère. */}
            {i === trancheAttendue && (
              <span
                aria-hidden="true"
                className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-texte-doux"
                style={{ left: `${dansLaTranche}%` }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-1 mt-1">
        {Array.from({ length: TRANCHES }, (_, i) => (
          <span key={i} className="flex-1 text-[10px] text-texte-faible text-right">
            {i + 1} M
          </span>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <Pastille couleur={teinte.fond} opacite={1} libelle="Facturé" montant={facture} />
        <Pastille couleur={teinte.fond} opacite={0.55} libelle="Signé" montant={signe} />
        <Pastille couleur={teinte.fond} opacite={0.2} libelle="Projection" montant={projection} />
      </div>

      <p className="text-xs text-texte-doux mt-3">
        {Math.round(ecoule * 100)} % de l'année écoulée. Pour tenir l'objectif, il faudrait{' '}
        {euros(attendu)} à ce jour —{' '}
        <span className={ecart < 0 ? 'text-alerte font-medium' : 'text-texte font-medium'}>
          {ecart < 0 ? `${euros(-ecart)} de retard` : `${euros(ecart)} d'avance`}
        </span>
        {' '}sur les montants connus.
      </p>

      {reportables > 0 && annee && (
        <p className="text-xs text-texte-faible mt-3 pt-3 border-t border-separateur">
          {reportables} affaire{reportables > 1 ? 's' : ''} signée{reportables > 1 ? 's' : ''} mais
          non réglée{reportables > 1 ? 's' : ''}. Ce qui ne le sera pas au 31 décembre bascule sur
          l'objectif {annee + 1}.
        </p>
      )}
    </div>
  )
}
