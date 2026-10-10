// Lit le montant d'un devis PDF — version qui connaît le typage des documents.
//
// Différences avec devis-montant (laissée intacte tant que la branche n'est pas
// fusionnée) :
//  - ne traite que les fichiers type_doc = 'devis' : un cahier des charges ou un
//    plan se range, il ne se chiffre pas, et n'a donc plus d'« erreur d'analyse » ;
//  - un devis à plusieurs offres exclusives n'est plus une erreur : les offres
//    sont enregistrées dans `variantes`, jamais additionnées, et le devis attend
//    que Bruce en retienne une (le montant du dossier ne bouge pas d'ici là) ;
//  - un montant dont le HT/TTC est douteux n'est pas écrit : il passe « à trancher »
//    avec le motif dans `a_trancher_raison`.
//
// Le calcul du montant du dossier reste fait par le déclencheur en base.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding/base64'

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
  const net = v.replace(/[^\d,.-]/g, '')
  const n = Number(net.replace(/\s/g, '').replace(/,(\d{2})$/, '.$1').replace(/[,](?=\d{3})/g, ''))
  return Number.isFinite(n) ? n : null
}

const eur = (n: number) => new Intl.NumberFormat('fr-FR').format(n)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  const cle = Deno.env.get('FIELD_EDGE_API_KEY')
  if (!cle) return json({ erreur: 'FIELD_EDGE_API_KEY absente des secrets.' }, 503)

  let fichierId: string
  // dryRun : lit le devis et renvoie le résultat sans rien écrire — pour
  // montrer à Bruce ce qui changerait avant d'y toucher.
  let dryRun = false
  try {
    const corps = await req.json()
    fichierId = corps.fichierId
    dryRun = corps.dryRun === true
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
    .select('id, chemin, nom, taille, type_mime, dossier_id, type_doc, montant_ttc, variante_retenue, variantes')
    .eq('id', fichierId)
    .single()

  if (!fichier) return json({ erreur: 'Fichier introuvable.' }, 404)
  if (fichier.type_doc !== 'devis') {
    return json({ ignore: true, raison: `Document de type « ${fichier.type_doc} » : non analysé.` }, 200)
  }
  if (fichier.type_mime !== 'application/pdf') {
    return json({ erreur: 'Seuls les PDF sont analysés.', ignore: true }, 200)
  }
  if (!fichier.dossier_id && !dryRun) {
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

Deux situations possibles.

A. Le devis propose UNE seule offre. Trouve alors son MONTANT GLOBAL : la somme totale annoncée au client.
- Souvent sur l'une des dernières pages, sous un titre comme « Étude financière », « Récapitulatif » ou « Conditions ». Il est fréquemment écrit au fil du texte : « le montant est de : … € ttc », « votre étude financière se base sur un montant de … », « soit un total de … ». Le libellé « TOTAL » peut être absent.
- Si le document énonce un montant d'ensemble, RETIENS-LE même s'il diffère de la somme des postes : le montant annoncé engage le fournisseur, ne le recalcule pas.
- Seulement si AUCUN montant d'ensemble n'est énoncé et que le document chiffre les postes d'un même projet, additionne-les et mets somme_calculee à true.

B. Le devis propose PLUSIEURS offres, scénarios ou études financières ALTERNATIFS entre lesquels le client doit choisir (deux gammes d'appareils, plusieurs configurations, plusieurs montages financiers…). Ne choisis pas, n'additionne JAMAIS : liste chaque offre dans "offres", une entrée par alternative, avec un libellé court qui permet de les distinguer d'un coup d'œil (marque / modèle / formule, 60 caractères au plus) et son montant TTC. Dans ce cas montant_ttc et montant_ht restent null.
Des postes optionnels ajoutés à une offre de base ne sont pas des offres alternatives : ils ne forment pas de variante.

À écarter dans tous les cas : un sous-total, le prix d'une ligne, un acompte, une mensualité de financement, une valeur de reprise, une remise, et le capital social du fournisseur en pied de page.

HT ou TTC : si le document ne permet pas de dire avec certitude si un montant est HT ou TTC, ou si deux montants d'ensemble se contredisent, mets incertitude_ht_ttc à true, laisse montant_ttc à null, renvoie le ou les montants candidats dans "offres" (libellé précisant « HT ou TTC ? » et la page) et explique dans doute.

Si le document n'est pas un devis (facture, plan, cahier des charges, courrier seul, documentation technique sans prix), renvoie devis: false.

Réponds UNIQUEMENT par un objet JSON, sans texte autour et sans balises markdown :
- devis: true ou false
- montant_ttc: montant global TTC en nombre (point décimal, sans symbole ni espace), ou null
- montant_ht: montant global HT en nombre, ou null
- offres: tableau d'objets {"libelle": texte, "montant_ttc": nombre} (situation B ou incertitude HT/TTC), sinon []
- incertitude_ht_ttc: true ou false
- somme_calculee: true si tu as dû additionner faute de montant annoncé, sinon false
- extrait: la phrase exacte du document d'où vient le montant, recopiée mot pour mot, 200 caractères au plus, ou null
- page: numéro de page, ou null
- reference: référence ou numéro du devis, ou null
- date_devis: date du devis au format YYYY-MM-DD, ou null
- doute: OBLIGATOIRE si aucun montant n'est retenu et qu'il n'y a pas d'offres — explique en une phrase (300 caractères au plus) ce que tu as cherché ; OBLIGATOIRE aussi si incertitude_ht_ttc est true. Sinon mentionne toute ambiguïté, ou null.

Un montant faux alimenterait un suivi de chiffre d'affaires : dans le doute, ne retiens rien et explique-toi dans doute.`

  const reponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cle,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 3000,
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
      analyse_erreur: "Ce document ne ressemble pas à un devis : si c'est un cahier des charges ou un plan, changez son type.",
    }).eq('id', fichierId)
    return json({ devis: false })
  }

  const ttc = nombre(lu.montant_ttc)
  const ht = nombre(lu.montant_ht)
  const incertain = lu.incertitude_ht_ttc === true

  const offres = (Array.isArray(lu.offres) ? lu.offres : [])
    .map((o: any) => ({
      libelle: String(o?.libelle ?? '').trim().slice(0, 80) || 'Offre',
      montant_ttc: nombre(o?.montant_ttc),
    }))
    .filter((o: { montant_ttc: number | null }) => o.montant_ttc !== null)

  if (dryRun) {
    return json({
      dryRun: true,
      montant_ttc: ttc,
      montant_ht: ht,
      offres,
      incertitude_ht_ttc: incertain,
      reference: lu.reference ?? null,
      extrait: lu.extrait ?? null,
      page: lu.page ?? null,
      doute: lu.doute ?? null,
    })
  }

  const maintenant = new Date().toISOString()
  const commun = {
    reference_devis: lu.reference ?? null,
    date_devis: lu.date_devis ?? null,
    analyse_at: maintenant,
  }

  // Plusieurs offres exclusives, ou un montant dont la nature (HT/TTC) n'est
  // pas sûre : rien n'est écrit dans montant_ttc, Bruce tranche.
  if ((offres.length >= 2 || incertain) && ttc === null) {
    // Relire le devis ne doit pas défaire un choix déjà fait (une offre, ou un
    // cumul d'offres) : si les offres lues sont identiques à celles déjà
    // enregistrées, le choix, le montant et le HT restent tels quels.
    const memesOffres =
      fichier.montant_ttc !== null &&
      fichier.variante_retenue !== null &&
      Array.isArray(fichier.variantes) &&
      fichier.variantes.length === offres.length &&
      fichier.variantes.every((o: { montant_ttc: unknown }, k: number) => Number(o.montant_ttc) === offres[k].montant_ttc)

    const { error } = await db.from('fichiers').update({
      ...commun,
      variantes: offres.length > 0 ? offres : null,
      ...(memesOffres
        ? {}
        : { montant_ht: ht, montant_ttc: null, variante_retenue: null, variantes_retenues: null }),
      a_trancher_raison: incertain
        ? (lu.doute ?? 'Montant HT ou TTC incertain.')
        : null,
      analyse_erreur: null,
    }).eq('id', fichierId)
    if (error) return json({ erreur: error.message }, 500)

    return json({
      devis: true,
      a_trancher: true,
      variantes: offres,
      incertitude_ht_ttc: incertain,
      doute: lu.doute ?? null,
    })
  }

  const { error } = await db.from('fichiers').update({
    ...commun,
    montant_ttc: ttc,
    montant_ht: ht,
    variantes: null,
    variante_retenue: null,
    variantes_retenues: null,
    a_trancher_raison: null,
    analyse_erreur: ttc === null ? (lu.doute ?? 'Total TTC introuvable dans ce PDF.') : null,
  }).eq('id', fichierId)
  if (error) return json({ erreur: error.message }, 500)

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
        `Montant lu dans « ${fichier.nom} » : ${eur(ttc)} € TTC` +
        (lu.reference ? ` (devis ${lu.reference})` : '') +
        `. Montant du dossier porté à ${eur(dossier?.montant_estime ?? ttc)} € TTC.` +
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
