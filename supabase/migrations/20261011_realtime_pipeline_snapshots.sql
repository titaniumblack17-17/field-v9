-- Le Dashboard s'abonne à pipeline_snapshots : une table nouvelle n'entre pas
-- d'elle-même dans la publication supabase_realtime (sans cela, l'abonnement
-- entier échoue : « Unable to subscribe to changes »).
alter publication supabase_realtime add table public.pipeline_snapshots;
