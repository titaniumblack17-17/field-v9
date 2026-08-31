import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Préremplit adresse/code postal/ville à partir de l'API publique Recherche
// d'Entreprises (recherche-entreprises.api.gouv.fr — INSEE/SIRENE, gratuite,
// sans clé, CORS ouvert). Deux usages :
//   - sans client_id : lecture pure, renvoie une liste de candidats pour un
//     choix humain (ClientForm.jsx, en cours de saisie).
//   - avec client_id : écrit directement les champs encore vides de la fiche,
//     mais seulement s'il existe un candidat sans ambiguïté (voir `scorer`)
//     — personne n'est là pour trancher pendant une dictée en plein appel.
//
// Cette API ne renvoie JAMAIS de téléphone (uniquement des données
// administratives : adresse, SIRET, forme juridique) — le champ téléphone
// des fiches n'est donc jamais concerné par cette fonction, à aucun endroit
// du code ci-dessous.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  })

const normaliser = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()

// La rue seule (sans CP/ville, colonnes séparées côté clients) reconstruite
// à partir des champs discrets de l'API — plus fiable qu'un découpage par
// regex de la chaîne "adresse" concaténée que l'API renvoie aussi.
const adresseDepuisSiege = (siege: any): string | null => {
  const parties = [siege?.numero_voie, siege?.indice_repetition, siege?.type_voie, siege?.libelle_voie]
    .filter(Boolean)
  const rue = parties.join(" ").trim()
  return rue || null
}

// +10 si la commune du résultat correspond EXACTEMENT à celle saisie par
// Bruce — seul signal assez fort pour une écriture automatique sans
// relecture humaine (voir plus bas). +4 en cas de correspondance partielle
// (ex. arrondissement, orthographe légèrement différente) — utile pour le
// classement des suggestions affichées, jamais pour une écriture seule.
// +3 si l'activité principale relève de la pratique dentaire (86.23, toutes
// révisions de nomenclature confondues) : un simple bonus de tri, jamais un
// filtre — un cabinet peut être classé différemment sans être le mauvais
// résultat. Un établissement fermé (etat_administratif !== "A") est écarté.
const scorer = (resultat: any, villeCherchee: string): number | null => {
  if (resultat.etat_administratif !== "A") return null
  let score = 0
  const commune = normaliser(resultat.siege?.libelle_commune)
  const ville = normaliser(villeCherchee)
  if (ville && commune === ville) score += 10
  else if (ville && commune && (commune.includes(ville) || ville.includes(commune))) score += 4
  const naf = resultat.activite_principale ?? ""
  if (naf.startsWith("86.23")) score += 3
  return score
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  let body: { q?: string; ville?: string; client_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: "JSON invalide" }, 400)
  }

  const q = body.q?.trim()
  if (!q) {
    return json({ error: "q requis" }, 400)
  }
  const ville = body.ville?.trim() ?? ""

  // Jamais de blocage si l'API est indisponible ou répond mal : une
  // recherche d'adresse est un confort, pas une dépendance critique de la
  // création d'un client (manuelle ou dictée).
  //
  // per_page=25 (pas 10) : constaté en testant le correctif prénom+nom —
  // l'API ne classe pas ses résultats par pertinence dentaire/géographique,
  // un praticien au nom courant (ex. « Jean-Christophe Mathieu ») peut se
  // retrouver 11e sur des centaines d'homonymes, donc absent des 10 premiers
  // avant même que notre propre score (ville/NAF) n'ait pu s'appliquer.
  let bruts: any[] = []
  try {
    const apiRes = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=25`
    )
    if (apiRes.ok) {
      const apiData = await apiRes.json()
      bruts = Array.isArray(apiData.results) ? apiData.results : []
    }
  } catch {
    // silencieux — voir commentaire ci-dessus
  }

  const scores = bruts
    .map((r: any) => ({ r, score: scorer(r, ville) }))
    .filter((x: any): x is { r: any; score: number } => x.score !== null)
    .sort((a: any, b: any) => b.score - a.score)

  const resultats = scores.slice(0, 5).map(({ r, score }: any) => ({
    nom: r.nom_complet,
    adresse: adresseDepuisSiege(r.siege),
    code_postal: r.siege?.code_postal ?? null,
    ville: r.siege?.libelle_commune ?? null,
    siren: r.siren,
    activite: r.activite_principale ?? null,
    score,
  }))

  let ecrit = false
  let champsEcrits: string[] = []

  if (body.client_id) {
    // Confiant seulement si un candidat a une ville EXACTE (score >= 10) et
    // qu'aucun autre n'atteint ce même niveau — sinon plusieurs cabinets
    // homonymes dans la même ville rendraient le choix automatique risqué.
    const confiant =
      scores.length > 0 && scores[0].score >= 10 && (scores.length === 1 || scores[1].score < 10)

    if (confiant) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      )
      const { data: fiche } = await supabase
        .from("clients")
        .select("adresse, code_postal, ville")
        .eq("id", body.client_id)
        .single()

      if (fiche) {
        const meilleur = resultats[0]
        const update: Record<string, unknown> = {}
        // Enrichir sans écraser : seuls les champs encore vides sont
        // remplis, jamais une valeur déjà dictée par Bruce.
        if (!fiche.adresse && meilleur.adresse) update.adresse = meilleur.adresse
        if (!fiche.code_postal && meilleur.code_postal) update.code_postal = meilleur.code_postal
        if (!fiche.ville && meilleur.ville) update.ville = meilleur.ville

        if (Object.keys(update).length) {
          const { error: erreurEcriture } = await supabase
            .from("clients")
            .update(update)
            .eq("id", body.client_id)
          if (!erreurEcriture) {
            ecrit = true
            champsEcrits = Object.keys(update)
          }
        }
      }
    }
  }

  return json({ resultats, ecrit, champsEcrits })
})
