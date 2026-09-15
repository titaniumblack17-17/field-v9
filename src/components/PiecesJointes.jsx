import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { mettreEnFile } from '../lib/fileAttente'
import { envoyerFichier, fichierColle } from '../lib/fichiers'
import TexteModifiable from './TexteModifiable'
import useConfirm from '../hooks/useConfirm'
import Rubrique from './Rubrique'

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
  const [erreur, setErreur] = useState(null)
  const [confirmer, boîteConfirmation] = useConfirm()
  const champFichier = useRef(null)
  const champCollage = useRef(null)

  // Devis chiffrés en mode remplacement, du plus récent au plus ancien : le
  // premier est celui qui donne son montant au dossier.
  const remplacants = liste
    .filter((f) => f.montant_ttc != null && !f.cumule)
    .sort((a, b) =>
      (b.date_devis ?? b.created_at.slice(0, 10)).localeCompare(
        a.date_devis ?? a.created_at.slice(0, 10)
      )
    )

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
    if (ligne && estPdf(fichier.type || null)) lireDevis(ligne)
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
    if (!dossierId || !estPdf(fichier.type_mime)) return
    setAnalyse((cur) => new Set(cur).add(fichier.id))
    const { error: err } = await supabase.functions.invoke('devis-montant', {
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

  // Pour un devis à variantes que le modèle refuse de trancher seul : le choix
  // reste entre Bruce et le client, la saisie doit rester manuelle.
  const saisirMontant = async (f, saisie) => {
    const nombre = saisie == null ? null : Number(String(saisie).replace(',', '.').replace(/\s/g, ''))
    if (saisie != null && (Number.isNaN(nombre) || nombre < 0)) {
      setErreur('Montant invalide.')
      return
    }
    await supabase
      .from('fichiers')
      .update({ montant_ttc: nombre, analyse_erreur: null })
      .eq('id', f.id)
    onMontantChange?.()
  }

  const basculerCumul = async (f) => {
    const cumule = !f.cumule
    const { error } = await supabase.from('fichiers').update({ cumule }).eq('id', f.id)
    if (error) mettreEnFile({ type: 'update', table: 'fichiers', rowId: f.id, champs: { cumule } })
    onMontantChange?.()
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
        titre="Pièces jointes"
        compte={liste.length}
        forceOuvert={envoi}
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

      {/* Deux devis chiffrés qui se remplacent, c'est presque toujours deux
          affaires différentes plutôt qu'une révision : sans ce rappel, le
          dernier déposé — souvent le plus petit — écrase le principal. */}
      {dossierId && remplacants.length > 1 && (
        <div className="bg-alerte/10 border border-alerte/30 rounded-xl px-4 py-3 mb-2">
          <p className="text-sm text-texte">
            {remplacants.length} devis chiffrés se remplacent. Le plus récent fait foi :{' '}
            {new Intl.NumberFormat('fr-FR').format(remplacants[0].montant_ttc)} € TTC.
          </p>
          <p className="text-xs text-texte-doux mt-1">
            Cochez « devis complémentaire » sur ceux qui s'ajoutent au lieu de remplacer.
          </p>
        </div>
      )}

      {liste.length === 0 ? (
        <p className="text-texte-faible text-sm px-1">Aucun document.</p>
      ) : (
        <ul className="space-y-2">
          {liste.map((f) => (
            <li key={f.id} className="bg-carte rounded-xl shadow-sm">
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
                <button onClick={() => ouvrir(f)} className="w-full min-w-0 text-left">
                <p className="text-texte truncate">{f.nom}</p>
                <p className="text-xs text-texte-faible">
                  {[lisible(f.taille), new Date(f.created_at).toLocaleDateString('fr-FR')]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {f.montant_ttc != null && (
                  <p className="text-sm text-texte font-medium mt-0.5 tabular-nums">
                    {new Intl.NumberFormat('fr-FR').format(f.montant_ttc)} € TTC
                    {f.reference_devis ? (
                      <span className="text-xs text-texte-faible font-normal">
                        {' '}· devis {f.reference_devis}
                      </span>
                    ) : null}
                  </p>
                )}
                {analyse.has(f.id) && (
                  <p className="text-xs text-texte-faible mt-0.5">Lecture du devis…</p>
                )}
                {!analyse.has(f.id) && f.analyse_erreur && (
                  <p className="text-xs text-alerte mt-0.5">{f.analyse_erreur}</p>
                )}
                </button>
              )}
              {f.montant_ttc == null && dossierId && estPdf(f.type_mime) && renommage !== f.id && (
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
                    className="text-texte-fantome text-[11px] h-9 px-2 -mr-2 flex items-center"
                  >
                    Renommer
                  </button>
                )}
                {dossierId && estPdf(f.type_mime) && !analyse.has(f.id) && (
                  <button
                    onClick={() => lireDevis(f)}
                    className="text-accent text-[11px] font-medium h-9 px-2 -mr-2 flex items-center"
                  >
                    {f.analyse_at ? 'Relire' : 'Lire le devis'}
                  </button>
                )}
              </div>
              </div>
              {f.montant_ttc != null && dossierId && (
                <label className="flex items-center gap-2 px-4 pb-3 -mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={f.cumule}
                    onChange={() => basculerCumul(f)}
                    className="accent-accent"
                  />
                  <span className="text-xs text-texte-doux">
                    Devis complémentaire — s'ajoute au devis principal
                  </span>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      {boîteConfirmation}
      </Rubrique>
    </>
  )
}
