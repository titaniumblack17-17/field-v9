// Lit le total TTC d'un devis PDF joint à un dossier.
//
// Le montant saisi à la main est le premier à manquer : sur 17 dossiers signés,
// 16 n'en avaient aucun. Le chiffre existe pourtant — il est dans le devis.
//
// Le calcul du montant du dossier n'est pas fait ici : un déclencheur en base
// s'en charge dès que ce fichier change. Cette fonction ne fait que lire.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding/base64'

// Au-delà, l'encodage en base64 tient mal dans la mémoire d'une fonction Edge.
// Un devis d'équipement dentaire dépasse rarement quelques mégaoctets.
const TAILLE_MAX = 10 * 1024 * 1024

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        // supabase-js ajoute x-client-info et x-supabase-api-version. Absents
        // de cette liste, le contrôle préalable CORS échoue et l'appel depuis
        // l'application meurt en « Failed to fetch » — alors qu'un curl passe.
        'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    },
  })

const nombre = (v: unknown) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return null
  // « 59 000,00 » et « 59,000.00 » désignent la même somme selon la casse du
  // logiciel qui a produit le devis.
  const net = v.replace(/[^\d,.-]/g, '')
  const n = Number(net.replace(/\s/g, '').replace(/,(\d{2})$/, '.$1').replace(/[,](?=\d{3})/g, ''))
  return Number.isFinite(n) ? n : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  const cle = Deno.env.get('FIELD_EDGE_API_KEY')
  if (!cle) return json({ erreur: 'FIELD_EDGE_API_KEY absente des secrets.' }, 503)

  let fichierId: string
  try {
    fichierId = (await req.json()).fichierId
  } catch {
    return json({ erreur: 'Corps JSON invalide.' }, 400)
  }
  if (!fichierId) return json({ erreur: 'fichierId manquant.' }, 400)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: fichier } = await db
    .from('fichiers')
    .select('id, chemin, nom, taille, type_mime, dossier_id')
    .eq('id', fichierId)
    .single()

  if (!fichier) return json({ erreur: 'Fichier introuvable.' }, 404)
  if (fichier.type_mime !== 'application/pdf') {
    return json({ erreur: 'Seuls les PDF sont analysés.', ignore: true }, 200)
  }
  if (!fichier.dossier_id) {
    // Un PDF sur une fiche client n'appartient à aucun chiffrage.
    return json({ ignore: true, raison: 'PDF hors dossier' }, 200)
  }
  if ((fichier.taille ?? 0) > TAILLE_MAX) {
    await db.from('fichiers').update({
      analyse_at: new Date().toISOString(),
      analyse_erreur: 'PDF trop volumineux pour être analysé (10 Mo maximum).',
    }).eq('id', fichierId)
    return json({ erreur: 'PDF trop volumineux (10 Mo maximum).' }, 413)
  }

  const { data: blob, error: errTelechargement } = await db.storage
    .from('documents')
    .download(fichier.chemin)

  if (errTelechargement || !blob) {
    return json({ erreur: errTelechargement?.message ?? 'Téléchargement impossible.' }, 502)
  }

  const pdf = encodeBase64(new Uint8Array(await blob.arrayBuffer()))

  const consigne = `Tu lis un devis d'équipement dentaire, rédigé en français, adressé par un fournisseur à un cabinet.

Trouve le MONTANT GLOBAL de l'offre : la somme totale annoncée au client pour l'ensemble du devis.

Où il se trouve :
- Souvent sur l'une des dernières pages, sous un titre comme « Étude financière », « Récapitulatif » ou « Conditions ».
- Pas toujours dans un tableau. Il est fréquemment écrit au fil du texte, sans mise en forme particulière : « le montant est de : … € ttc », « votre étude financière se base sur un montant de … », « montant global », « soit un total de … ».
- Le libellé « TOTAL » peut être absent du document. Ne t'y fies pas comme seul repère.

Règle décisive :
- Si le document énonce quelque part un montant d'ensemble, RETIENS-LE, même s'il ne correspond pas à la somme des postes détaillés. Un devis peut lister des postes puis annoncer un montant global différent — remise, poste retiré, arrondi commercial. Le montant annoncé est celui qui engage le fournisseur ; ne le recalcule pas.
- Seulement si AUCUN montant d'ensemble n'est énoncé et que le document chiffre les postes d'un même projet, additionne ces postes et mets somme_calculee à true.
- N'additionne JAMAIS des variantes, des options ou des offres alternatives entre lesquelles le client doit choisir.

À écarter : un sous-total, le prix d'une ligne, un acompte, une mensualité de financement, une valeur de reprise, une remise, et le capital social du fournisseur qui figure souvent en pied de page.

Si le document n'est pas un devis (facture, plan, courrier seul, documentation technique sans prix), renvoie devis: false.

Réponds UNIQUEMENT par un objet JSON, sans texte autour et sans balises markdown :
- devis: true ou false
- montant_ttc: le montant global TTC en nombre (point décimal, sans symbole ni espace), ou null
- montant_ht: le montant global HT en nombre, ou null
- somme_calculee: true si tu as dû additionner faute de montant annoncé, sinon false
- extrait: la phrase exacte du document d'où vient le montant, recopiée mot pour mot, 200 caractères au plus, ou null
- page: le numéro de page où tu l'as lu, ou null
- reference: la référence ou le numéro du devis, ou null
- date_devis: la date du devis au format YYYY-MM-DD, ou null
- doute: OBLIGATOIRE si montant_ttc est null — explique alors en une phrase, 300 caractères au plus, ce que tu as cherché et pourquoi tu n'as rien retenu. Sinon, mentionne toute ambiguïté, ou null si le montant est sans équivoque.

Un montant faux alimenterait un suivi de chiffre d'affaires : dans le doute, renvoie null et explique-toi dans doute.`

  const reponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cle,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
            { type: 'text', text: consigne },
          ],
        },
      ],
    }),
  })

  if (!reponse.ok) {
    const detail = await reponse.text()
    await db.from('fichiers').update({
      analyse_at: new Date().toISOString(),
      analyse_erreur: `Lecture impossible (${reponse.status}).`,
    }).eq('id', fichierId)
    return json({ erreur: 'Lecture du PDF impossible.', detail }, 502)
  }

  const charge = await reponse.json()
  // Le premier bloc n'est pas toujours du texte (raisonnement, outil) : on
  // concatène tous les blocs textuels plutôt que de parier sur content[0].
  const brut = (charge.content ?? [])
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')

  let lu: any = null
  try {
    const m = brut.match(/\{[\s\S]*\}/)
    if (m) lu = JSON.parse(m[0])
  } catch {
    lu = null
  }

  // Une réponse illisible ne doit pas se déguiser en devis sans montant : sans
  // ce garde-fou, l'échec ressemble à une abstention motivée.
  if (lu === null) {
    const motif = charge.stop_reason === 'max_tokens'
      ? 'Réponse tronquée par la limite de jetons.'
      : `Réponse illisible du modèle (${charge.stop_reason ?? 'sans motif'}).`
    await db.from('fichiers').update({
      analyse_at: new Date().toISOString(),
      analyse_erreur: motif,
    }).eq('id', fichierId)
    return json({ erreur: motif, stop_reason: charge.stop_reason ?? null, brut: brut.slice(0, 600) }, 502)
  }

  if (lu.devis === false) {
    await db.from('fichiers').update({
      analyse_at: new Date().toISOString(),
      analyse_erreur: "Ce document n'a pas été reconnu comme un devis.",
    }).eq('id', fichierId)
    return json({ devis: false })
  }

  const ttc = nombre(lu.montant_ttc)
  const ht = nombre(lu.montant_ht)

  await db.from('fichiers').update({
    montant_ttc: ttc,
    montant_ht: ht,
    reference_devis: lu.reference ?? null,
    date_devis: lu.date_devis ?? null,
    analyse_at: new Date().toISOString(),
    analyse_erreur: ttc === null ? (lu.doute ?? 'Total TTC introuvable dans ce PDF.') : null,
  }).eq('id', fichierId)

  // Trace au journal : un montant qui change tout seul doit dire d'où il vient.
  if (ttc !== null) {
    const { data: dossier } = await db
      .from('dossiers')
      .select('montant_estime')
      .eq('id', fichier.dossier_id)
      .single()

    await db.from('dossier_notes').insert({
      dossier_id: fichier.dossier_id,
      texte:
        `Montant lu dans « ${fichier.nom} » : ` +
        `${new Intl.NumberFormat('fr-FR').format(ttc)} € TTC` +
        (lu.reference ? ` (devis ${lu.reference})` : '') +
        `. Montant du dossier porté à ${new Intl.NumberFormat('fr-FR').format(dossier?.montant_estime ?? ttc)} € TTC.` +
        (lu.extrait ? `\nLu : « ${lu.extrait} »${lu.page ? ` (page ${lu.page})` : ''}` : '') +
        (lu.somme_calculee ? `\n⚠ Aucun montant global annoncé : somme des postes.` : '') +
        (lu.doute ? `\n⚠ ${lu.doute}` : ''),
    })
  }

  return json({
    devis: true,
    montant_ttc: ttc,
    montant_ht: ht,
    reference: lu.reference ?? null,
    somme_calculee: lu.somme_calculee === true,
    extrait: lu.extrait ?? null,
    page: lu.page ?? null,
    doute: lu.doute ?? null,
  })
})
