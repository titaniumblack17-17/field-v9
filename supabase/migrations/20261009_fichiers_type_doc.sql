-- Typage des documents déposés (phase 1). Migration additive : colonnes
-- nouvelles uniquement, aucune donnée existante réécrite (montants, erreurs
-- d'analyse, rattachements restent tels quels).
--
-- type_doc        devis | cdc | plan | autre. Seul « devis » est analysé et chiffré.
-- version_doc     version d'un cahier des charges (V1, V2…) ; la plus haute fait foi.
-- variantes       offres exclusives d'un même devis [{libelle, montant_ttc}], jamais additionnées.
-- variante_retenue index (base 0) dans `variantes` de l'offre choisie par Bruce.
-- a_trancher_raison motif quand le montant reste à décider (HT/TTC douteux…).

alter table public.fichiers
  add column if not exists type_doc text not null default 'autre',
  add column if not exists version_doc integer,
  add column if not exists variantes jsonb,
  add column if not exists variante_retenue integer,
  add column if not exists a_trancher_raison text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fichiers_type_doc_valide') then
    alter table public.fichiers
      add constraint fichiers_type_doc_valide check (type_doc in ('devis','cdc','plan','autre'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fichiers_variantes_tableau') then
    alter table public.fichiers
      add constraint fichiers_variantes_tableau check (variantes is null or jsonb_typeof(variantes) = 'array');
  end if;
end $$;

-- Remplissage des seules colonnes nouvelles, d'après le nom du fichier
-- (nomenclature de Bruce : NOM_PRODUIT_RÉFÉRENCE à 9 chiffres = devis).
-- Le trigger de recalcul ne porte que sur montant_ttc / cumule / date_devis :
-- aucun montant de dossier ne bouge.
update public.fichiers set
  type_doc = case
    when nom ~* '(^|[^a-z])cdc([^a-z]|$)' or nom ~* 'cabinet general' then 'cdc'
    when nom ~* '_[0-9]{9}[a-z]?\.pdf$' then 'devis'
    when nom ~* '(^|[^a-z])plan([^a-z]|$)' then 'plan'
    else 'autre'
  end,
  version_doc = case
    when nom ~* '(^|[^a-z])cdc([^a-z]|$)' or nom ~* 'cabinet general'
      then nullif(substring(nom from '(?i)_V([0-9]+)\.[a-z0-9]+$'), '')::int
    else null
  end
where type_doc = 'autre';
