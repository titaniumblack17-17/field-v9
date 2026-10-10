-- Décision par offre : chaque offre d'un devis (élément du tableau jsonb `variantes`)
-- porte désormais un `etat` : retenue | a_trancher | ecartee | reportee, plus, en
-- option, `projet` (étiquette courte), `date_reprise` (offre reportée) et `base`
-- ('ht' | 'ttc', quand le devis laisse un doute). Aucune colonne ajoutée :
-- variantes_retenues et variante_retenue restent la mémoire des offres retenues.
-- Remplissage : les offres déjà retenues restent retenues, les autres restent
-- à trancher. Aucun montant n'est touché (le déclencheur ne porte pas sur `variantes`).
-- Retour arrière : supabase/rollback/20261013_offres_etat_rollback.sql
update public.fichiers f
set variantes = (
  select jsonb_agg(
           case
             when o.value ? 'etat' then o.value
             when (o.ord - 1)::int = any(coalesce(f.variantes_retenues, array[]::int[]))
               then o.value || jsonb_build_object('etat', 'retenue')
             else o.value || jsonb_build_object('etat', 'a_trancher')
           end
           order by o.ord)
  from jsonb_array_elements(f.variantes) with ordinality as o(value, ord)
)
where f.variantes is not null
  and jsonb_typeof(f.variantes) = 'array'
  and jsonb_array_length(f.variantes) >= 1
  and exists (select 1 from jsonb_array_elements(f.variantes) x where not (x ? 'etat'));
