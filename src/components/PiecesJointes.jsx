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
export default function PiecesJointes({ clientId, dossierId }) {
  const colonne = clientId ? 'client_id' : 'dossier_id'
  const valeur = clientId ?? dossierId

  const [liste, setListe] = useState([])
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState(null)
  const champFichier = useRef(null)

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

    const { error: errBase } = await supabase.from('fichiers').insert({
      [colonne]: valeur,
      chemin,
      nom: fichier.name,
      taille: fichier.size,
      type_mime: fichier.type || null,
    })

    if (errBase) {
      // Sans cette ligne, le fichier resterait dans le dépôt sans référence :
      // invisible dans l'app et impossible à retrouver.
      await supabase.storage.from('documents').remove([chemin])
      setErreur(errBase.message)
    }

    setEnvoi(false)
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

      {liste.length === 0 ? (
        <p className="text-texte-faible text-sm px-1">Aucun document.</p>
      ) : (
        <ul className="space-y-2">
          {liste.map((f) => (
            <li key={f.id} className="bg-carte rounded-xl px-4 py-3 shadow-sm flex items-center gap-3">
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
              </button>
              <button
                onClick={() => supprimer(f)}
                aria-label={`Supprimer ${f.nom}`}
                className="text-texte-fantome text-lg leading-none flex-shrink-0"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
