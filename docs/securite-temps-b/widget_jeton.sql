-- Widget Board : jeton dédié à la place de la clé publique — PROPOSITION, NON APPLIQUÉE.
-- Objectif : pouvoir retirer le droit d'exécution de widget_chiffres_board() à « anon » (toute personne munie de la clé publique
-- visible dans l'app peut aujourd'hui l'appeler), sans casser le widget actuel tant que le nouveau n'est pas validé.
--
-- Principe : une NOUVELLE fonction widget_chiffres_board_jeton(p_jeton text) vérifie un jeton aléatoire (seule son empreinte
-- sha-256 est stockée) puis renvoie le même résultat. L'ancienne fonction reste intacte et ouverte jusqu'à l'étape 4.
-- Le jeton n'ouvre QUE ces 4 chiffres (aucune donnée nominative) ; il se révoque en supprimant sa ligne.

-- ── Étape 1 (additive) : table des jetons — fermée à tous (RLS active, aucune politique : seuls postgres / service_role y accèdent)
create table if not exists public.widget_jetons (
  empreinte text primary key,            -- sha-256 hexadécimal du jeton
  libelle   text not null,               -- ex. 'iPhone Scriptable', 'Raccourci Mac'
  cree_le   timestamptz not null default now()
);
alter table public.widget_jetons enable row level security;
revoke all on public.widget_jetons from anon, authenticated;

-- ── Étape 2 (additive) : fonction à jeton (security definer, chemin de recherche figé)
create or replace function public.widget_chiffres_board_jeton(p_jeton text)
returns setof record
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_jeton is null or not exists (
    select 1 from public.widget_jetons where empreinte = encode(extensions.digest(p_jeton, 'sha256'), 'hex')
  ) then
    raise exception 'jeton invalide' using errcode = '28000';
  end if;
  return query select * from public.widget_chiffres_board();
end;
$$;
-- ⚠ À ADAPTER avant exécution : « returns setof record » exige une liste de colonnes à l'appel. Au moment d'appliquer, remplacer par
-- le type de retour réel de widget_chiffres_board() (voir son \df+ : dossiers_actifs, objectif_pourcent, …) en copiant sa signature.
revoke all on function public.widget_chiffres_board_jeton(text) from public;
grant execute on function public.widget_chiffres_board_jeton(text) to anon;  -- anon appelle, mais ne passe que si le jeton est bon

-- ── Étape 3 (à la main) : créer un jeton, le noter, ne stocker que son empreinte
--   openssl rand -hex 32            → le jeton (à coller dans Scriptable / le Raccourci Mac, nulle part ailleurs)
--   insert into public.widget_jetons (empreinte, libelle)
--   values (encode(extensions.digest('<JETON>', 'sha256'), 'hex'), 'iPhone Scriptable');
-- Puis : changer le script Scriptable pour appeler /rest/v1/rpc/widget_chiffres_board_jeton avec {"p_jeton": "<JETON>"} (la clé publique
-- reste nécessaire comme en-tête apikey : elle ne donne plus rien d'autre). Valider le widget iPhone ET le Raccourci Mac pendant quelques jours.

-- ── Étape 4 (SEULEMENT après validation) : fermer l'ancienne porte
--   revoke execute on function public.widget_chiffres_board() from anon, public;
-- Retour arrière immédiat : grant execute on function public.widget_chiffres_board() to anon;
-- Retour arrière complet : drop function public.widget_chiffres_board_jeton(text); drop table public.widget_jetons;
