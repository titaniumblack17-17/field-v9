// D'où vient ce contact : catégories volontairement peu nombreuses (les pros
// du lead tracking recommandent 5-7 catégories max — au-delà, personne ne les
// relit). Le détail (qui, quel événement, quel client) part dans un champ
// texte séparé plutôt que de multiplier les catégories.
export const SOURCE_OPTIONS = [
  ['so_dental', 'So Dental'],
  ['bailleul', 'Bailleul'],
  ['client', 'Un client (recommandation)'],
  ['evenement', 'Événement (salon, formation…)'],
  ['prospection', 'Prospection personnelle'],
]

export const SOURCE_LABELS = Object.fromEntries(SOURCE_OPTIONS)

// Le champ « détail » change de sens selon la source choisie : sans ce
// repère, on ne sait jamais si on doit y mettre un nom ou un événement.
export const SOURCE_DETAIL_PLACEHOLDER = {
  so_dental: 'Qui chez So Dental ?',
  bailleul: 'Qui chez Bailleul ?',
  client: 'Quel client ?',
  evenement: 'Quel événement ?',
  prospection: 'Précision (facultatif)',
}
