-- Retour à l'état d'avant 20261010_historique_etapes.sql. Supprime l'historique
-- recueilli depuis (c'est le seul effet de bord) ; les dossiers ne sont pas touchés.
drop trigger if exists dossiers_historique_changement on public.dossiers;
drop trigger if exists dossiers_historique_creation on public.dossiers;
drop function if exists public.journaliser_etape_dossier();
drop table if exists public.dossier_etapes_historique;
