-- Phase 2 — historique des étapes d'un dossier. Migration additive : une table,
-- une fonction, deux déclencheurs ; aucune donnée existante n'est réécrite.
-- Retour arrière : supabase/rollback/20261010_historique_etapes_rollback.sql

create table if not exists public.dossier_etapes_historique (
  id bigint generated always as identity primary key,
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  statut_avant text,
  statut_apres text not null,
  changed_at timestamptz not null default now(),
  source text not null default 'trigger' check (source in ('trigger', 'backfill')),
  -- Vrai quand l'étape précédente est impossible à reconstituer (rétro-remplissage
  -- d'un dossier importé ou déjà déplacé avant la mise en place de l'historique).
  -- Faux avec statut_avant NULL = création réelle du dossier.
  avant_inconnu boolean not null default false
);

create index if not exists dossier_etapes_historique_dossier_idx
  on public.dossier_etapes_historique (dossier_id, changed_at);
create index if not exists dossier_etapes_historique_statut_idx
  on public.dossier_etapes_historique (statut_apres, changed_at);

-- Rétro-remplissage : seulement ce que les données établissent.
--  • dossier jamais déplacé depuis sa création (statut_changed_at = created_at) :
--    une ligne « présent dans ce statut depuis created_at » ;
--  • dossier déplacé : une ligne « arrivé dans le statut actuel à statut_changed_at »,
--    l'étape précédente reste inconnue ;
--  • dossier créé par l'import en masse du 17-21/08/2026 : created_at est la date
--    d'import, pas celle de la création réelle — marqué avant_inconnu.
insert into public.dossier_etapes_historique
  (dossier_id, statut_avant, statut_apres, changed_at, source, avant_inconnu)
select d.id,
       null,
       d.statut,
       case when d.statut_changed_at > d.created_at + interval '1 minute'
            then d.statut_changed_at else d.created_at end,
       'backfill',
       d.created_at < timestamptz '2026-08-22 00:00:00+02'
         or d.statut_changed_at > d.created_at + interval '1 minute'
from public.dossiers d
where not exists (select 1 from public.dossier_etapes_historique h where h.dossier_id = d.id);

-- Déclencheur : une ligne à la création, une ligne à chaque changement réel de
-- statut (jamais si le statut est identique : WHEN sur le déclencheur d'UPDATE).
-- L'écriture de l'historique ne doit jamais faire échouer l'écriture du dossier
-- (ni le rejeu de la file hors-ligne) : une erreur est signalée en avertissement.
create or replace function public.journaliser_etape_dossier()
returns trigger
language plpgsql
as $function$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.dossier_etapes_historique (dossier_id, statut_avant, statut_apres, changed_at, source)
      values (new.id, null, new.statut, coalesce(new.created_at, now()), 'trigger');
    else
      insert into public.dossier_etapes_historique (dossier_id, statut_avant, statut_apres, changed_at, source)
      values (new.id, old.statut, new.statut, now(), 'trigger');
    end if;
  exception when others then
    raise warning 'historique des étapes non écrit pour le dossier % : %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists dossiers_historique_creation on public.dossiers;
create trigger dossiers_historique_creation
  after insert on public.dossiers
  for each row execute function public.journaliser_etape_dossier();

drop trigger if exists dossiers_historique_changement on public.dossiers;
create trigger dossiers_historique_changement
  after update of statut on public.dossiers
  for each row
  when (old.statut is distinct from new.statut)
  execute function public.journaliser_etape_dossier();
