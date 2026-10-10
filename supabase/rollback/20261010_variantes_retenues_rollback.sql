-- Retour à l'état d'avant 20261010_variantes_retenues.sql. Les cumuls retenus
-- perdent leur détail (montant_ttc, lui, reste tel quel).
alter table public.fichiers drop column if exists variantes_retenues;
