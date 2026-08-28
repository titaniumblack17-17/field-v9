import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

// Une dictée coupée en plein milieu se refait. Sans normalisation, « Docteur
// Najm » et « najm » sont deux praticiens différents, et la seconde tentative
// crée une fiche de plus au lieu de compléter la première.
const normaliser = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(dr|docteur)\s+/, "")
    .trim()

// Deux praticiens homonymes aux prénoms différents restent deux fiches : on ne
// rapproche que si les prénoms concordent, ou si l'un des deux est absent.
const trouverExistant = (clients: any[], nom: string, prenom: string | null) => {
  const n = normaliser(nom)
  const p = normaliser(prenom)
  return clients.find((c: any) => {
    if (normaliser(c.nom_praticien) !== n) return false
    const cp = normaliser(c.prenom_praticien)
    return !cp || !p || cp === p
  })
}

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

  let body: { texte?: string; source?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "JSON invalide" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  const { texte, source } = body
  if (!texte?.trim() || !source || !["vocal", "clavier"].includes(source)) {
    return new Response(JSON.stringify({ error: "texte et source (vocal|clavier) requis" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: clients } = await supabase
    .from("clients")
    .select("id, prenom_praticien, nom_praticien, nom_cabinet, ville")

  const clientsList = (clients ?? [])
    .map((c: any) =>
      `${c.id} | ${[c.prenom_praticien, c.nom_praticien].filter(Boolean).join(" ")} | ${c.nom_cabinet ?? ""} | ${c.ville ?? ""}`
    )
    .join("\n")

  const today = new Date().toISOString().slice(0, 10)

  const prompt = `Tu aides un commercial en équipement dentaire à traiter une note dictée ou tapée rapidement, souvent en voiture entre deux rendez-vous.

Liste des clients existants (id | nom | cabinet | ville) :
${clientsList || "(aucun client enregistré)"}

Date du jour : ${today}

Note à traiter :
"""
${texte}
"""

Deux cas possibles pour l'action :
1. La note demande EXPLICITEMENT de créer une nouvelle fiche client (ex: "crée une fiche pour...", "nouveau client...", "ajoute le docteur...") ET le praticien ne figure PAS déjà dans la liste ci-dessus — dans ce cas action = "creer_client". Extrais TOUTES les informations mentionnées pour remplir la fiche le plus complètement possible (nom, prénom, adresse, code postal, ville, cabinet, téléphone portable, téléphone du cabinet, e-mail).
2. La note mentionne un client déjà présent dans la liste, ou un événement (appel, rappel, info) sans demander explicitement une création — action = "capture".

IMPORTANT : une dictée vocale peut avoir été coupée avant la fin, et l'utilisateur la refait alors depuis le début. Si le praticien nommé figure déjà dans la liste, ne demande JAMAIS de le créer une seconde fois : renvoie action="capture" avec son client_id. Renseigne quand même les champs extraits (adresse, ville, téléphone portable, téléphone du cabinet, e-mail, cabinet) s'ils sont mentionnés : ils serviront à compléter la fiche existante.

DÉTECTION SAV (indépendante de l'action ci-dessus) : la note décrit-elle un équipement en panne, cassé, qui ne fonctionne plus, ou une demande d'intervention/réparation chez un praticien ? Si oui, sav_suggere = true et sav_titre = un résumé très court (moins de 60 caractères) du problème, ex. "Fauteuil ne monte plus", "Autoclave en panne". Une simple relance commerciale, un rendez-vous, une demande de devis ne sont PAS des SAV. Dans le doute, sav_suggere = false — mieux vaut rater une suggestion que la déclencher à tort.

DÉTECTION PLAN (indépendante des deux ci-dessus, exclusive avec SAV et Projet, à trancher AVANT Projet) : la note décrit-elle une demande de plan d'implantation ou de cahier des charges à produire comme PRESTATION TECHNIQUE SÉPARÉE — pour un autre commercial, en projet partagé, ou facturée à part — et non un plan lié à une vente que Bruce mène lui-même ? Signal fort et non ambigu : un commercial autre que Bruce est nommé (initiales ou nom — JYM/Jean-Yves Mevel, AB/Alain Bailleul, PL/Pierre Lecomte, PF/Paul Fouillet, SDR/Stéphane Do Rego, LG/Laurent Gaston, DB/Didier Bellaz) accompagné d'un plan/cahier des charges à produire pour lui, avec ou sans montant de facturation précisé. Exemples qui déclenchent plan_suggere : "il faut faire un plan pour le dossier de Marc", "cahier des charges à produire pour un confrère", "plan à faire, projet partagé avec untel", "plan et cahier des charges pour jym, facturation 500€". Ce n'est PAS un plan à signaler séparément : un plan mentionné dans le cadre d'un de ses propres projets de vente (aucun commercial tiers nommé) — laisse la détection Projet ci-dessous s'en occuper normalement, ne double-compte pas. Dès qu'un commercial tiers est nommé pour un plan/cahier des charges, c'est un plan et PAS un projet — même si la note contient par ailleurs une adresse ou ressemble à l'ouverture d'un nouveau dossier : ne coche pas projet_suggere dans ce cas. Dans le doute (aucun commercial tiers nommé), plan_suggere = false.

DÉTECTION PROJET (indépendante des deux ci-dessus, exclusive avec SAV et avec Plan — si Plan est vrai, projet_suggere doit rester false) : la note décrit-elle une opportunité commerciale naissante — un praticien qui envisage d'acheter, d'ajouter, de renouveler ou d'agrandir un équipement ou un cabinet, OU la création/le rachat/la reprise d'un cabinet (même partiellement décrit, même avec des détails d'équipement en vrac) ? Exemples : "il veut ajouter un second fauteuil", "elle envisage d'agrandir son cabinet", "renouvellement de l'autoclave à prévoir", "création d'un nouveau cabinet", "rachat d'un cabinet existant d'un praticien qui part à la retraite", "transfert de son matériel vers son nouveau local". Une liste d'équipements à transférer ou à commander pour un nouveau cabinet EST un projet, même sans montant chiffré. Si oui, projet_suggere = true et projet_titre = un résumé très court (moins de 60 caractères) de l'opportunité, ex. "Ajout d'un second fauteuil", "Renouvellement autoclave", "Rachat de cabinet existant", "Création de cabinet". Ce n'est PAS un projet : une simple prise de rendez-vous sans besoin décrit, une relance sur un dossier déjà existant sans nouvel élément, un événement administratif. Dans le doute, projet_suggere = false — un dossier créé à tort pollue le pipeline plus longtemps qu'une suggestion ratée ne coûte.

Réponds UNIQUEMENT avec un objet JSON (pas de texte autour, pas de markdown), avec ces clés :
- action: "creer_client" ou "capture"
- client_id: (si action="capture") l'id exact du client concerné si tu le reconnais dans la liste ci-dessus, sinon null
- prenom_praticien: le prénom mentionné, sinon null
- nom_praticien: le nom de famille du praticien (sans "Dr"/"Docteur"), sinon null
- nom_cabinet: le nom du cabinet mentionné, sinon null
- adresse: l'adresse (numéro et rue) mentionnée, sinon null
- code_postal: le code postal mentionné, sinon null
- ville: la ville mentionnée, sinon null
- telephone_portable: le numéro de portable du praticien mentionné, sinon null
- telephone_cabinet: le numéro de téléphone DU CABINET mentionné (fixe, secrétariat, standard), sinon null. Reconnais-le à ce qui l'introduit — « numéro du cabinet », « téléphone du cabinet », « standard », « secrétariat », « fixe » — plutôt qu'à sa forme : un dictée peut donner deux numéros dans la même phrase, l'un portable et l'autre cabinet, ne mets jamais le second dans telephone_portable ni l'inverse. Si un seul numéro est mentionné sans préciser lequel, mets-le dans telephone_portable (comportement historique) et ne remplis pas telephone_cabinet.
- email: l'adresse e-mail mentionnée, sinon null

ATTENTION à la dictée vocale d'un e-mail ou d'un numéro : elle est souvent mal
transcrite (espace insérée au milieu d'une adresse, prénom accolé juste avant
l'arobase comme dans "Laura g8@gmail.com", chiffres manquants en fin de
numéro). N'essaie PAS de deviner la version correcte en fusionnant ou en
coupant des mots : extrais tel quel ce qui ressemble le plus à l'e-mail ou au
numéro (portable ou cabinet), et si un doute existe sur son exactitude
(numéro de moins de 10 chiffres, e-mail où un mot adjacent pourrait en faire
partie), signale-le via info_manquante plutôt que de laisser une valeur
peut-être fausse sans avertissement.

- resume: un résumé court (une phrase) de ce qui doit être retenu. N'omets
  aucun nom propre ou détail secondaire mentionné (ex: un groupe, un confrère,
  une société) même s'il ne rentre dans aucun autre champ : il vaut mieux un
  résumé un peu long qu'un détail perdu.
- date_evenement: une date au format YYYY-MM-DD si une échéance ou un rendez-vous est mentionné, sinon null
- info_manquante: une courte phrase décrivant soit une info critique qui
  manque (nom, adresse, code postal, ville, portable, e-mail), soit une info
  présente mais douteuse à cause d'une dictée mal transcrite (ex: "e-mail à
  vérifier — transcription vocale ambiguë", "portable incomplet, 8 chiffres
  au lieu de 10"), ou null si rien ne manque et rien ne doute
- sav_suggere: true ou false
- sav_titre: le résumé court du problème si sav_suggere est true, sinon null
- projet_suggere: true ou false
- projet_titre: le résumé court de l'opportunité si projet_suggere est true, sinon null
- plan_suggere: true ou false
- plan_titre: le résumé court de la demande si plan_suggere est true, sinon null`

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("FIELD_EDGE_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
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
  const rawText = claudeData.content?.[0]?.text ?? "{}"

  let extracted: any
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    extracted = JSON.parse(jsonMatch ? jsonMatch[0] : rawText)
  } catch {
    extracted = {
      action: "capture", client_id: null, resume: texte.slice(0, 200), date_evenement: null,
      info_manquante: "extraction échouée", sav_suggere: false, sav_titre: null,
      projet_suggere: false, projet_titre: null, plan_suggere: false, plan_titre: null,
    }
  }

  // Champs dictés, utilisables aussi bien pour créer que pour compléter.
  const champs: Record<string, string | null> = {
    prenom_praticien: extracted.prenom_praticien?.trim() || null,
    nom_cabinet: extracted.nom_cabinet?.trim() || null,
    adresse: extracted.adresse?.trim() || null,
    code_postal: extracted.code_postal?.trim() || null,
    ville: extracted.ville?.trim() || null,
    telephone_portable: extracted.telephone_portable?.trim() || null,
    telephone_cabinet: extracted.telephone_cabinet?.trim() || null,
    email: extracted.email?.trim() || null,
  }

  // Garde-fou déterministe : demander au modèle de signaler un e-mail ou un
  // portable douteux via info_manquante ne suffit pas, il oublie parfois. On
  // revalide en code, systématiquement, pour qu'une valeur invalide ne puisse
  // jamais atterrir dans un champ réel — ni à la création, ni en complétant
  // une fiche existante (les deux branches ci-dessous partagent ce `champs`).
  const validationWarnings: string[] = []

  if (champs.telephone_portable) {
    const valeurOriginale = champs.telephone_portable
    const chiffres = valeurOriginale.replace(/\D/g, "")
    if (chiffres.length !== 10) {
      champs.telephone_portable = null
      validationWarnings.push(
        `portable incomplet ou invalide (${chiffres.length} chiffres) : « ${valeurOriginale} »`
      )
    }
  }

  if (champs.telephone_cabinet) {
    const valeurOriginale = champs.telephone_cabinet
    const chiffres = valeurOriginale.replace(/\D/g, "")
    if (chiffres.length !== 10) {
      champs.telephone_cabinet = null
      validationWarnings.push(
        `téléphone cabinet incomplet ou invalide (${chiffres.length} chiffres) : « ${valeurOriginale} »`
      )
    }
  }

  // Filet déterministe indépendant du modèle : plutôt que de compter sur
  // lui pour repérer CHAQUE numéro et le ranger dans le bon champ (un
  // numéro de cabinet dicté et pourtant jamais retrouvé dans la fiche en
  // est la preuve), on cherche nous-mêmes dans le texte brut toute séquence
  // qui ressemble à un numéro français. Un numéro qu'il a extrait mais mal
  // rangé, ou qu'il a purement et simplement manqué, n'est alors jamais
  // perdu en silence — il atterrit dans le champ encore vide, ou se signale
  // via info_manquante s'il n'y a plus de place.
  const numerosDansLeTexte = [
    ...new Set(
      (texte.match(/0[\s.-]?[1-9](?:[\s.-]?\d{2}){4}/g) ?? []).map((m) => m.replace(/\D/g, ""))
    ),
  ]
  const dejaCaptures = new Set(
    [champs.telephone_portable, champs.telephone_cabinet]
      .filter((v): v is string => v !== null)
      .map((n) => n.replace(/\D/g, ""))
  )
  const numerosOublies = numerosDansLeTexte.filter((n) => !dejaCaptures.has(n))
  for (const n of numerosOublies) {
    if (!champs.telephone_cabinet) {
      champs.telephone_cabinet = n
    } else if (!champs.telephone_portable) {
      champs.telephone_portable = n
    } else {
      validationWarnings.push(`numéro supplémentaire repéré dans le texte, non rangé : « ${n} »`)
    }
  }

  if (champs.email) {
    const valeurOriginale = champs.email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeurOriginale)) {
      champs.email = null
      validationWarnings.push(`e-mail invalide : « ${valeurOriginale} »`)
    }
  }

  const nomDicte = extracted.nom_praticien?.trim()

  // Carnet d'adresses Mac (vCard importé une fois pour toutes dans
  // carnet_contacts — voir scripts/peupler-carnet.mjs) : complète les champs
  // que la dictée n'a pas fournis, sans jamais écraser ce qu'elle a donné —
  // priorité systématique à ce que Bruce a dit. Même règle de rapprochement
  // que trouverExistant (prénom concordant ou absent) et mêmes garde-fous que
  // l'import ponctuel des fiches existantes (importer-contacts-mac.mjs) : un
  // champ n'est retenu que si TOUTES les entrées du carnet pour ce nom
  // s'accordent, un numéro non français n'est jamais proposé (signe fiable
  // d'un homonyme sans rapport), et une valeur identique au champ jumeau
  // (portable/cabinet, email/pro) n'est pas dupliquée.
  if (nomDicte) {
    const nCarnet = normaliser(nomDicte)
    const pCarnet = normaliser(champs.prenom_praticien)
    const { data: correspondances } = await supabase
      .from("carnet_contacts")
      .select(
        "prenom_normalise, telephone_portable, telephone_cabinet, email, email_cabinet, adresse, ville, code_postal"
      )
      .eq("nom_normalise", nCarnet)

    const pertinentes = (correspondances ?? []).filter((c: any) => {
      const cp = c.prenom_normalise
      return !cp || !pCarnet || cp === pCarnet
    })

    if (pertinentes.length) {
      const COLONNES_CARNET = [
        "telephone_portable",
        "telephone_cabinet",
        "email",
        "email_cabinet",
        "adresse",
        "ville",
        "code_postal",
      ] as const
      const PAIRES_CARNET: Record<string, string> = {
        telephone_portable: "telephone_cabinet",
        telephone_cabinet: "telephone_portable",
        email: "email_cabinet",
        email_cabinet: "email",
      }
      const estNumeroFRCarnet = (v: string) => {
        let d = v.replace(/\D/g, "")
        if (d.startsWith("33") && d.length === 11) d = "0" + d.slice(2)
        if (d.startsWith("0033") && d.length === 13) d = "0" + d.slice(4)
        return /^0\d{9}$/.test(d)
      }
      const clefComparaison = (colonne: string, v: string) =>
        colonne.startsWith("telephone") ? v.replace(/\D/g, "") : normaliser(v)

      for (const colonne of COLONNES_CARNET) {
        if (champs[colonne]) continue // la dictée a déjà donné ce champ : le carnet ne le remplace jamais

        const candidats = new Map<string, string>()
        for (const c of pertinentes) {
          const v = (c as any)[colonne]
          if (!v) continue
          const clef = clefComparaison(colonne, v)
          if (!candidats.has(clef)) candidats.set(clef, v)
        }
        if (candidats.size !== 1) continue // absent du carnet, ou plusieurs homonymes en désaccord

        const valeur = [...candidats.values()][0]
        if (colonne.startsWith("telephone") && !estNumeroFRCarnet(valeur)) continue

        const jumelle = PAIRES_CARNET[colonne]
        if (jumelle && champs[jumelle] && clefComparaison(colonne, valeur) === clefComparaison(jumelle, champs[jumelle]!)) {
          continue
        }

        champs[colonne] = valeur
      }
    }
  }

  // Filet déterministe : même si le modèle redemande une création, on ne crée
  // pas un second exemplaire d'un praticien déjà enregistré.
  const existant = nomDicte
    ? trouverExistant(clients ?? [], nomDicte, champs.prenom_praticien)
    : null

  let client_id: string | null = null
  let cree = false
  let enrichi = false

  if (extracted.action === "creer_client" && nomDicte && !existant) {
    const { data: newClient, error: createError } = await supabase
      .from("clients")
      .insert({ nom_praticien: nomDicte, ...champs })
      .select()
      .single()

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      })
    }

    client_id = newClient.id
    cree = true
  } else {
    const validIds = new Set((clients ?? []).map((c: any) => c.id))
    client_id = existant?.id ?? (validIds.has(extracted.client_id) ? extracted.client_id : null)

    // Une dictée refaite apporte souvent ce que la précédente n'a pas eu le
    // temps de dire. On comble les vides, sans jamais écraser une saisie.
    if (client_id) {
      const aCombler = Object.fromEntries(
        Object.entries(champs).filter(([, v]) => v !== null)
      )
      if (Object.keys(aCombler).length) {
        const { data: fiche } = await supabase
          .from("clients")
          .select("prenom_praticien, nom_cabinet, adresse, code_postal, ville, telephone_portable, telephone_cabinet, email, email_cabinet")
          .eq("id", client_id)
          .single()

        const manquants = Object.fromEntries(
          Object.entries(aCombler).filter(([k]) => !(fiche as any)?.[k])
        )
        if (Object.keys(manquants).length) {
          await supabase.from("clients").update(manquants).eq("id", client_id)
          enrichi = true
        }
      }
    }
  }

  const savSuggere = extracted.sav_suggere === true
  const savTitre = savSuggere ? (extracted.sav_titre?.trim().slice(0, 60) || null) : null

  // Un plan pour un confrère est le signal le plus spécifique des trois : il
  // ne se déclenche que sur une mention explicite (commercial nommé,
  // facturation séparée). Le modèle hedge parfois et coche aussi projet_suggere
  // sur la même note (nouvelle fiche + adresse ressemble à une opportunité) —
  // dans ce cas le plan doit gagner, pas être écrasé. Résolu avant Projet.
  const planSuggere = !savSuggere && extracted.plan_suggere === true
  const planTitre = planSuggere ? (extracted.plan_titre?.trim().slice(0, 60) || null) : null

  // Un projet ne se déclenche jamais en même temps qu'un SAV ni qu'un plan :
  // les trois détections restent mutuellement exclusives.
  const projetSuggere = !savSuggere && !planSuggere && extracted.projet_suggere === true
  const projetTitre = projetSuggere ? (extracted.projet_titre?.trim().slice(0, 60) || null) : null

  // Le info_manquante du modèle et les avertissements déterministes ci-dessus
  // se complètent : on garde les deux plutôt que de laisser l'un écraser l'autre.
  const infoManquante =
    [extracted.info_manquante, ...validationWarnings].filter(Boolean).join(" · ") || null

  const { data: inserted, error } = await supabase
    .from("captures")
    .insert({
      texte,
      source,
      client_id,
      resume: extracted.resume ?? null,
      date_evenement: extracted.date_evenement ?? null,
      info_manquante: infoManquante,
      sav_suggere: savSuggere,
      sav_titre: savTitre,
      projet_suggere: projetSuggere,
      projet_titre: projetTitre,
      plan_suggere: planSuggere,
      plan_titre: planTitre,
    })
    .select()
    .single()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }

  return new Response(
    JSON.stringify({ ...inserted, client_created: cree, client_enrichi: enrichi }),
    { headers: { ...corsHeaders, "content-type": "application/json" } }
  )
})
