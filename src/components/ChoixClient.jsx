import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const sansAccent = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * Feuille de sélection d'un client.
 *
 * Une capture dont le praticien n'a pas été reconnu n'est pas perdue : elle
 * attend qu'on lui désigne sa fiche. Sans ce choix, la liste « à relier »
 * n'était qu'un constat.
 */
export default function ChoixClient({ titre = 'Relier à un client', onChoisir, onFermer }) {
  const [clients, setClients] = useState([])
  const [recherche, setRecherche] = useState('')

  useEffect(() => {
    supabase
      .from('clients')
      .select('id, prenom_praticien, nom_praticien, nom_cabinet, ville')
      .order('nom_praticien')
      .then(({ data }) => setClients(data ?? []))
  }, [])

  const resultats = useMemo(() => {
    const q = sansAccent(recherche).trim()
    if (!q) return clients.slice(0, 40)
    return clients
      .filter((c) =>
        sansAccent(
          [c.prenom_praticien, c.nom_praticien, c.nom_cabinet, c.ville].filter(Boolean).join(' ')
        ).includes(q)
      )
      .slice(0, 40)
  }, [clients, recherche])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onFermer}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-fond rounded-t-2xl max-h-[80vh] flex flex-col"
      >
        <div className="px-4 pt-4 pb-2 flex items-center gap-3">
          <h2 className="text-texte font-medium flex-1">{titre}</h2>
          <button onClick={onFermer} className="text-accent text-sm font-medium h-11 px-2">
            Annuler
          </button>
        </div>

        <div className="px-4 pb-2">
          <input
            autoFocus
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom, cabinet, ville…"
            className="w-full bg-carte rounded-xl px-4 py-3 text-texte outline-none placeholder:text-texte-fantome"
          />
        </div>

        <ul className="overflow-y-auto px-4 pb-6 space-y-2">
          {resultats.length === 0 && (
            <li className="text-texte-faible text-sm px-1">Aucun client ne correspond.</li>
          )}
          {resultats.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onChoisir(c)}
                className="w-full text-left bg-carte rounded-xl px-4 py-3 shadow-sm active:scale-[0.98] transition"
              >
                <p className="text-texte font-medium">
                  {[c.prenom_praticien, c.nom_praticien].filter(Boolean).join(' ')}
                </p>
                {(c.nom_cabinet || c.ville) && (
                  <p className="text-sm text-texte-doux">
                    {[c.nom_cabinet, c.ville].filter(Boolean).join(' · ')}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
