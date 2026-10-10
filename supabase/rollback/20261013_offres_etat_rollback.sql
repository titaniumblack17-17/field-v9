-- Retour à l'état d'avant 20261013_offres_etat.sql : les offres perdent leurs
-- clés d'état, d'étiquette, de reprise et de base ; les montants ne bougent pas.
update public.fichiers f
set variantes = (
  select jsonb_agg(o.value - 'etat' - 'projet' - 'date_reprise' - 'base' order by o.ord)
  from jsonb_array_elements(f.variantes) with ordinality as o(value, ord)
)
where f.variantes is not null and jsonb_typeof(f.variantes) = 'array' and jsonb_array_length(f.variantes) >= 1;
