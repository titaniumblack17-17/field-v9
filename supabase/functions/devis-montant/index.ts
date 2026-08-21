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
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
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

  const consigne = `Tu lis un devis d'équipement dentaire, rédigé en français.

Trouve le TOTAL GÉNÉRAL du devis — la somme finale que le client doit payer.

Pièges à éviter :
- Ne prends pas un sous-total, un total de page, ni le prix d'une ligne.
- Ne prends pas un acompte, une mensualité, une valeur de reprise ni une remise.
- S'il y a plusieurs variantes ou options chiffrées séparément, prends le total de l'offre retenue ; si aucune n'est désignée, renvoie null.
- Si le document n'est pas un devis (facture, bon de commande, plan, courrier), renvoie devis: false.

Réponds UNIQUEMENT par un objet JSON, sans texte autour et sans balises markdown :
- devis: true ou false
- montant_ttc: le total TTC en nombre (points décimaux, sans symbole ni espace), ou null si tu ne le trouves pas avec certitude
- montant_ht: le total HT en nombre, ou null
- reference: la référence ou le numéro du devis, ou null
- date_devis: la date du devis au format YYYY-MM-DD, ou null
- doute: une phrase courte expliquant ce qui t'a fait hésiter, ou null si le total est sans ambiguïté

Dans le doute, renvoie null plutôt qu'un nombre approché : ce montant alimente un suivi de chiffre d'affaires, un chiffre faux y est pire qu'un chiffre absent.`

  const reponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cle,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 400,
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

  const brut = (await reponse.json()).content?.[0]?.text ?? '{}'
  let lu: any
  try {
    const m = brut.match(/\{[\s\S]*\}/)
    lu = JSON.parse(m ? m[0] : brut)
  } catch {
    lu = {}
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
        (lu.doute ? `\n⚠ ${lu.doute}` : ''),
    })
  }

  return json({ devis: true, montant_ttc: ttc, montant_ht: ht, reference: lu.reference ?? null, doute: lu.doute ?? null })
})
