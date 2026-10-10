-- Règle du montant : quand il ne reste plus aucun devis chiffré sur un dossier
-- parce qu'on vient d'en retirer un (retenue annulée, changement de type,
-- suppression), montant_estime passe à NULL — « à chiffrer » — au lieu de garder
-- un chiffre qui ne vient plus d'aucun fichier.
--
-- Garde-fou : seul le retrait d'un devis chiffré déclenche cette remise à vide.
-- Déposer une photo ou un PDF non chiffré, ou passer un fichier non chiffré en
-- non chiffré, laisse la saisie manuelle intacte comme avant.
--
-- Les deux fonctions gardent leur signature (CREATE OR REPLACE, aucun DROP).
-- Ancienne définition : supabase/rollback/20261009_montant_a_chiffrer_rollback.sql

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
    -- Plus aucun devis chiffré. Si l'on vient d'en retirer un : « à chiffrer ».
    -- Sinon : on laisse la saisie manuelle intacte.
    if vider_si_vide then
      update public.dossiers set montant_estime = null where id = p_dossier;
    end if;
    return;
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
declare
  devis_retire boolean := false;
begin
  if tg_op = 'DELETE' then
    devis_retire := old.montant_ttc is not null;
  elsif tg_op = 'UPDATE' then
    -- Un devis chiffré qui cesse de l'être (retenue annulée, changement de type).
    devis_retire := old.montant_ttc is not null and new.montant_ttc is null;
  end if;

  if devis_retire then
    perform set_config('field.vider_si_vide', '1', true);
  end if;
  perform public.recalculer_montant_dossier(coalesce(new.dossier_id, old.dossier_id));
  if devis_retire then
    perform set_config('field.vider_si_vide', '', true);
  end if;
  return null;
end;
$function$;
