-- Retour à l'état d'avant 20261010_pipeline_snapshots.sql.
select cron.unschedule('pipeline-snapshot-quotidien')
where exists (select 1 from cron.job where jobname = 'pipeline-snapshot-quotidien');
drop function if exists public.prendre_instantane_pipeline();
drop table if exists public.pipeline_snapshots;
