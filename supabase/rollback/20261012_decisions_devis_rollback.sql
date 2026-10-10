-- Retour à l'état d'avant 20261012_decisions_devis.sql : ancienne règle de calcul
-- (le devis chiffré non cumulé le plus récent remplace les autres, les devis
-- cumulés s'ajoutent), ancien déclencheur, colonnes supprimées.
create or replace function public.recalculer_montant_dossier(p_dossier uuid)
returns void
language plpgsql
as $function$
declare
  base numeric;
  complements numeric;
  vider_si_vide boolean := coalesce(current_setting('field.vider_si_vide', true), '') = '1';
begin
  if p_dossier is null then return; end if;

  select f.montant_ttc into base
  from public.fichiers f
  where f.dossier_id = p_dossier and f.cumule = false and f.montant_ttc is not null
  order by coalesce(f.date_devis, f.created_at::date) desc, f.created_at desc
  limit 1;

  select coalesce(sum(f.montant_ttc), 0) into complements
  from public.fichiers f
  where f.dossier_id = p_dossier and f.cumule = true and f.montant_ttc is not null;

  if base is null and complements = 0 then
    if vider_si_vide then
      update public.dossiers set montant_estime = null where id = p_dossier;
    end if;
    return;
  end if;

  update public.dossiers set montant_estime = coalesce(base, 0) + complements where id = p_dossier;
end;
$function$;

create or replace trigger fichiers_recalcul_montant
  after insert or delete or update of montant_ttc, cumule, date_devis
  on public.fichiers
  for each row execute function public.sur_changement_devis();

alter table public.fichiers
  drop column if exists decision_le,
  drop column if exists date_reprise,
  drop column if exists mis_de_cote_le,
  drop column if exists remplace_par,
  drop column if exists decision;
