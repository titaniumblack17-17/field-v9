-- Retour à l'état d'avant 20261009_montant_a_chiffrer.sql : définitions
-- d'origine relevées en production le 2026-10-09 avant modification.

create or replace function public.recalculer_montant_dossier(p_dossier uuid)
returns void
language plpgsql
as $function$
declare
  base numeric;
  complements numeric;
begin
  if p_dossier is null then return; end if;

  -- Le devis principal est le plus récent de ceux qui remplacent. Une révision
  -- chasse la précédente : on ne cumule jamais deux versions d'un même chiffrage.
  select f.montant_ttc into base
  from public.fichiers f
  where f.dossier_id = p_dossier
    and f.cumule = false
    and f.montant_ttc is not null
  order by coalesce(f.date_devis, f.created_at::date) desc, f.created_at desc
  limit 1;

  -- Les devis marqués complémentaires s'ajoutent, tous.
  select coalesce(sum(f.montant_ttc), 0) into complements
  from public.fichiers f
  where f.dossier_id = p_dossier
    and f.cumule = true
    and f.montant_ttc is not null;

  if base is null and complements = 0 then
    return; -- aucun devis chiffré : on laisse la saisie manuelle intacte
  end if;

  update public.dossiers
  set montant_estime = coalesce(base, 0) + complements
  where id = p_dossier;
end;
$function$;

create or replace function public.sur_changement_devis()
returns trigger
language plpgsql
as $function$
begin
  perform public.recalculer_montant_dossier(coalesce(new.dossier_id, old.dossier_id));
  return null;
end;
$function$;
