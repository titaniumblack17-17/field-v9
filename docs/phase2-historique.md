# Phase 2 — historique des étapes

## État des lieux (avant la phase)

| Source | Ce qu'elle dit | Fiabilité |
|---|---|---|
| `dossiers.created_at` | 72 dossiers créés les 20-21/08/2026 par l'**import en masse** : c'est la date d'import, pas la création réelle. 39 créés ensuite : dates réelles. | fiable seulement après le 22/08 |
| `dossiers.statut_changed_at` | Date du **dernier** changement de statut (trigger `maj_statut_changed_at`, posé à chaque changement réel). Pas l'étape précédente. 70 dossiers ont bougé depuis leur création, 41 jamais. | fiable pour le dernier mouvement ; rien avant |
| `dossiers.closed_at` | Date de passage en finition ou perdu (trigger `horodater_cloture`). | fiable, un seul jalon |
| `fichiers.date_devis` | Date inscrite sur le devis (34 devis sur 35). | ce n'est pas la date d'envoi |
| `dossier_notes` | 33 notes contiennent un mot d'étape ; 2 seulement annoncent un envoi (« Devis envoyé le 26/08/26 »), en texte libre. | non exploitable sans interprétation : **non utilisé** |

Conclusion : le passé n'est **pas** reconstructible au-delà d'un point par dossier (son arrivée dans l'étape actuelle).

## Définition de « signé » (reprise de l'Objectif 2026, `BriefSoir.jsx`)
Dossier de type `projet`, statut ≠ `perdu`, dans l'une des étapes `commande`, `reunion_chantier`, `installation`, `finition`, `financement`, `termine`. Le montant compté est `montant_estime`. L'exercice d'un dossier en `finition` ou `termine` est l'année de `closed_at` (à défaut `date_installation`) ; tout autre dossier appartient à l'exercice en cours. Aucune autre définition n'est introduite.

## Ce qui a été posé
- `dossier_etapes_historique(dossier_id → dossiers ON DELETE CASCADE, statut_avant, statut_apres, changed_at, source 'trigger'|'backfill', avant_inconnu)`. `avant_inconnu` est ajouté aux colonnes demandées : il distingue une création réelle (`statut_avant` NULL, `avant_inconnu` faux) d'une ligne de rétro-remplissage dont le passé est inconnu.
- Déclencheurs : une ligne à l'INSERT, une ligne à chaque UPDATE où le statut change réellement (clause `WHEN old IS DISTINCT FROM new`). L'écriture de l'historique est enveloppée : une erreur donne un avertissement, jamais un échec de l'écriture du dossier.
- Rétro-remplissage (111 dossiers, une ligne chacun, `source='backfill'`) :
  - 8 créations réelles, jamais déplacées ;
  - 33 dossiers importés, jamais déplacés : « présent dans ce statut depuis l'import », `avant_inconnu` ;
  - 70 dossiers déplacés : « arrivé dans le statut actuel à `statut_changed_at` », étape précédente **inconnue**.
- `pipeline_snapshots(jour, type, statut, nb_dossiers, montant_estime_total, nb_sans_montant)` — `type` ajouté à la clé car « en_cours » existe pour les plans et les SAV. Alimentée par `prendre_instantane_pipeline()` ; premier instantané pris à l'application ; job `pg_cron` `pipeline-snapshot-quotidien` à 21 h 30 UTC. Agrégats seulement.

## Délai devis → signature
Devis envoyé = première entrée dans `devis_envoye` ; signé = première entrée dans une étape « signée » ci-dessus. Requête de contrôle :

```sql
with premier as (
  select h.dossier_id,
         min(h.changed_at) filter (where h.statut_apres = 'devis_envoye') as devis_envoye,
         min(h.changed_at) filter (where h.statut_apres in
           ('commande','reunion_chantier','installation','finition','financement','termine')) as signe
  from dossier_etapes_historique h
  join dossiers d on d.id = h.dossier_id and d.type = 'projet' and d.statut <> 'perdu'
  group by h.dossier_id)
select count(*) filter (where signe is not null)                          as dossiers_signes,
       count(*) filter (where devis_envoye is not null)                   as avec_entree_devis_envoye,
       count(*) filter (where devis_envoye is not null and signe >= devis_envoye) as delais_mesurables,
       round(percentile_cont(0.5) within group
         (order by extract(epoch from signe - devis_envoye)/86400)::numeric, 1) as mediane_jours
from premier;
```
Résultat le 10/10/2026 : 29 dossiers signés, 9 avec une entrée `devis_envoye` (ceux qui y sont encore), **0 délai mesurable**. La mesure ne deviendra possible que sur les dossiers qui franchissent les deux étapes à partir de maintenant.

Cas limite : « financement » précède « commande » dans le pipeline et fait partie des étapes signées (définition de l'Objectif) ; un dossier qui passe par le financement avant la commande est donc daté à l'entrée en financement.

## Retour arrière
`supabase/rollback/20261010_historique_etapes_rollback.sql` et `…_pipeline_snapshots_rollback.sql` (suppriment tables, fonctions, déclencheurs et job ; les dossiers ne sont pas touchés).
