-- PLAN TEMPS B — NE PAS EXÉCUTER EN BLOC. Une section par table, dans cet ordre, avec la vérification de PLAN.md entre deux.
-- Rien de ce fichier n'a été appliqué à la base. Retour arrière : docs/securite-temps-b/retour_arriere.sql

-- Fonction commune : l'utilisateur authentifié est Bruce (une seule adresse). Même avec les inscriptions publiques
-- désactivées, ce second verrou garantit qu'aucun autre compte Supabase ne lirait la base.
create or replace function public.est_bruce() returns boolean
language sql stable security invoker as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'titaniumblack17@gmail.com'
$$;

-- ── 01. produits — catalogue (8 009 lignes), lecture seule côté app
alter table public.produits enable row level security;
drop policy if exists "produits_bruce" on public.produits;
create policy "produits_bruce" on public.produits for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 02. carnet_contacts — carnet d'adresses importé (7 556 lignes)
alter table public.carnet_contacts enable row level security;
drop policy if exists "carnet_contacts_bruce" on public.carnet_contacts;
create policy "carnet_contacts_bruce" on public.carnet_contacts for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 03. rapport_hebdo — rapports générés
alter table public.rapport_hebdo enable row level security;
drop policy if exists "rapport_hebdo_bruce" on public.rapport_hebdo;
create policy "rapport_hebdo_bruce" on public.rapport_hebdo for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 04. pipeline_snapshots — instantané quotidien du pipeline (écrit par un déclencheur / tâche planifiée)
alter table public.pipeline_snapshots enable row level security;
drop policy if exists "pipeline_snapshots_bruce" on public.pipeline_snapshots;
create policy "pipeline_snapshots_bruce" on public.pipeline_snapshots for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 05. dossier_etapes_historique — journal des étapes, écrit par déclencheur
alter table public.dossier_etapes_historique enable row level security;
drop policy if exists "dossier_etapes_historique_bruce" on public.dossier_etapes_historique;
create policy "dossier_etapes_historique_bruce" on public.dossier_etapes_historique for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 06. dossier_financement_historique — journal du financement, écrit par déclencheur
alter table public.dossier_financement_historique enable row level security;
drop policy if exists "dossier_financement_historique_bruce" on public.dossier_financement_historique;
create policy "dossier_financement_historique_bruce" on public.dossier_financement_historique for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 07. materiel — matériel installé par cabinet
alter table public.materiel enable row level security;
drop policy if exists "materiel_bruce" on public.materiel;
create policy "materiel_bruce" on public.materiel for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 08. captures — dictées / captures
alter table public.captures enable row level security;
drop policy if exists "captures_bruce" on public.captures;
create policy "captures_bruce" on public.captures for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 09. client_notes — notes de fiche client
alter table public.client_notes enable row level security;
drop policy if exists "client_notes_bruce" on public.client_notes;
create policy "client_notes_bruce" on public.client_notes for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 10. dossier_note_taches — tâches des notes
alter table public.dossier_note_taches enable row level security;
drop policy if exists "dossier_note_taches_bruce" on public.dossier_note_taches;
create policy "dossier_note_taches_bruce" on public.dossier_note_taches for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 11. rappels — rappels (liés à Todoist)
alter table public.rappels enable row level security;
drop policy if exists "rappels_bruce" on public.rappels;
create policy "rappels_bruce" on public.rappels for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 12. dossier_notes — notes de dossier
alter table public.dossier_notes enable row level security;
drop policy if exists "dossier_notes_bruce" on public.dossier_notes;
create policy "dossier_notes_bruce" on public.dossier_notes for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 13. dossier_financement — financements (temps réel)
alter table public.dossier_financement enable row level security;
drop policy if exists "dossier_financement_bruce" on public.dossier_financement;
create policy "dossier_financement_bruce" on public.dossier_financement for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 14. fichiers — documents (+ bucket de stockage « documents »)
alter table public.fichiers enable row level security;
drop policy if exists "fichiers_bruce" on public.fichiers;
create policy "fichiers_bruce" on public.fichiers for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 15. clients — fiches clients
alter table public.clients enable row level security;
drop policy if exists "clients_bruce" on public.clients;
create policy "clients_bruce" on public.clients for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── 16. dossiers — dossiers (cœur : à basculer en dernier)
alter table public.dossiers enable row level security;
drop policy if exists "dossiers_bruce" on public.dossiers;
create policy "dossiers_bruce" on public.dossiers for all to authenticated using (public.est_bruce()) with check (public.est_bruce());

-- ── Stockage : bucket privé « documents » (remplace les 3 politiques ouvertes à anon)
drop policy if exists "documents envoi" on storage.objects;
drop policy if exists "documents lecture" on storage.objects;
drop policy if exists "documents suppression" on storage.objects;
create policy "documents_bruce_lecture" on storage.objects for select to authenticated using (bucket_id = 'documents' and public.est_bruce());
create policy "documents_bruce_envoi" on storage.objects for insert to authenticated with check (bucket_id = 'documents' and public.est_bruce());
create policy "documents_bruce_suppression" on storage.objects for delete to authenticated using (bucket_id = 'documents' and public.est_bruce());
-- (mise à jour de fichier existant : ajouter une politique update identique si l'app en a besoin ; l'app envoie, lit et supprime.)

-- ── Widget iPhone : widget_chiffres_board() est security definer, il continue de répondre à anon (aucun changement requis).
-- Vérifier seulement : grant execute on function public.widget_chiffres_board() to anon;  (déjà le cas)
