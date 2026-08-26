import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const normalize = (s) =>
  (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const formaterPrix = (n) => `${new Intl.NumberFormat('fr-FR').format(n)} €`

export default function Catalogue({ onBack }) {
  const [produits, setProduits] = useState([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState(null)
  const [query, setQuery] = useState('')
  const [ouvert, setOuvert] = useState(null)

  // Le catalogue ne change que par réimport manuel (script), jamais depuis
  // l'app : un chargement unique suffit, pas d'abonnement temps réel.
  //
  // Supabase/PostgREST plafonne une requête sans pagination à 1000 lignes :
  // on récupère donc le catalogue par pages de 1000 jusqu'à épuisement.
  // Le tri inclut `id` en critère secondaire : de nombreux produits
  // partagent la même désignation, et un tri sur la seule désignation
  // n'est pas stable d'une requête à l'autre — deux pages consécutives
  // peuvent alors se chevaucher ou laisser passer une ligne entre les deux.
  useEffect(() => {
    let actif = true

    const recupererTousLesProduits = async () => {
      const TAILLE_PAGE = 1000
      let tous = []
      let debut = 0
      while (true) {
        const { data, error } = await supabase
          .from('produits')
          .select('*')
          .order('designation', { ascending: true })
          .order('id', { ascending: true })
          .range(debut, debut + TAILLE_PAGE - 1)
        if (error) throw error
        tous = tous.concat(data ?? [])
        if (!data || data.length < TAILLE_PAGE) break
        debut += TAILLE_PAGE
      }
      return tous
    }

    recupererTousLesProduits()
      .then((tous) => {
        if (actif) {
          setProduits(tous)
          setLoading(false)
        }
      })
      .catch((error) => {
        console.error('Erreur lors du chargement du catalogue :', error)
        if (actif) {
          setErreur('Impossible de charger le catalogue.')
          setLoading(false)
        }
      })

    return () => {
      actif = false
    }
  }, [])

  const resultats = useMemo(() => {
    const termes = normalize(query).split(/\s+/).filter(Boolean)
    if (termes.length === 0) return produits
    return produits.filter((p) => {
      const champs = normalize(
        [p.designation, p.code, p.modele, p.marque].filter(Boolean).join(' ')
      )
      return termes.every((t) => champs.includes(t))
    })
  }, [produits, query])

  const produitOuvert = produits.find((p) => p.id === ouvert) ?? null

  if (produitOuvert) {
    return (
      <div className="min-h-screen bg-fond">
        <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-3">
          <button
            onClick={() => setOuvert(null)}
            className="text-accent text-sm font-medium h-11 -ml-2 px-2 inline-flex items-center"
          >
            ← Catalogue
          </button>
        </header>
        <main className="px-4 pb-8">
          <div className="bg-carte rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-separateur">
              <p className="text-xs font-semibold text-accent uppercase tracking-wide">
                {produitOuvert.marque} · {produitOuvert.modele}
              </p>
              <h1 className="text-lg font-semibold text-texte mt-0.5">
                {produitOuvert.designation}
              </h1>
              <p className="text-xs text-texte-faible mt-0.5 tabular-nums">{produitOuvert.code}</p>
            </div>
            <div className="flex gap-5 px-4 py-3 border-b border-separateur">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-texte-faible">
                  Prix conseillé
                </p>
                <p className="text-base font-semibold text-texte tabular-nums mt-0.5">
                  {formaterPrix(produitOuvert.prix_conseille)}
                </p>
              </div>
              {produitOuvert.prix_offre != null && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-accent/80">
                    Offre en cours
                  </p>
                  <p className="text-base font-semibold text-accent tabular-nums mt-0.5">
                    {formaterPrix(produitOuvert.prix_offre)}
                  </p>
                </div>
              )}
            </div>
            {produitOuvert.offre_periode && (
              <p className="text-xs text-texte-faible px-4 py-2 border-b border-separateur">
                {produitOuvert.offre_periode}
              </p>
            )}
            {produitOuvert.instruction && (
              <p className="text-sm text-texte-doux px-4 py-3 border-b border-separateur">
                {produitOuvert.instruction}
              </p>
            )}
            <p className="text-xs text-texte-faible px-4 py-2 bg-carte-douce">
              Importé de « {produitOuvert.fichier_source} » le{' '}
              {new Date(produitOuvert.importe_le).toLocaleDateString('fr-FR')}
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-fond">
      <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-3">
        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            onClick={onBack}
            className="text-accent text-sm font-medium h-11 -ml-2 px-2 inline-flex items-center"
          >
            ← Clients
          </button>
          <h1 className="text-xl font-semibold text-texte">Catalogue</h1>
          <span className="w-11" aria-hidden="true" />
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="Nom, code ou modèle…"
          aria-label="Rechercher un produit"
          className="w-full bg-carte rounded-xl shadow-sm px-4 py-3 text-texte outline-none placeholder:text-texte-faible"
        />
      </header>

      <main className="px-4 pb-8">
        {loading && <p className="text-texte-faible text-sm">Chargement…</p>}

        {!loading && erreur && (
          <p className="text-erreur text-sm mt-8 text-center">{erreur}</p>
        )}

        {!loading && !erreur && produits.length === 0 && (
          <p className="text-texte-faible text-sm mt-8 text-center">
            Aucun produit importé pour l'instant.
          </p>
        )}

        {!loading && !erreur && produits.length > 0 && resultats.length === 0 && (
          <p className="text-texte-faible text-sm mt-8 text-center">
            Aucun produit pour « {query} ».
          </p>
        )}

        {!erreur && query && resultats.length > 0 && (
          <p className="text-xs text-texte-faible mb-2 px-1">
            {resultats.length} résultat{resultats.length > 1 ? 's' : ''}
          </p>
        )}

        <ul className="space-y-2">
          {resultats.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setOuvert(p.id)}
                className="w-full text-left bg-carte rounded-xl px-4 py-3 shadow-sm active:scale-[0.98] transition flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-texte truncate">{p.designation}</p>
                  <p className="text-xs text-texte-faible mt-0.5 tabular-nums">{p.code}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-texte font-semibold tabular-nums">
                    {formaterPrix(p.prix_conseille)}
                  </p>
                  {p.prix_offre != null && (
                    <p className="text-xs text-accent font-semibold tabular-nums mt-0.5">
                      {formaterPrix(p.prix_offre)} en offre
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
