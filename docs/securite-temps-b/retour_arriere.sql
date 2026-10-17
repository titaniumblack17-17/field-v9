-- RETOUR ARRIÈRE du temps B : rend chaque table à l'état d'avant (RLS désactivée, aucune politique). Sûr à rejouer.
-- Toute table peut être rendue individuellement : copier sa section.

drop policy if exists "produits_bruce" on public.produits;
alter table public.produits disable row level security;

drop policy if exists "carnet_contacts_bruce" on public.carnet_contacts;
alter table public.carnet_contacts disable row level security;

drop policy if exists "rapport_hebdo_bruce" on public.rapport_hebdo;
alter table public.rapport_hebdo disable row level security;

drop policy if exists "pipeline_snapshots_bruce" on public.pipeline_snapshots;
alter table public.pipeline_snapshots disable row level security;

drop policy if exists "dossier_etapes_historique_bruce" on public.dossier_etapes_historique;
alter table public.dossier_etapes_historique disable row level security;

drop policy if exists "dossier_financement_historique_bruce" on public.dossier_financement_historique;
alter table public.dossier_financement_historique disable row level security;

drop policy if exists "materiel_bruce" on public.materiel;
alter table public.materiel disable row level security;

drop policy if exists "captures_bruce" on public.captures;
alter table public.captures disable row level security;

drop policy if exists "client_notes_bruce" on public.client_notes;
alter table public.client_notes disable row level security;

drop policy if exists "dossier_note_taches_bruce" on public.dossier_note_taches;
alter table public.dossier_note_taches disable row level security;

drop policy if exists "rappels_bruce" on public.rappels;
alter table public.rappels disable row level security;

drop policy if exists "dossier_notes_bruce" on public.dossier_notes;
alter table public.dossier_notes disable row level security;

drop policy if exists "dossier_financement_bruce" on public.dossier_financement;
alter table public.dossier_financement disable row level security;

drop policy if exists "fichiers_bruce" on public.fichiers;
alter table public.fichiers disable row level security;

drop policy if exists "clients_bruce" on public.clients;
alter table public.clients disable row level security;

drop policy if exists "dossiers_bruce" on public.dossiers;
alter table public.dossiers disable row level security;

-- Stockage : retour aux trois politiques d'origine (ouvertes à anon et authenticated)
drop policy if exists "documents_bruce_lecture" on storage.objects;
drop policy if exists "documents_bruce_envoi" on storage.objects;
drop policy if exists "documents_bruce_suppression" on storage.objects;
create policy "documents envoi" on storage.objects for insert to anon, authenticated with check (bucket_id = 'documents');
create policy "documents lecture" on storage.objects for select to anon, authenticated using (bucket_id = 'documents');
create policy "documents suppression" on storage.objects for delete to anon, authenticated using (bucket_id = 'documents');
-- Fonction commune (facultatif : sans effet une fois les politiques retirées)
drop function if exists public.est_bruce();
