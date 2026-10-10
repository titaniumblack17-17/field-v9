-- Retour à la version de dashboard_chiffres() d'avant 20261013_dashboard_offres.sql.
create or replace function public.dashboard_chiffres()
returns jsonb
language sql
stable
security invoker
as $function$
with
  p as (select (now() at time zone 'Europe/Paris')::date as jour,
               extract(year from (now() at time zone 'Europe/Paris'))::int as annee),
  projets as (
    select d.*,
      case
        when d.statut in ('a_classer','prospect','prise_contact') then 'qualification'
        when d.statut in ('devis_a_faire','devis_envoye','relance') then 'devis'
        when d.statut in ('visite_local','negociation','confirmation') then 'negociation'
        when d.statut in ('financement','commande') then 'commande'
        when d.statut in ('reunion_chantier','installation') then 'chantier'
        when d.statut in ('finition','sav') then 'finition'
      end as famille
    from public.dossiers d where d.type = 'projet'
  ),
  -- Dossiers « reportés » : au moins un devis mis de côté et aucun devis retenu.
  -- Ils ne comptent ni en signé ni en à trancher ; exposés à part (« reportes »).
  reportes_ids as (
    select dossier_id from public.fichiers
    where type_doc = 'devis' and dossier_id is not null
    group by dossier_id
    having count(*) filter (where decision = 'mis_de_cote') > 0
       and count(*) filter (where decision = 'retenu') = 0
  ),
  actifs as (select * from projets where statut not in ('perdu','termine') and famille is not null),
  signes as (
    select pr.* from projets pr, p
    where pr.id not in (select dossier_id from reportes_ids)
      and pr.statut in ('commande','reunion_chantier','installation','finition','financement','termine')
      and (
        pr.statut not in ('finition','termine')
        or coalesce(
             substring(coalesce((pr.closed_at at time zone 'UTC')::date::text, pr.date_installation::text) from 1 for 4)::int,
             (select annee from p)
           ) = (select annee from p)
      )
  ),
  devis_a_trancher as (
    select f.id, f.dossier_id,
           coalesce((select min((v->>'montant_ttc')::numeric) from jsonb_array_elements(coalesce(f.variantes, '[]'::jsonb)) v), f.montant_ttc) as montant_min
    from public.fichiers f
    where f.type_doc = 'devis' and f.decision = 'a_trancher' and f.dossier_id is not null
      and f.dossier_id not in (select dossier_id from reportes_ids)
      and (f.montant_ttc is not null or jsonb_array_length(coalesce(f.variantes, '[]'::jsonb)) >= 2 or nullif(f.a_trancher_raison, '') is not null)
  ),
  rappels_dus as (select id from public.dossiers where rappel_date is not null and rappel_date <= (select jour from p)),
  incomplets as (
    select a.id,
           (a.statut in ('devis_envoye','relance','visite_local','negociation','confirmation','financement','commande','reunion_chantier','installation','finition')
            and not exists (select 1 from public.fichiers f where f.dossier_id = a.id and f.type_doc = 'devis')) as sans_devis,
           (a.plan_statut is not null
            and not exists (select 1 from public.fichiers f where f.dossier_id = a.id and f.type_doc = 'cdc')) as sans_cdc
    from actifs a
  ),
  retard_taches as (
    select t.id from public.dossier_note_taches t
    join public.dossiers d on d.id = t.dossier_id
    where t.fait = false and t.echeance is not null and t.echeance <= (select jour from p)
  ),
  retard_sav as (select id from public.dossiers where type = 'sav' and statut not in ('clos','en_attente')),
  retard_devis as (
    select id from public.dossiers
    where type = 'projet' and statut in ('devis_envoye','relance')
      and statut_changed_at <= now() - interval '30 days'
      and id not in (select id from rappels_dus)
  ),
  serie as (
    select s.jour,
      coalesce(sum(s.montant_estime_total) filter (where s.type = 'projet'
        and s.statut not in ('perdu','termine','commande','reunion_chantier','installation','finition','financement')), 0) as pipeline,
      coalesce(sum(s.montant_estime_total) filter (where s.type = 'projet'
        and s.statut in ('commande','reunion_chantier','installation','finition','financement','termine')), 0) as signe
    from public.pipeline_snapshots s group by s.jour
  )
select jsonb_build_object(
  'annee', (select annee from p),
  'objectif', 5000000,
  'projets_actifs', (select count(*) from actifs),
  'familles', coalesce((
    select jsonb_agg(jsonb_build_object('cle', f.cle, 'nb', coalesce(x.nb, 0), 'montant', coalesce(x.montant, 0), 'sans_montant', coalesce(x.sans, 0), 'a_chiffrer', coalesce(x.a_chiffrer, 0)) order by f.ordre)
    from (values (1,'qualification'),(2,'devis'),(3,'negociation'),(4,'commande'),(5,'chantier'),(6,'finition')) f(ordre, cle)
    left join (select famille, count(*) nb, coalesce(sum(montant_estime), 0) montant, count(*) filter (where montant_estime is null) sans,
      count(*) filter (where montant_estime is null and statut in ('devis_envoye','relance','visite_local','negociation','confirmation','financement','commande','reunion_chantier','installation','finition')) a_chiffrer
      from actifs group by famille) x
      on x.famille = f.cle
  ), '[]'::jsonb),
  'signe', jsonb_build_object(
    'nb', (select count(*) from signes),
    'montant', (select coalesce(sum(montant_estime), 0) from signes),
    'sans_montant', (select count(*) from signes where montant_estime is null)),
  'a_trancher', jsonb_build_object(
    'devis', (select count(*) from devis_a_trancher),
    'dossiers', (select count(distinct dossier_id) from devis_a_trancher),
    'montant_min_hors_signes', (select coalesce(sum(montant_min), 0) from devis_a_trancher
       where dossier_id not in (select id from signes))),
  'reportes', jsonb_build_object(
    'dossiers', (select count(*) from reportes_ids),
    'devis', (select count(*) from public.fichiers where type_doc = 'devis' and decision = 'mis_de_cote'
       and dossier_id in (select dossier_id from reportes_ids)),
    'montant', (select coalesce(sum(montant_ttc), 0) from public.fichiers where type_doc = 'devis' and decision = 'mis_de_cote'
       and dossier_id in (select dossier_id from reportes_ids))),
  'incomplets', jsonb_build_object(
    'dossiers', (select count(*) from incomplets where sans_devis or sans_cdc),
    'sans_devis', (select count(*) from incomplets where sans_devis),
    'sans_cdc', (select count(*) from incomplets where sans_cdc)),
  'en_attente', jsonb_build_object(
    'dossiers', (select count(*) from public.dossiers
       where nullif(trim(bloque_par), '') is not null and statut not in ('termine','clos','solde','perdu'))),
  'en_retard', jsonb_build_object(
    'total', (select count(*) from rappels_dus) + (select count(*) from retard_sav) + (select count(*) from retard_taches) + (select count(*) from retard_devis),
    'rappels', (select count(*) from rappels_dus),
    'sav', (select count(*) from retard_sav),
    'taches', (select count(*) from retard_taches),
    'devis', (select count(*) from retard_devis)),
  'serie', coalesce((select jsonb_agg(jsonb_build_object('jour', jour, 'pipeline', pipeline, 'signe', signe) order by jour) from serie), '[]'::jsonb)
);
$function$;
