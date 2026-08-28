import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

// Liste fermée de spécialités — un seul endroit à modifier si Bruce veut
// l'ajuster (le prompt et le front-end doivent rester synchronisés dessus).
const SPECIALITES = [
  "Omnipratique",
  "Orthodontie",
  "Implantologie",
  "Parodontologie",
  "Endodontie",
  "Chirurgie orale",
  "Pédodontie",
  "Prothèse dentaire",
  "Esthétique dentaire",
]

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  let body: { client_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "JSON invalide" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  const clientId = body.client_id
  if (!clientId) {
    return new Response(JSON.stringify({ error: "client_id requis" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: fiche, error: erreurFiche } = await supabase
    .from("clients")
    .select(
      "id, nom_praticien, prenom_praticien, nom_cabinet, adresse, ville, code_postal, telephone_portable, telephone_cabinet, email, email_cabinet, specialites, associes"
    )
    .eq("id", clientId)
    .single()

  if (erreurFiche || !fiche) {
    return new Response(JSON.stringify({ error: erreurFiche?.message ?? "Fiche introuvable" }), {
      status: 404,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  // On ne demande que ce qui manque réellement — inutile de faire chercher
  // (et risquer de proposer, à tort, une valeur différente) un champ déjà
  // rempli sur la fiche : celle-ci fait autorité une fois renseignée.
  const champsManquants: string[] = []
  if (!fiche.prenom_praticien) champsManquants.push("prenom_praticien")
  if (!fiche.specialites?.length) champsManquants.push("specialites")
  if (!fiche.adresse) champsManquants.push("adresse")
  if (!fiche.ville) champsManquants.push("ville")
  if (!fiche.code_postal) champsManquants.push("code_postal")
  if (!fiche.telephone_cabinet) champsManquants.push("telephone_cabinet")
  if (!fiche.email_cabinet) champsManquants.push("email_cabinet")

  if (!champsManquants.length) {
    return new Response(
      JSON.stringify({
        prenom_praticien: null, specialites: [], adresse: null, ville: null, code_postal: null,
        telephone_cabinet: null, email_cabinet: null, associes: [],
        sources: [], incertitude: "Fiche déjà complète sur tous les champs recherchés.",
      }),
      { headers: { ...corsHeaders, "content-type": "application/json" } }
    )
  }

  const identite = [fiche.prenom_praticien, fiche.nom_praticien].filter(Boolean).join(" ")
  const associesExistants = (fiche.associes ?? [])
    .map((a: any) => [a.prenom, a.nom].filter(Boolean).join(" "))
    .filter(Boolean)

  const prompt = `Tu recherches sur le web des informations professionnelles publiques sur un chirurgien-dentiste français, pour compléter la fiche client d'un commercial en équipement dentaire. Utilise l'outil de recherche web (Doctolib, annuaire de l'Ordre national des chirurgiens-dentistes, Pages Jaunes, Google Maps, site du cabinet…).

Praticien à identifier : ${identite || "(prénom inconnu)"} ${fiche.nom_praticien}
${fiche.nom_cabinet ? `Cabinet connu : ${fiche.nom_cabinet}\n` : ""}${fiche.ville ? `Ville connue : ${fiche.ville}\n` : ""}${fiche.code_postal ? `Code postal connu : ${fiche.code_postal}\n` : ""}${fiche.adresse ? `Adresse connue : ${fiche.adresse}\n` : ""}${fiche.telephone_portable ? `Portable déjà enregistré (ne le redemande pas, sert juste à confirmer l'identité) : ${fiche.telephone_portable}\n` : ""}${associesExistants.length ? `Associé(s) déjà connus (ne les reproduis pas) : ${associesExistants.join(", ")}\n` : ""}

Champs à compléter (uniquement ceux-ci, les autres sont déjà remplis et ne doivent pas être renvoyés) : ${champsManquants.join(", ")}.

RISQUE D'HOMONYME : un nom de famille français courant peut correspondre à plusieurs praticiens différents. Avant de proposer une valeur, vérifie qu'elle correspond bien à CE praticien précis (recoupe ville/cabinet/prénom si disponibles). En cas de doute réel sur l'identité, ne propose rien pour les champs concernés et explique le doute dans "incertitude" plutôt que de deviner.

Si "specialites" fait partie des champs à compléter, choisis uniquement parmi cette liste fermée (aucune autre valeur, respecte l'orthographe exacte, plusieurs possibles) : ${SPECIALITES.join(", ")}.

Si tu découvres que ce praticien exerce dans un cabinet partagé avec d'autres chirurgiens-dentistes (même adresse), liste-les dans "associes" (prénom + nom), même si "associes" n'était pas dans la liste des champs à compléter ci-dessus — c'est une information à part qui vient s'ajouter, pas remplacer.

Réponds à la toute fin par UN SEUL objet JSON (rien d'autre autour, pas de markdown), avec exactement ces clés :
{
  "prenom_praticien": chaîne ou null,
  "specialites": [liste de chaînes parmi la liste fermée, ou tableau vide],
  "adresse": chaîne ou null,
  "ville": chaîne ou null,
  "code_postal": chaîne ou null,
  "telephone_cabinet": chaîne ou null (format français 10 chiffres),
  "email_cabinet": chaîne ou null,
  "associes": [{"prenom": chaîne ou null, "nom": chaîne}] (tableau vide si aucun trouvé),
  "sources": [{"champ": nom du champ concerné, "url": url exacte de la source, "titre": titre de la page}],
  "incertitude": chaîne expliquant les doutes ou les homonymes possibles, ou null si aucun doute
}`

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("FIELD_EDGE_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    }),
  })

  if (!claudeRes.ok) {
    const errText = await claudeRes.text()
    return new Response(JSON.stringify({ error: "Claude API error", detail: errText }), {
      status: 502,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  const claudeData = await claudeRes.json()

  // Seuls les blocs de type "text" portent la réponse finale — les blocs
  // server_tool_use / web_search_tool_result contiennent aussi du JSON
  // (les requêtes de recherche, les résultats bruts) qu'il ne faut pas
  // confondre avec la réponse structurée attendue.
  const texte = (claudeData.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")

  let resultat: any
  try {
    const jsonMatch = texte.match(/\{[\s\S]*\}/)
    resultat = JSON.parse(jsonMatch ? jsonMatch[0] : texte)
  } catch {
    return new Response(
      JSON.stringify({ error: "Réponse du modèle illisible", detail: texte.slice(0, 500) }),
      { status: 502, headers: { ...corsHeaders, "content-type": "application/json" } }
    )
  }

  // Garde-fou déterministe : une spécialité hors liste fermée est écartée
  // plutôt que remontée telle quelle — le front-end affiche des cases à
  // cocher sur cette liste, une valeur inconnue n'aurait nulle part où
  // s'afficher.
  const specialitesValides = Array.isArray(resultat.specialites)
    ? resultat.specialites.filter((s: string) => SPECIALITES.includes(s))
    : []

  const reponse = {
    prenom_praticien: resultat.prenom_praticien?.trim() || null,
    specialites: specialitesValides,
    adresse: resultat.adresse?.trim() || null,
    ville: resultat.ville?.trim() || null,
    code_postal: resultat.code_postal?.trim() || null,
    telephone_cabinet: resultat.telephone_cabinet?.trim() || null,
    email_cabinet: resultat.email_cabinet?.trim() || null,
    associes: Array.isArray(resultat.associes) ? resultat.associes : [],
    sources: Array.isArray(resultat.sources) ? resultat.sources : [],
    incertitude: resultat.incertitude?.trim() || null,
  }

  // Écriture automatique, sans repasser par Bruce : chaque champ proposé
  // n'existe déjà que parce que le prompt ci-dessus a demandé au modèle de
  // s'abstenir en cas de doute réel (homonyme, information non recoupée) —
  // c'est CE filtre, en amont, qui tient lieu de garde-fou ici, à défaut
  // d'une relecture humaine. Jamais d'écrasement d'un champ déjà rempli :
  // champsManquants (calculé plus haut) ne contenait déjà que des colonnes
  // vides au moment de la requête.
  const update: Record<string, unknown> = {}
  if (reponse.prenom_praticien) update.prenom_praticien = reponse.prenom_praticien
  if (reponse.specialites.length) update.specialites = reponse.specialites
  if (reponse.adresse) update.adresse = reponse.adresse
  if (reponse.ville) update.ville = reponse.ville
  if (reponse.code_postal) update.code_postal = reponse.code_postal
  if (reponse.telephone_cabinet) update.telephone_cabinet = reponse.telephone_cabinet
  if (reponse.email_cabinet) update.email_cabinet = reponse.email_cabinet

  if (reponse.associes.length) {
    // Un associé déjà sur la fiche (ajouté par un appel précédent, ou saisi
    // à la main) ne doit jamais être dupliqué — une nouvelle recherche peut
    // retrouver le même confrère si un autre champ de la fiche manquait
    // encore et déclenchait un nouvel appel.
    const clefPersonne = (p: any) => `${(p.prenom ?? "").trim().toLowerCase()}|${(p.nom ?? "").trim().toLowerCase()}`
    const dejaPresents = new Set((fiche.associes ?? []).map(clefPersonne))
    const nouveaux = reponse.associes
      .filter((a: any) => !dejaPresents.has(clefPersonne(a)))
      .map((a: any) => ({ prenom: a.prenom ?? "", nom: a.nom, telephone: "" }))
    if (nouveaux.length) {
      update.associes = [...(fiche.associes ?? []), ...nouveaux]
    }
  }

  let ecrit = false
  if (Object.keys(update).length) {
    const { error: erreurEcriture } = await supabase.from("clients").update(update).eq("id", clientId)
    ecrit = !erreurEcriture
  }

  return new Response(
    JSON.stringify({ ...reponse, ecrit, champsEcrits: Object.keys(update) }),
    { headers: { ...corsHeaders, "content-type": "application/json" } }
  )
})
