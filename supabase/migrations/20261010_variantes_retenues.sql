-- Cumul de plusieurs offres d'un même devis : indices (base 0, dans `variantes`)
-- des offres retenues ensemble. `variante_retenue` reste renseigné (première
-- offre retenue) pour la compatibilité ; montant_ttc porte la somme.
-- Retour arrière : supabase/rollback/20261010_variantes_retenues_rollback.sql
alter table public.fichiers add column if not exists variantes_retenues integer[];

-- Les choix déjà faits (une seule offre) sont recopiés dans la nouvelle colonne :
-- seule la colonne ajoutée est remplie, rien d'existant n'est modifié.
update public.fichiers
set variantes_retenues = array[variante_retenue]
where variante_retenue is not null and variantes_retenues is null;
