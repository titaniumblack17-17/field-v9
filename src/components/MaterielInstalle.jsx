import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const vide = { marque: '', modele: '', annee: '', quantite: '', note: '' }

export default function MaterielInstalle({ clientId }) {
  const [liste, setListe] = useState([])
  const [saisie, setSaisie] = useState(vide)
  const [ouvert, setOuvert] = useState(false)
  const [enregistre, setEnregistre] = useState(false)

  useEffect(() => {
    let actif = true

    supabase
      .from('materiel')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (actif) setListe(data ?? [])
      })

    const canal = supabase
      .channel(`materiel-${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'materiel', filter: `client_id=eq.${clientId}` },
        (p) => {
          setListe((cur) => {
            if (p.eventType === 'INSERT') {
              return cur.some((m) => m.id === p.new.id) ? cur : [...cur, p.new]
            }
            if (p.eventType === 'UPDATE') return cur.map((m) => (m.id === p.new.id ? p.new : m))
            if (p.eventType === 'DELETE') return cur.filter((m) => m.id !== p.old.id)
            return cur
          })
        }
      )
      .subscribe()

    return () => {
      actif = false
      supabase.removeChannel(canal)
    }
  }, [clientId])

  const champ = (cle) => (e) => setSaisie((s) => ({ ...s, [cle]: e.target.value }))

  const ajouter = async () => {
    if (!saisie.marque.trim() && !saisie.modele.trim()) return
    setEnregistre(true)
    await supabase.from('materiel').insert({
      client_id: clientId,
      marque: saisie.marque.trim() || null,
      modele: saisie.modele.trim() || null,
      annee: saisie.annee ? Number(saisie.annee) : null,
      quantite: saisie.quantite ? Number(saisie.quantite) : null,
      note: saisie.note.trim() || null,
    })
    setSaisie(vide)
    setOuvert(false)
    setEnregistre(false)
  }

  const supprimer = async (id) => {
    if (!window.confirm('Retirer cet équipement de la liste ?')) return
    await supabase.from('materiel').delete().eq('id', id)
  }

  const anneeCourante = new Date().getFullYear()

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-xs text-texte-faible">Matériel installé</p>
        <button onClick={() => setOuvert((o) => !o)} className="text-accent text-sm font-medium">
          {ouvert ? 'Fermer' : '+ Ajouter'}
        </button>
      </div>

      {ouvert && (
        <div className="bg-carte rounded-xl shadow-sm divide-y divide-separateur mb-2">
          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="mat-marque">Marque</label>
            <input
              id="mat-marque"
              value={saisie.marque}
              onChange={champ('marque')}
              placeholder="Planmeca, Cattani, Melag…"
              className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
            />
          </div>
          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="mat-modele">Modèle</label>
            <input
              id="mat-modele"
              value={saisie.modele}
              onChange={champ('modele')}
              placeholder="Pro50 S, Viso G1…"
              className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
            />
          </div>
          <div className="flex divide-x divide-separateur">
            <div className="px-4 py-3 flex-1">
              <label className="text-xs text-texte-faible" htmlFor="mat-annee">Année</label>
              <input
                id="mat-annee"
                type="number"
                inputMode="numeric"
                value={saisie.annee}
                onChange={champ('annee')}
                placeholder="—"
                className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
              />
            </div>
            <div className="px-4 py-3 flex-1">
              <label className="text-xs text-texte-faible" htmlFor="mat-qte">Quantité</label>
              <input
                id="mat-qte"
                type="number"
                inputMode="numeric"
                value={saisie.quantite}
                onChange={champ('quantite')}
                placeholder="—"
                className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
              />
            </div>
          </div>
          <div className="px-4 py-3">
            <label className="text-xs text-texte-faible" htmlFor="mat-note">Note</label>
            <input
              id="mat-note"
              value={saisie.note}
              onChange={champ('note')}
              placeholder="État, salle, à remplacer…"
              className="w-full text-texte outline-none bg-transparent placeholder:text-texte-fantome"
            />
          </div>
          <div className="p-3">
            <button
              onClick={ajouter}
              disabled={enregistre || (!saisie.marque.trim() && !saisie.modele.trim())}
              className="w-full bg-accent text-white font-medium rounded-xl py-3 shadow disabled:opacity-50"
            >
              Ajouter à la liste
            </button>
          </div>
        </div>
      )}

      {liste.length === 0 ? (
        !ouvert && <p className="text-texte-faible text-sm px-1">Aucun matériel renseigné.</p>
      ) : (
        <ul className="space-y-2">
          {liste.map((m) => {
            const age = m.annee ? anneeCourante - m.annee : null
            return (
              <li key={m.id} className="bg-carte rounded-xl px-4 py-3 shadow-sm flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-texte font-medium">
                    {m.quantite && m.quantite > 1 ? `${m.quantite} × ` : ''}
                    {[m.marque, m.modele].filter(Boolean).join(' ')}
                  </p>
                  {(m.annee || m.note) && (
                    <p className="text-sm text-texte-doux">
                      {m.annee ? `${m.annee}${age != null ? ` · ${age} an${age > 1 ? 's' : ''}` : ''}` : ''}
                      {m.annee && m.note ? ' · ' : ''}
                      {m.note ?? ''}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => supprimer(m.id)}
                  aria-label="Retirer cet équipement"
                  className="text-texte-fantome text-lg leading-none flex-shrink-0"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
