import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { mettreEnFile } from '../lib/fileAttente'
import { envoyerFichier, fichierColle } from '../lib/fichiers'
import TexteModifiable from './TexteModifiable'
import useConfirm from '../hooks/useConfirm'
import Rubrique from './Rubrique'
import { ajouterRappel } from '../lib/rappel'
import {
  TYPES_DOC,
  aTrancher,
  cdcEnVigueur,
  champsRemiseATrancher,
  champsRetenue,
  champsRetenueHt,
  champsCumul,
  champsDecision,
  champsDecisionActuels,
  decisionDe,
  DECISIONS,
  DECISIONS_LIBELLES,
  groupeDevis,
  parserReference,
  proposerRemplacement,
  retenuesDe,
  ttcOffre,
  ttcDepuisHt,
  estDevis,
  fourchette,
  libellePastille,
  typeParNom,
  variantesDe,
} from '../lib/documents'

const eur = (n) => new Intl.NumberFormat('fr-FR').format(n)

const lisible = (o) => {
  if (o == null) return ''
  if (o < 1024) return `${o} o`
  if (o < 1024 * 1024) return `${Math.round(o / 1024)} Ko`
  return `${(o / (1024 * 1024)).toFixed(1)} Mo`
}

const estPdf = (t) => t === 'application/pdf'

/**
 * Reconnaît la nomenclature des devis : NOM_PRODUIT_RÉFÉRENCE, où la référence
 * fait neuf chiffres suivis d'une lettre de révision facultative.
 *
 * Ces noms-là sont ceux que Bruce a établis sur son Mac, et c'est eux qui ont
 * permis de repérer les révisions B et C à l'import. On ne propose donc pas de
 * les changer : le renommage ne sert que pour un scan d'imprimante ou une photo
 * de téléphone, dont le nom ne dit rien.
 */
const suitLaNomenclature = (nom) => /_\d{9}[A-Za-z]?\.[a-z0-9]+$/i.test(nom ?? '')

/**
 * Pièces jointes d'un client ou d'un dossier. Le dépôt est privé : on ne stocke
 * jamais d'URL publique, on demande un lien signé au moment de l'ouverture.
 * Passer exactement un des deux : clientId ou dossierId.
 */
export default function PiecesJointes({ clientId, dossierId, onMontantChange }) {
  const colonne = clientId ? 'client_id' : 'dossier_id'
  const valeur = clientId ?? dossierId

  const [liste, setListe] = useState([])
  const [envoi, setEnvoi] = useState(false)
  // Identifiants des PDF en cours de lecture, pour n'afficher l'attente que
  // sur la ligne concernée.
  const [analyse, setAnalyse] = useState(() => new Set())
  const [renommage, setRenommage] = useState(null)
  // Fichier dont le panneau « Changer le type » est ouvert, et la version de
  // cahier des charges en cours de saisie dans ce panneau.
  const [typage, setTypage] = useState(null)
  const [versionSaisie, setVersionSaisie] = useState('')
  // Offre touchée sur un devis au HT/TTC douteux : { id, i, base } où base est
  // null (question posée) ou 'ht' (calcul affiché, en attente de confirmation).
  const [choixHt, setChoixHt] = useState(null)
  // Cumul de plusieurs offres d'un même devis : { id, choix: { [indice]: 'ttc' | 'ht' | null } }.
  // Une offre absente de `choix` n'est pas cochée ; null = cochée, base HT/TTC à préciser.
  const [cumul, setCumul] = useState(null)
  // Dernière décision prise, annulable d'un tap pendant quelques secondes :
  // { libelle, avant: [{ id, champs }] } (champs = valeurs d'avant les décisions).
  const [annulable, setAnnulable] = useState(null)
  const minuteurAnnulation = useRef(null)
  // « Mis de côté » en cours de saisie : { id, date } (date de reprise facultative).
  const [report, setReport] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [confirmer, boîteConfirmation] = useConfirm()
  const champFichier = useRef(null)
  const champCollage = useRef(null)

  useEffect(() => {
    let actif = true

    supabase
      .from('fichiers')
      .select('*')
      .eq(colonne, valeur)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (actif && !error) setListe(data ?? [])
      })
      .catch(() => {})

    const canal = supabase
      .channel(`fichiers-${colonne}-${valeur}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fichiers', filter: `${colonne}=eq.${valeur}` },
        (p) => {
          setListe((cur) => {
            if (p.eventType === 'INSERT') {
              return cur.some((f) => f.id === p.new.id) ? cur : [p.new, ...cur]
            }
            // L'analyse d'un devis remplit le montant par une mise à jour :
            // sans ce cas, le chiffre n'apparaîtrait qu'au rechargement.
            if (p.eventType === 'UPDATE') return cur.map((f) => (f.id === p.new.id ? p.new : f))
            if (p.eventType === 'DELETE') return cur.filter((f) => f.id !== p.old.id)
            return cur
          })
        }
      )
      .subscribe()

    return () => {
      actif = false
      supabase.removeChannel(canal)
    }
  }, [colonne, valeur])

  // Chemin commun au sélecteur de fichiers et au collage (ci-dessous) :
  // même envoi, même suivi d'état, seule la provenance du fichier diffère.
  const envoyerEtSuivre = async (fichier) => {
    setEnvoi(true)
    setErreur(null)
    const { ligne, erreur: err } = await envoyerFichier({ clientId, dossierId, fichier })
    setEnvoi(false)
    if (err) {
      setErreur(err)
      return
    }
    // Un devis déposé sur un dossier se lit tout de suite : c'est le moment où
    // le chiffre est utile, et le seul où l'on pense à le vérifier.
    if (ligne && estDevis(ligne) && estPdf(fichier.type || null)) lireDevis(ligne)
  }

  const envoyer = async (e) => {
    const fichier = e.target.files?.[0]
    e.target.value = '' // permet de re-choisir le même fichier après une erreur
    if (!fichier) return
    await envoyerEtSuivre(fichier)
  }

  // Collage (Cmd+V sur Mac, geste « Coller » natif sur iPhone) — voir
  // PASSATION.md pour les limites de compatibilité constatées (fiable pour
  // une image copiée/capture d'écran sur les deux plateformes ; un fichier
  // générique copié dans le Finder ne fonctionne de façon fiable que sur
  // Mac, limitation de la plateforme iOS, pas de ce code).
  const collerFichier = async (e) => {
    const fichier = fichierColle(e)
    // Toujours empêché : ce champ ne sert qu'à recevoir un collage de
    // fichier, jamais à en garder le texte (image insérée par défaut par le
    // navigateur, ou tout autre texte collé par erreur).
    e.preventDefault()
    if (champCollage.current) champCollage.current.value = ''
    if (!fichier) return
    await envoyerEtSuivre(fichier)
  }

  // Lecture du total TTC d'un devis. Réservée aux PDF d'un dossier : sur une
  // fiche client, un PDF n'appartient à aucun chiffrage.
  const lireDevis = async (fichier) => {
    if (!dossierId || !estPdf(fichier.type_mime) || !estDevis(fichier)) return
    setAnalyse((cur) => new Set(cur).add(fichier.id))
    const { error: err } = await supabase.functions.invoke('devis-montant-v2', {
      body: { fichierId: fichier.id },
    })
    setAnalyse((cur) => {
      const suite = new Set(cur)
      suite.delete(fichier.id)
      return suite
    })
    if (err) setErreur('Lecture du devis impossible.')
    // Le montant du dossier est recalculé en base : l'écran doit aller le relire.
    else onMontantChange?.()
  }

  // Écriture d'un ou plusieurs champs d'un fichier : appliquée tout de suite à
  // l'écran (hors-ligne, aucun événement temps réel ne reviendra), puis envoyée ;
  // en cas d'échec — réseau coupé en pratique — elle part en file d'attente et
  // sera rejouée au retour du réseau, jamais perdue.
  const ecrire = async (f, champs) => {
    setListe((cur) => cur.map((x) => (x.id === f.id ? { ...x, ...champs } : x)))
    const { error } = await supabase.from('fichiers').update(champs).eq('id', f.id)
    if (error) mettreEnFile({ type: 'update', table: 'fichiers', rowId: f.id, champs })
    onMontantChange?.()
  }

  // Pour un devis que le modèle refuse de trancher seul : le choix reste entre
  // Bruce et le client, la saisie doit rester manuelle.
  const saisirMontant = async (f, saisie) => {
    const nombre = saisie == null ? null : Number(String(saisie).replace(',', '.').replace(/\s/g, ''))
    if (saisie != null && (Number.isNaN(nombre) || nombre < 0)) {
      setErreur('Montant invalide.')
      return
    }
    // Un montant saisi à la main est un geste délibéré : le devis est retenu.
    await ecrire(f, { montant_ttc: nombre, analyse_erreur: null, a_trancher_raison: null, ...(nombre != null ? champsDecision('retenu') : {}) })
  }

  // Un tap : l'offre retenue donne son montant au devis, donc au dossier.
  // Si le devis laisse un doute HT/TTC, on pose d'abord la question.
  const toucherOffre = (f, i) => {
    if (f.a_trancher_raison) setChoixHt({ id: f.id, i, base: null })
    else retenir(f, i)
  }

  const retenir = async (f, i, enHt = false) => {
    const champs = enHt ? champsRetenueHt(f, i) : champsRetenue(f, i)
    if (!champs) return
    setChoixHt(null)
    await ecrire(f, champs)
    const v = variantesDe(f)[i]
    const note = {
      dossier_id: dossierId,
      texte: enHt
        ? `Offre retenue dans « ${f.nom} » : ${v.libelle} — ${eur(v.montant_ttc)} € HT, soit ${eur(champs.montant_ttc)} € TTC (TVA 20 %).`
        : `Offre retenue dans « ${f.nom} » : ${v.libelle} — ${eur(v.montant_ttc)} € TTC.`,
    }
    const { error } = await supabase.from('dossier_notes').insert(note)
    if (error) mettreEnFile({ type: 'insert', table: 'dossier_notes', payload: note })
  }

  const ouvrirCumul = (f) => {
    setChoixHt(null)
    setCumul({ id: f.id, choix: {} })
  }

  const basculerOffreCumul = (f, i) =>
    setCumul((cur) => {
      const choix = { ...cur.choix }
      if (i in choix) delete choix[i]
      // Sans doute HT/TTC sur ce devis, la base est TTC d'office ; sinon elle reste à préciser.
      else choix[i] = f.a_trancher_raison ? null : 'ttc'
      return { ...cur, choix }
    })

  const choisirBaseCumul = (i, base) => setCumul((cur) => ({ ...cur, choix: { ...cur.choix, [i]: base } }))

  const selectionCumul = () =>
    Object.entries(cumul?.choix ?? {}).map(([i, base]) => ({ i: Number(i), base }))

  // Valide le cumul : le montant du devis est la somme des offres cochées. Écriture
  // absolue (mêmes valeurs si elle est rejouée) : jamais de doublon au rejeu.
  const validerCumul = async (f) => {
    const choix = selectionCumul()
    const champs = champsCumul(f, choix)
    if (!champs) return
    setCumul(null)
    await ecrire(f, champs)
    const offres = variantesDe(f)
    const detail = [...choix]
      .sort((a, b) => a.i - b.i)
      .map(({ i, base }) =>
        base === 'ht'
          ? `${offres[i].libelle} (${eur(offres[i].montant_ttc)} € HT, soit ${eur(ttcOffre(offres[i], 'ht'))} € TTC)`
          : `${offres[i].libelle} (${eur(offres[i].montant_ttc)} € TTC)`
      )
      .join(' + ')
    const note = {
      dossier_id: dossierId,
      texte: `Offres cumulées dans « ${f.nom} » : ${detail} — total ${eur(champs.montant_ttc)} € TTC.`,
    }
    const { error } = await supabase.from('dossier_notes').insert(note)
    if (error) mettreEnFile({ type: 'insert', table: 'dossier_notes', payload: note })
  }

  // Décisions ────────────────────────────────────────────────────────────────
  // Chaque changement est annulable : on retient les valeurs d'avant de toutes les
  // lignes touchées, et « Annuler » les réécrit (écritures absolues : rejouables
  // sans doublon par la file hors-ligne).
  const appliquerDecisions = async (changements, libelle) => {
    const avant = changements.map(({ f }) => ({ id: f.id, champs: champsDecisionActuels(f) }))
    for (const { f, champs } of changements) await ecrire(f, champs)
    clearTimeout(minuteurAnnulation.current)
    setAnnulable({ libelle, avant })
    minuteurAnnulation.current = setTimeout(() => setAnnulable(null), 8000)
  }

  const annulerDecision = async () => {
    if (!annulable) return
    const { avant } = annulable
    clearTimeout(minuteurAnnulation.current)
    setAnnulable(null)
    for (const { id, champs } of avant) {
      const f = liste.find((x) => x.id === id) ?? { id }
      await ecrire(f, champs)
    }
  }

  const devisDuDossier = liste.filter(estDevis)

  const choisirDecision = async (f, decision) => {
    setErreur(null)
    if (decisionDe(f) === decision) return
    if (decision === 'mis_de_cote') {
      setReport({ id: f.id, date: '' })
      return
    }
    if (decision === 'retenu') {
      if (variantesDe(f).length >= 2 && f.montant_ttc == null) {
        setErreur('Ce devis a plusieurs offres : retenez d’abord l’offre (ou le cumul) dans la liste sous le devis.')
        return
      }
      if (f.montant_ttc == null) {
        setErreur('Ce devis n’a pas de montant : lisez-le ou saisissez-le avant de le retenir.')
        return
      }
    }
    if (decision === 'remplace') {
      // Il remplace le devis retenu le plus récent du dossier (à défaut, aucun lien).
      const remplacant = devisDuDossier
        .filter((g) => g.id !== f.id && decisionDe(g) === 'retenu')
        .sort((a, b) => (b.date_devis ?? b.created_at).localeCompare(a.date_devis ?? a.created_at))[0]
      await appliquerDecisions([{ f, champs: champsDecision('remplace', { remplace_par: remplacant?.id ?? null }) }], `« ${f.nom} » : remplacé`)
      return
    }
    await appliquerDecisions([{ f, champs: champsDecision(decision) }], `« ${f.nom} » : ${DECISIONS_LIBELLES[decision].toLowerCase()}`)
  }

  const mettreDeCote = async (f) => {
    const date = report?.date || null
    setReport(null)
    await appliquerDecisions([{ f, champs: champsDecision('mis_de_cote', { date_reprise: date }) }], `« ${f.nom} » : mis de côté`)
    if (date) {
      // Le rappel de reprise : même chemin que tous les rappels ; hors-ligne, il part en file.
      const res = await ajouterRappel(dossierId, date, `Reprendre le devis ${parserReference(f.nom) ? f.nom.replace(/\.[^.]+$/, '') : f.nom}`, null)
      if (res?.erreur) {
        mettreEnFile({ type: 'insert', table: 'rappels', payload: { dossier_id: dossierId, date, note: `Reprendre le devis ${f.nom.replace(/\.[^.]+$/, '')}` } })
      }
    }
  }

  // Proposition de remplacement (jamais silencieuse) : « Ce devis remplace-t-il le précédent ? »
  const repondreRemplacement = async (f, precedent, reponse) => {
    if (reponse === 'alternative') {
      await appliquerDecisions([{ f, champs: champsDecision('alternative') }], `« ${f.nom} » : alternative à « ${precedent.nom} »`)
      return
    }
    if (f.montant_ttc == null) {
      setErreur('Ce devis n’a pas encore de montant : lisez-le ou retenez son offre d’abord.')
      return
    }
    const changements = [{ f, champs: champsDecision('retenu') }]
    if (reponse === 'remplace') changements.push({ f: precedent, champs: champsDecision('remplace', { remplace_par: f.id }) })
    await appliquerDecisions(changements, reponse === 'remplace' ? `« ${f.nom} » remplace « ${precedent.nom} »` : `« ${f.nom} » cumulé avec « ${precedent.nom} »`)
  }

  const remettreATrancher = (f) => ecrire(f, champsRemiseATrancher())

  const ouvrirTypage = (f) => {
    setVersionSaisie(f.version_doc != null ? String(f.version_doc) : '')
    setTypage(f.id)
  }

  const majVersion = async (f) => {
    const v = versionSaisie.trim()
    if (!/^\d+$/.test(v) || Number(v) === f.version_doc) return
    await ecrire(f, { version_doc: Number(v) })
  }

  const changerType = async (f, type) => {
    if (type === f.type_doc) {
      setTypage(null)
      return
    }
    // Sortir un devis chiffré de la catégorie « devis » retire son montant du
    // dossier : ce n'est pas anodin, on le nomme avant de le faire.
    if (estDevis(f) && type !== 'devis' && f.montant_ttc != null) {
      const ok = await confirmer(
        `« ${f.nom} » porte ${eur(f.montant_ttc)} € TTC, qui ne compteront plus dans le montant du dossier.`,
        { titre: 'Ce document n’est plus un devis ?', confirmLabel: 'Changer le type' }
      )
      if (!ok) return
    }
    // La version d'un cahier des charges se lit dans son nom (« _V3 ») ; elle
    // se corrige ensuite à la main si le nom ne la porte pas.
    const version = type === 'cdc' ? typeParNom(f.nom).version_doc : null
    const champs = { type_doc: type, version_doc: version }
    if (type !== 'devis') {
      // Un cahier des charges ou un plan n'a rien à chiffrer : le montant et
      // l'ancienne « erreur d'analyse » n'ont plus de sens ici.
      Object.assign(champs, { montant_ttc: null, variante_retenue: null, a_trancher_raison: null, analyse_erreur: null })
    }
    setTypage(null)
    await ecrire(f, champs)
    // Devenu devis : on le lit tout de suite, comme à l'upload.
    if (type === 'devis' && dossierId && estPdf(f.type_mime)) lireDevis({ ...f, ...champs })
  }

  const ouvrir = async (f) => {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(f.chemin, 60)
    if (error) {
      setErreur(error.message)
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const supprimer = async (f) => {
    if (
      !(await confirmer(`« ${f.nom} » sera supprimée. Cette action est irréversible.`, {
        titre: 'Supprimer définitivement cette pièce jointe ?',
        confirmLabel: 'Supprimer',
      }))
    ) {
      return
    }
    await supabase.storage.from('documents').remove([f.chemin])
    const { error } = await supabase.from('fichiers').delete().eq('id', f.id)
    if (error) mettreEnFile({ type: 'delete', table: 'fichiers', rowId: f.id })
    // Retrait immédiat : ne pas faire attendre l'aller-retour temps réel pour
    // voir disparaître ce qu'on vient de supprimer soi-même.
    setListe((cur) => cur.filter((x) => x.id !== f.id))
  }

  const nbATrancher = liste.filter(aTrancher).length
  // Devis actifs d'abord, puis « Reportés » (mis de côté), puis remplacés (grisés) ;
  // les autres documents suivent. Dans chaque groupe, l'ordre d'origine (récents d'abord).
  const ordreGroupe = { actifs: 0, reportes: 1, remplaces: 2 }
  const listeAffichee = dossierId
    ? [...liste].sort((a, b) => {
        const ga = estDevis(a) ? ordreGroupe[groupeDevis(a)] : 3
        const gb = estDevis(b) ? ordreGroupe[groupeDevis(b)] : 3
        return ga - gb
      })
    : liste
  const cdcVigueur = cdcEnVigueur(liste)
  const devisListe = liste.filter(estDevis)
  const plans = liste.filter((f) => f.type_doc === 'plan')
  const jour = (f) => (f ? new Date(f.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : null)

  return (
    <>
      {/* Hors de la Rubrique : le champ doit rester monté pour que le bouton
          + Ajouter, visible même repliée, puisse encore le déclencher. */}
      <input
        ref={champFichier}
        type="file"
        accept="application/pdf,image/*"
        onChange={envoyer}
        className="hidden"
      />
      <Rubrique
        titre={dossierId ? 'Documents déposés' : 'Pièces jointes'}
        compte={liste.length}
        forceOuvert={envoi || nbATrancher > 0}
        action={
          <button
            onClick={() => champFichier.current?.click()}
            disabled={envoi}
            className="text-accent text-sm font-medium h-11 px-2 -mr-2 inline-flex items-center disabled:opacity-50"
          >
            {envoi ? 'Envoi…' : '+ Ajouter'}
          </button>
        }
      >
      {erreur && <p className="text-erreur text-sm mb-2 px-1">{erreur}</p>}

      {/* Les trois jalons documentaires d'un dossier, dans l'ordre où ils
          arrivent : le cahier des charges cadre, le devis chiffre, le plan
          matérialise. Le plus récent de chaque famille suffit ici. */}
      {dossierId && liste.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-2" aria-label="Jalons du dossier">
          {[
            {
              cle: 'cdc',
              titre: 'Cahier des charges',
              valeur: cdcVigueur ? libellePastille(cdcVigueur) : null,
              detail: jour(cdcVigueur),
            },
            {
              cle: 'devis',
              titre: 'Devis',
              valeur: devisListe.length
                ? nbATrancher > 0
                  ? `${nbATrancher} à trancher`
                  : `${devisListe.length} devis`
                : null,
              detail: jour(devisListe[0]),
              alerte: nbATrancher > 0,
            },
            {
              cle: 'plan',
              titre: 'Plan',
              valeur: plans.length ? `${plans.length} plan${plans.length > 1 ? 's' : ''}` : null,
              detail: jour(plans[0]),
            },
          ].map((j) => (
            <div
              key={j.cle}
              className={`rounded-xl px-3 py-2 border ${
                j.valeur ? 'bg-carte border-separateur' : 'border-dashed border-separateur'
              }`}
            >
              <p className="text-[11px] text-texte-faible leading-tight">{j.titre}</p>
              <p
                className={`text-sm font-medium leading-snug mt-0.5 ${
                  j.alerte ? 'text-alerte' : j.valeur ? 'text-texte' : 'text-texte-fantome'
                }`}
              >
                {j.valeur ?? 'Aucun'}
              </p>
              {j.detail && <p className="text-[11px] text-texte-faible tabular-nums">{j.detail}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Ligne de temps des devis du dossier : numéro, date, montant, décision. */}
      {dossierId && devisDuDossier.length > 0 && (
        <div className="mb-2 bg-carte rounded-xl px-4 py-3" aria-label="Ligne de temps des devis">
          <p className="text-xs text-texte-faible mb-2">Ligne de temps des devis</p>
          <ol className="space-y-1.5">
            {[...devisDuDossier]
              .sort((a, b) => (a.date_devis ?? a.created_at).localeCompare(b.date_devis ?? b.created_at))
              .map((f) => {
                const ref = parserReference(f.nom)
                const d = decisionDe(f)
                return (
                  <li key={f.id} className={`flex items-baseline gap-2 text-xs tabular-nums ${d === 'remplace' ? 'opacity-60' : ''}`}>
                    <span className="text-texte w-24 truncate flex-shrink-0">
                      {ref ? `n° ${ref.numero}${ref.revision}` : f.reference_devis ? `n° ${f.reference_devis}` : '—'}
                    </span>
                    <span className="text-texte-faible flex-shrink-0">
                      {new Date(f.date_devis ? f.date_devis + 'T00:00:00' : f.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="text-texte flex-1 text-right">
                      {f.montant_ttc != null ? `${eur(f.montant_ttc)} €` : variantesDe(f).length >= 2 ? 'offres' : '—'}
                    </span>
                    <span className={`flex-shrink-0 w-20 text-right ${d === 'retenu' ? 'text-accent-vif' : d === 'a_trancher' ? 'text-alerte' : 'text-texte-doux'}`}>
                      {DECISIONS_LIBELLES[d]}
                    </span>
                  </li>
                )
              })}
          </ol>
        </div>
      )}

      {/* Champ toujours vide, jamais destiné à être lu : son seul rôle est
          d'être une cible focusable pour Cmd+V (Mac) ou le geste « Coller »
          natif d'iOS (appui long → Coller, ou la suggestion au-dessus du
          clavier). Un texte collé sans fichier est ignoré silencieusement
          (voir collerFichier) plutôt que de s'accumuler ici. */}
      <input
        ref={champCollage}
        type="text"
        defaultValue=""
        onPaste={collerFichier}
        placeholder="Coller une image ici (Cmd+V, ou Coller sur iPhone)"
        className="w-full text-sm text-texte-faible placeholder:text-texte-faible bg-fond border border-dashed border-separateur rounded-imbrique px-3 py-2.5 mb-2 outline-none focus:border-accent"
      />

      {liste.length === 0 ? (
        <p className="text-texte-faible text-sm px-1">Aucun document.</p>
      ) : (
        <ul className="space-y-2">
          {listeAffichee.map((f, idx) => {
            const offres = variantesDe(f)
            const decision = decisionDe(f)
            const groupe = dossierId && estDevis(f) ? groupeDevis(f) : 'autres'
            const precedentGroupe = idx > 0 && dossierId && estDevis(listeAffichee[idx - 1]) ? groupeDevis(listeAffichee[idx - 1]) : null
            const enTete = dossierId && groupe === 'reportes' && precedentGroupe !== 'reportes'
            const proposition = dossierId ? proposerRemplacement(liste, f) : null
            const range = fourchette(f)
            const doitTrancher = aTrancher(f)
            const retenues = retenuesDe(f).map((i) => offres[i]).filter(Boolean)
            const retenue = retenues.length > 0 ? retenues : null
            return (
            <React.Fragment key={f.id}>
            {enTete && (
              <li className="px-1 pt-2 text-xs text-texte-faible uppercase tracking-wider list-none">
                Reportés · {listeAffichee.filter((g) => estDevis(g) && groupeDevis(g) === 'reportes').length}
              </li>
            )}
            <li className={`bg-carte rounded-xl shadow-sm ${groupe === 'remplaces' ? 'opacity-60' : ''}`}>
              <div className="px-4 py-3 flex items-center gap-3">
              <span className="text-lg flex-shrink-0" aria-hidden="true">
                {estPdf(f.type_mime) ? '📄' : '🖼️'}
              </span>
              <div className="flex-1 min-w-0">
              {renommage === f.id ? (
                <TexteModifiable
                  valeur={f.nom}
                  ouvertParDefaut
                  className="text-texte"
                  onFermer={() => setRenommage(null)}
                  onEnregistrer={async (v) => {
                    if (!v) return
                    const { error } = await supabase.from('fichiers').update({ nom: v }).eq('id', f.id)
                    if (error) mettreEnFile({ type: 'update', table: 'fichiers', rowId: f.id, champs: { nom: v } })
                  }}
                />
              ) : (
                <button onClick={() => ouvrir(f)} className="w-full min-w-0 min-h-11 text-left">
                <p className="text-texte truncate">{f.nom}</p>
                <p className="text-xs text-texte-faible">
                  {[lisible(f.taille), new Date(f.created_at).toLocaleDateString('fr-FR')]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {f.montant_ttc != null && estDevis(f) && (
                  <p className="text-sm text-texte font-medium mt-0.5 tabular-nums">
                    {eur(f.montant_ttc)} € TTC
                    {f.reference_devis ? (
                      <span className="text-xs text-texte-faible font-normal">
                        {' '}· devis {f.reference_devis}
                      </span>
                    ) : null}
                  </p>
                )}
                {doitTrancher && range && (
                  <p className="text-sm text-alerte font-medium mt-0.5 tabular-nums">
                    À trancher · {range.min === range.max ? eur(range.min) : `${eur(range.min)} – ${eur(range.max)}`} € TTC
                  </p>
                )}
                {analyse.has(f.id) && (
                  <p className="text-xs text-texte-faible mt-0.5">Lecture du devis…</p>
                )}
                {!analyse.has(f.id) && estDevis(f) && f.analyse_erreur && (
                  <p className="text-xs text-alerte mt-0.5">{f.analyse_erreur}</p>
                )}
                </button>
              )}
              {dossierId && renommage !== f.id && (
                <div className="flex items-center gap-1 -ml-1">
                  <button
                    onClick={() => (typage === f.id ? setTypage(null) : ouvrirTypage(f))}
                    aria-label={`Type de ${f.nom} : ${libellePastille(f)}. Changer le type`}
                    aria-expanded={typage === f.id}
                    className="h-11 px-1 inline-flex items-center"
                  >
                    <span
                      className={`text-[11px] font-medium rounded-full px-2.5 py-1 leading-none ${
                        f.type_doc === 'devis'
                          ? 'bg-accent/15 text-accent'
                          : f.type_doc === 'autre'
                            ? 'bg-fond text-texte-faible border border-separateur'
                            : 'bg-texte/10 text-texte'
                      }`}
                    >
                      {libellePastille(f)} ▾
                    </span>
                  </button>
                  {cdcVigueur?.id === f.id && liste.filter((x) => x.type_doc === 'cdc').length > 1 && (
                    <span className="text-[11px] text-texte-doux">en vigueur</span>
                  )}
                </div>
              )}
              {estDevis(f) && f.montant_ttc == null && !doitTrancher && dossierId && estPdf(f.type_mime) && renommage !== f.id && (
                <div onClick={(e) => e.stopPropagation()} className="mt-0.5">
                  <TexteModifiable
                    valeur={null}
                    type="number"
                    placeholder="Montant TTC en €"
                    vide="Saisir un montant à la main"
                    className="text-sm text-accent font-medium"
                    onEnregistrer={(v) => saisirMontant(f, v)}
                  />
                </div>
              )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <button
                  onClick={() => supprimer(f)}
                  aria-label={`Supprimer ${f.nom}`}
                  className="text-texte-fantome text-lg leading-none w-11 h-11 flex items-center justify-center -mr-3"
                >
                  ×
                </button>
                {/* Seulement sur un nom qui ne dit rien : scan d'imprimante,
                    photo de téléphone. Un devis nommé selon la nomenclature
                    n'a pas à être renommé, et le bouton ne s'affiche pas. */}
                {renommage !== f.id && !suitLaNomenclature(f.nom) && (
                  <button
                    onClick={() => setRenommage(f.id)}
                    className="text-texte-fantome text-[11px] h-11 px-2 -mr-2 flex items-center"
                  >
                    Renommer
                  </button>
                )}
                {dossierId && estDevis(f) && estPdf(f.type_mime) && !analyse.has(f.id) && (
                  <button
                    onClick={() => lireDevis(f)}
                    className="text-accent text-[11px] font-medium h-11 px-2 -mr-2 flex items-center"
                  >
                    {f.analyse_at ? 'Relire' : 'Lire le devis'}
                  </button>
                )}
              </div>
              </div>

              {dossierId && estDevis(f) && renommage !== f.id && (
                <div className="px-4 pb-2 -mt-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-texte-faible">
                      Décision : <span className={decision === 'a_trancher' ? 'text-alerte' : 'text-texte'}>{DECISIONS_LIBELLES[decision]}</span>
                      {decision === 'remplace' && f.decision_le && ` le ${new Date(f.decision_le).toLocaleDateString('fr-FR')}`}
                      {decision === 'mis_de_cote' && f.date_reprise && ` · reprise le ${new Date(f.date_reprise + 'T00:00:00').toLocaleDateString('fr-FR')}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1" role="group" aria-label={`Décision pour ${f.nom}`}>
                    {DECISIONS.map(([cle, libelle]) => (
                      <button
                        key={cle}
                        onClick={() => choisirDecision(f, cle)}
                        aria-pressed={decision === cle}
                        className={`min-h-11 px-1 rounded-imbrique text-[12px] font-medium leading-tight border ${
                          decision === cle ? 'bg-accent text-white border-accent' : 'bg-fond text-texte-doux border-separateur'
                        }`}
                      >
                        {libelle}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {report?.id === f.id && (
                <div className="px-4 pb-3">
                  <p className="text-xs text-texte-faible mb-1.5">Date de reprise (facultative) — crée un rappel</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      aria-label="Date de reprise"
                      value={report.date}
                      onChange={(e) => setReport({ ...report, date: e.target.value })}
                      className="h-11 px-3 bg-fond border border-separateur rounded-imbrique text-texte"
                    />
                    <button onClick={() => mettreDeCote(f)} className="h-11 px-4 rounded-full text-sm bg-accent text-white">
                      Mettre de côté
                    </button>
                    <button onClick={() => setReport(null)} className="h-11 px-2 text-sm text-texte-doux">
                      Annuler
                    </button>
                  </div>
                </div>
              )}

              {proposition && (
                <div className="mx-4 mb-3 rounded-imbrique border border-alerte/40 bg-alerte/10 px-3 py-3" role="group" aria-label="Remplacement ?">
                  <p className="text-sm text-texte">
                    Ce devis remplace-t-il le précédent ? <span className="text-texte-doux">
                      {proposition.nom.replace(/\.[^.]+$/, '')}{proposition.montant_ttc != null ? ` · ${eur(proposition.montant_ttc)} €` : ''}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button onClick={() => repondreRemplacement(f, proposition, 'remplace')} className="min-h-11 px-4 rounded-full text-sm bg-accent text-white">Oui</button>
                    <button onClick={() => repondreRemplacement(f, proposition, 'alternative')} className="min-h-11 px-4 rounded-full text-sm bg-fond text-texte border border-separateur">Non, alternative</button>
                    <button onClick={() => repondreRemplacement(f, proposition, 'cumul')} className="min-h-11 px-4 rounded-full text-sm bg-fond text-texte border border-separateur">Non, cumul</button>
                  </div>
                </div>
              )}

              {typage === f.id && (
                <div className="px-4 pb-3 -mt-1">
                  <p className="text-xs text-texte-faible mb-1.5">Type de document</p>
                  <div className="flex flex-wrap gap-2">
                    {TYPES_DOC.map(([valeur, libelle]) => (
                      <button
                        key={valeur}
                        onClick={() => changerType(f, valeur)}
                        aria-pressed={f.type_doc === valeur}
                        className={`h-11 px-4 rounded-full text-sm border ${
                          f.type_doc === valeur
                            ? 'bg-accent text-white border-accent'
                            : 'bg-fond text-texte border-separateur'
                        }`}
                      >
                        {libelle}
                      </button>
                    ))}
                  </div>
                  {f.type_doc === 'cdc' && (
                    <label className="flex items-center gap-2 mt-2 text-xs text-texte-doux">
                      Version du cahier des charges
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        value={versionSaisie}
                        onChange={(e) => setVersionSaisie(e.target.value)}
                        onBlur={() => majVersion(f)}
                        className="w-16 h-11 text-center bg-fond border border-separateur rounded-imbrique text-texte"
                      />
                    </label>
                  )}
                </div>
              )}

              {doitTrancher && (
                <div className="px-4 pb-3 -mt-1">
                  {f.a_trancher_raison && (
                    <p className="text-xs text-alerte mb-2">{f.a_trancher_raison}</p>
                  )}
                  {offres.length > 0 ? (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-xs text-texte-faible">
                          {cumul?.id === f.id
                            ? 'Cochez les offres à cumuler : leur somme devient le montant du devis'
                            : "Offres exclusives — retenez celle du client, ou cumulez-en plusieurs"}
                        </p>
                        {offres.length > 1 && (
                          <button
                            onClick={() => (cumul?.id === f.id ? setCumul(null) : ouvrirCumul(f))}
                            className="flex-shrink-0 h-11 px-2 -mr-2 text-xs font-medium text-accent"
                          >
                            {cumul?.id === f.id ? 'Annuler' : 'Cumuler'}
                          </button>
                        )}
                      </div>
                      {cumul?.id === f.id ? (
                        <>
                          <ul className="space-y-1.5">
                            {offres.map((v, i) => {
                              const coche = i in cumul.choix
                              const base = cumul.choix[i]
                              return (
                                <li key={i}>
                                  <button
                                    role="checkbox"
                                    aria-checked={coche}
                                    onClick={() => basculerOffreCumul(f, i)}
                                    className={`w-full min-h-11 px-3 py-2 rounded-imbrique border flex items-center gap-3 text-left ${
                                      coche ? 'border-accent bg-accent/10' : 'border-separateur bg-fond'
                                    }`}
                                  >
                                    <span
                                      aria-hidden="true"
                                      className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center text-[11px] ${
                                        coche ? 'bg-accent border-accent text-white' : 'border-separateur'
                                      }`}
                                    >
                                      {coche ? '✓' : ''}
                                    </span>
                                    <span className="text-sm text-texte min-w-0 flex-1">{v.libelle}</span>
                                    <span className="text-sm text-texte font-medium tabular-nums flex-shrink-0">
                                      {eur(v.montant_ttc)} €
                                    </span>
                                  </button>
                                  {coche && f.a_trancher_raison && (
                                    <div className="flex items-center gap-2 mt-1 pl-1">
                                      <span className="text-xs text-texte-doux">Ce montant est</span>
                                      {['ht', 'ttc'].map((b) => (
                                        <button
                                          key={b}
                                          onClick={() => choisirBaseCumul(i, b)}
                                          aria-pressed={base === b}
                                          className={`h-11 px-4 rounded-full text-sm border ${
                                            base === b
                                              ? 'bg-accent text-white border-accent'
                                              : 'bg-fond text-texte border-separateur'
                                          }`}
                                        >
                                          {b.toUpperCase()}
                                        </button>
                                      ))}
                                      {base === 'ht' && (
                                        <span className="text-xs text-texte-doux tabular-nums">
                                          × 1,20 = {eur(ttcOffre(v, 'ht'))} €
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                          {(() => {
                            const sel = selectionCumul()
                            const pret = sel.length > 0 && sel.every((c) => c.base)
                            const total = pret
                              ? Math.round(sel.reduce((t, c) => t + ttcOffre(offres[c.i], c.base), 0) * 100) / 100
                              : null
                            return (
                              <div className="mt-2">
                                {pret && (
                                  <p className="text-sm text-texte tabular-nums mb-2">
                                    {[...sel]
                                      .sort((a, b) => a.i - b.i)
                                      .map((c) => eur(ttcOffre(offres[c.i], c.base)))
                                      .join(' + ')}{' '}
                                    = {eur(total)} € TTC
                                  </p>
                                )}
                                <button
                                  onClick={() => validerCumul(f)}
                                  disabled={!pret}
                                  className="h-11 px-4 rounded-full text-sm bg-accent text-white disabled:opacity-40"
                                >
                                  {pret ? `Valider le cumul · ${eur(total)} € TTC` : 'Valider le cumul'}
                                </button>
                              </div>
                            )
                          })()}
                        </>
                      ) : (
                      <ul className="space-y-1.5">
                        {offres.map((v, i) => (
                          <li key={i}>
                            <button
                              onClick={() => toucherOffre(f, i)}
                              className="w-full min-h-11 px-3 py-2 rounded-imbrique border border-separateur bg-fond flex items-center justify-between gap-3 text-left"
                            >
                              <span className="text-sm text-texte min-w-0">{v.libelle}</span>
                              <span className="text-sm text-texte font-medium tabular-nums flex-shrink-0">
                                {eur(v.montant_ttc)} €
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      )}
                      {cumul?.id !== f.id && choixHt?.id === f.id && (
                        <div className="mt-2 rounded-imbrique border border-alerte/40 bg-alerte/10 px-3 py-3">
                          <p className="text-sm text-texte">
                            {choixHt.base === 'ht'
                              ? `${eur(offres[choixHt.i].montant_ttc)} € HT × 1,20 = ${eur(ttcDepuisHt(offres[choixHt.i].montant_ttc))} € TTC`
                              : `Ce montant est HT ou TTC ? ${offres[choixHt.i].libelle} — ${eur(offres[choixHt.i].montant_ttc)} €`}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {choixHt.base === 'ht' ? (
                              <button
                                onClick={() => retenir(f, choixHt.i, true)}
                                className="h-11 px-4 rounded-full text-sm bg-accent text-white"
                              >
                                Confirmer {eur(ttcDepuisHt(offres[choixHt.i].montant_ttc))} € TTC
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => setChoixHt({ ...choixHt, base: 'ht' })}
                                  className="h-11 px-5 rounded-full text-sm bg-fond text-texte border border-separateur"
                                >
                                  HT
                                </button>
                                <button
                                  onClick={() => retenir(f, choixHt.i)}
                                  className="h-11 px-5 rounded-full text-sm bg-fond text-texte border border-separateur"
                                >
                                  TTC
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => setChoixHt(null)}
                              className="h-11 px-4 text-sm text-texte-doux"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : null}
                  {f.a_trancher_raison && (
                    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                      <TexteModifiable
                        valeur={null}
                        type="number"
                        placeholder="Montant TTC en €"
                        vide="Saisir le montant TTC à la main"
                        className="text-sm text-accent font-medium"
                        onEnregistrer={(v) => saisirMontant(f, v)}
                      />
                    </div>
                  )}
                </div>
              )}

              {retenue && f.montant_ttc != null && (
                <div className="px-4 pb-3 -mt-1 flex items-center justify-between gap-3">
                  <p className="text-xs text-texte-doux min-w-0">
                    {retenue.length > 1 ? 'Offres cumulées' : 'Offre retenue'} :{' '}
                    <span className="text-texte">{retenue.map((v) => v.libelle).join(' + ')}</span>
                  </p>
                  <button
                    onClick={() => remettreATrancher(f)}
                    className="text-accent text-xs font-medium h-11 px-2 -mr-2 flex-shrink-0"
                  >
                    Changer
                  </button>
                </div>
              )}

            </li>
            </React.Fragment>
            )
          })}
        </ul>
      )}

      {boîteConfirmation}
      </Rubrique>
      {annulable && (
        <div
          role="status"
          className="fixed bottom-4 left-4 right-4 z-40 max-w-md mx-auto bg-carte-douce rounded-xl shadow-lg pl-4 pr-1 flex items-center justify-between gap-2"
        >
          <span className="text-sm text-texte truncate py-2">{annulable.libelle}</span>
          <button onClick={annulerDecision} className="flex-shrink-0 min-h-11 px-3 text-sm font-semibold text-accent-vif">
            Annuler
          </button>
        </div>
      )}
    </>
  )
}
