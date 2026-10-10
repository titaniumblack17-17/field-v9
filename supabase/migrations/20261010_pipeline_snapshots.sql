-- Phase 2 — instantané quotidien du pipeline : agrégats seulement (aucun nom,
-- aucun identifiant de dossier). Un ligne par jour, type et statut.
-- Retour arrière : supabase/rollback/20261010_pipeline_snapshots_rollback.sql

create table if not exists public.pipeline_snapshots (
  jour date not null,
  type text not null,
  statut text not null,
  nb_dossiers integer not null,
  montant_estime_total numeric not null default 0,   -- somme des montants renseignés
  nb_sans_montant integer not null default 0,        -- montant NULL, compté à part
  primary key (jour, type, statut)
);

create or replace function public.prendre_instantane_pipeline()
returns integer
language plpgsql
as $function$
declare
  aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  n integer;
begin
  insert into public.pipeline_snapshots (jour, type, statut, nb_dossiers, montant_estime_total, nb_sans_montant)
  select aujourd_hui, d.type, d.statut, count(*),
         coalesce(sum(d.montant_estime), 0),
         count(*) filter (where d.montant_estime is null)
  from public.dossiers d
  group by d.type, d.statut
  on conflict (jour, type, statut) do update
    set nb_dossiers = excluded.nb_dossiers,
        montant_estime_total = excluded.montant_estime_total,
        nb_sans_montant = excluded.nb_sans_montant;
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- Premier instantané immédiat, puis chaque soir à 21 h 30 UTC (23 h 30 à Paris
-- l'été, 22 h 30 l'hiver : toujours le jour qui se termine).
select public.prendre_instantane_pipeline();

select cron.schedule('pipeline-snapshot-quotidien', '30 21 * * *', 'select public.prendre_instantane_pipeline();')
where not exists (select 1 from cron.job where jobname = 'pipeline-snapshot-quotidien');
