import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const TAILLE_MAX = 25 * 1024 * 1024

const lisible = (o) => {
  if (o == null) return ''
  if (o < 1024) return `${o} o`
  if (o < 1024 * 1024) return `${Math.round(o / 1024)} Ko`
  return `${(o / (1024 * 1024)).toFixed(1)} Mo`
}

const estPdf = (t) => t === 'application/pdf'

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
  const [erreur, setErreur] = useState(null)
  const champFichier = useRef(null)

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
      .then(({ data }) => {
        if (actif) setListe(data ?? [])
      })

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

  const envoyer = async (e) => {
    const fichier = e.target.files?.[0]
    e.target.value = '' // permet de re-choisir le même fichier après une erreur
    if (!fichier) return

    if (fichier.size > TAILLE_MAX) {
      setErreur(`« ${fichier.name} » fait ${lisible(fichier.size)}. La limite est de 25 Mo.`)
      return
    }

    setEnvoi(true)
    setErreur(null)

    // Chemin non devinable, et extension conservée pour que l'ouverture depuis
    // le lien signé reste correcte.
    const ext = fichier.name.includes('.') ? `.${fichier.name.split('.').pop()}` : ''
    const chemin = `${colonne}/${valeur}/${crypto.randomUUID()}${ext}`

    const { error: errEnvoi } = await supabase.storage
      .from('documents')
      .upload(chemin, fichier, { contentType: fichier.type || undefined })

    if (errEnvoi) {
      setEnvoi(false)
      setErreur(errEnvoi.message)
      return
    }

    const { data: ligne, error: errBase } = await supabase.from('fichiers').insert({
      [colonne]: valeur,
      chemin,
      nom: fichier.name,
      taille: fichier.size,
      type_mime: fichier.type || null,
    }).select().single()

    if (errBase) {
      // Sans cette ligne, le fichier resterait dans le dépôt sans référence :
      // invisible dans l'app et impossible à retrouver.
      await supabase.storage.from('documents').remove([chemin])
      setErreur(errBase.message)
    }

    setEnvoi(false)

    // Un devis déposé sur un dossier se lit tout de suite : c'est le moment où
    // le chiffre est utile, et le seul où l'on pense à le vérifier.
    if (!errBase && ligne && estPdf(fichier.type || null)) lireDevis(ligne)
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

  const basculerCumul = async (f) => {
    await supabase.from('fichiers').update({ cumule: !f.cumule }).eq('id', f.id)
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
    if (!window.confirm(`Supprimer définitivement « ${f.nom} » ? Cette action est irréversible.`)) {
      return
    }
    await supabase.storage.from('documents').remove([f.chemin])
    await supabase.from('fichiers').delete().eq('id', f.id)
    // Retrait immédiat : ne pas faire attendre l'aller-retour temps réel pour
    // voir disparaître ce qu'on vient de supprimer soi-même.
    setListe((cur) => cur.filter((x) => x.id !== f.id))
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-xs text-texte-faible">Pièces jointes</p>
        <button
          onClick={() => champFichier.current?.click()}
          disabled={envoi}
          className="text-accent text-sm font-medium disabled:opacity-50"
        >
          {envoi ? 'Envoi…' : '+ Ajouter'}
        </button>
      </div>

      <input
        ref={champFichier}
        type="file"
        accept="application/pdf,image/*"
        onChange={envoyer}
        className="hidden"
      />

      {erreur && <p className="text-erreur text-sm mb-2 px-1">{erreur}</p>}

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
              <button onClick={() => ouvrir(f)} className="flex-1 min-w-0 text-left">
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
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <button
                  onClick={() => supprimer(f)}
                  aria-label={`Supprimer ${f.nom}`}
                  className="text-texte-fantome text-lg leading-none"
                >
                  ×
                </button>
                {dossierId && estPdf(f.type_mime) && !analyse.has(f.id) && (
                  <button
                    onClick={() => lireDevis(f)}
                    className="text-accent text-[11px] font-medium"
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
    </div>
  )
}
