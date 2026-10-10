-- Décision par devis : retenu / alternative / remplace / mis_de_cote / a_trancher
-- (défaut). Par offre d'un devis à plusieurs offres : variantes_retenues (déjà là).
-- Migration additive : colonnes nouvelles, remplissage des seules colonnes
-- nouvelles à partir de l'existant (aucun montant n'est modifié), fonctions
-- remplacées par CREATE OR REPLACE (jamais de DROP).
-- Retour arrière : supabase/rollback/20261012_decisions_devis_rollback.sql

alter table public.fichiers
  add column if not exists decision text not null default 'a_trancher',
  add column if not exists remplace_par uuid references public.fichiers(id) on delete set null,
  add column if not exists mis_de_cote_le timestamptz,
  add column if not exists date_reprise date,
  add column if not exists decision_le timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fichiers_decision_valide') then
    alter table public.fichiers
      add constraint fichiers_decision_valide
      check (decision in ('a_trancher', 'retenu', 'alternative', 'remplace', 'mis_de_cote'));
  end if;
end $$;

-- Remplissage : les choix déjà faits deviennent « retenu » (ce que l'ancienne règle
-- comptait aujourd'hui : le devis chiffré non cumulé le plus récent de chaque
-- dossier, et tous les devis cumulés) ; les autres devis chiffrés, que l'ancienne
-- règle ignorait, deviennent « remplace » par ce devis. Un devis sans montant
-- reste « a_trancher ».
update public.fichiers
set decision = 'retenu', decision_le = now()
where type_doc = 'devis' and montant_ttc is not null and cumule and decision = 'a_trancher';

with base as (
  select distinct on (dossier_id) dossier_id, id
  from public.fichiers
  where type_doc = 'devis' and montant_ttc is not null and not cumule and dossier_id is not null
  order by dossier_id, coalesce(date_devis, created_at::date) desc, created_at desc
)
update public.fichiers f
set decision = case when b.id = f.id then 'retenu' else 'remplace' end,
    remplace_par = case when b.id = f.id then null else b.id end,
    decision_le = now()
from base b
where f.dossier_id = b.dossier_id and f.type_doc = 'devis' and f.montant_ttc is not null
  and not f.cumule and f.decision = 'a_trancher';

-- Les offres choisies sur un devis retenu sont déjà dans variantes_retenues
-- (migration 20261010) : rien à recopier.

-- Nouveau calcul : montant du dossier = somme des devis « retenu » (le montant
-- d'un devis à plusieurs offres est déjà la somme des offres retenues).
--  • remplacé, mis de côté, alternative et à trancher n'entrent pas ;
--  • des devis existent mais aucun n'est retenu : montant NULL (« à chiffrer ») ;
--  • aucun devis du tout : la saisie manuelle reste intacte, sauf retrait d'un
--    devis chiffré (règle de 20261009_montant_a_chiffrer.sql, inchangée).
create or replace function public.recalculer_montant_dossier(p_dossier uuid)
returns void
language plpgsql
as $function$
declare
  nb_devis integer;
  nb_retenus integer;
  somme numeric;
  vider_si_vide boolean := coalesce(current_setting('field.vider_si_vide', true), '') = '1';
begin
  if p_dossier is null then return; end if;

  select count(*),
         count(*) filter (where decision = 'retenu' and montant_ttc is not null),
         coalesce(sum(montant_ttc) filter (where decision = 'retenu'), 0)
    into nb_devis, nb_retenus, somme
  from public.fichiers
  where dossier_id = p_dossier and type_doc = 'devis';

  if nb_devis = 0 then
    if vider_si_vide then
      update public.dossiers set montant_estime = null where id = p_dossier;
    end if;
    return;
  end if;

  update public.dossiers
  set montant_estime = case when nb_retenus > 0 then somme else null end
  where id = p_dossier;
end;
$function$;

-- Le déclencheur écoute aussi la décision.
create or replace trigger fichiers_recalcul_montant
  after insert or delete or update of montant_ttc, cumule, date_devis, decision, type_doc
  on public.fichiers
  for each row execute function public.sur_changement_devis();
