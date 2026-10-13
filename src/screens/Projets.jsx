import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { lireAvecCache } from '../lib/cacheLecture'
import { FAMILLES } from '../constants/dashboard'
import { construireProjets, compteurs, filtrer, trier, TRIS, VUE_PAR_DEFAUT } from '../lib/projets'
import { resume } from '../lib/financement'
import EtatErreur from '../components/EtatErreur'

const euros = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €'

// Filtres, tri, recherche et position de défilement survivent à l'ouverture d'une fiche : l'écran se
// démonte quand on le quitte (pile d'écrans de l'application), la vue est donc gardée en mémoire de session.
const CLE_VUE = 'fv9:vue-projets'
const lireVue = () => {
  try {
    return { ...VUE_PAR_DEFAUT, ...(JSON.parse(sessionStorage.getItem(CLE_VUE) ?? '{}')) }
  } catch {
    return { ...VUE_PAR_DEFAUT }
  }
}
const ecrireVue = (vue) => {
  try {
    sessionStorage.setItem(CLE_VUE, JSON.stringify(vue))
  } catch {
    // stockage indisponible : la vue repart du défaut, rien de plus à faire
  }
}

const lire = (cle, requete) =>
  lireAvecCache(cle, () =>
    requete().then(({ data, error }) => {
      if (error) throw new Error(error.message)
      return data ?? []
    })
  )

function Pastille({ actif, onClick, children, couleur, label, titre }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={actif}
      aria-label={label}
      title={titre}
      className={`flex-shrink-0 min-h-11 px-3 rounded-full border text-sm font-medium flex items-center gap-1.5 ${
        actif ? 'bg-accent text-white border-accent' : 'bg-carte text-texte-doux border-separateur'
      }`}
    >
      {couleur && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: couleur }} aria-hidden="true" />}
      {children}
    </button>
  )
}

export default function Projets({ onBack, onOpenDossier, familleInitiale = null, filtreInitial = null }) {
  const [dossiers, setDossiers] = useState([])
  const [fichiers, setFichiers] = useState([])
  const [taches, setTaches] = useState([])
  const [activite, setActivite] = useState({ notes: [], etapes: [] })
  const [financements, setFinancements] = useState([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState(null)
  const [depuisCache, setDepuisCache] = useState(false)
  const [tentative, setTentative] = useState(0)
  const [vue, setVue] = useState(() => {
    const v = lireVue()
    // Arrivée depuis une famille du Pilotage : cette famille, sans filtre résiduel.
    return familleInitiale || filtreInitial ? { ...VUE_PAR_DEFAUT, tri: v.tri, famille: familleInitiale, ...(filtreInitial ? { [filtreInitial]: true } : {}) } : v
  })
  const defilementRestaure = useRef(false)

  const charger = useCallback(async () => {
    try {
      const [d, f, t, n, e, fi] = await Promise.all([
        lire('projets-dossiers', () =>
          supabase
            .from('dossiers')
            .select('*, clients(id, prenom_praticien, nom_praticien, nom_cabinet, ville, telephone_portable, telephone_cabinet)')
            .eq('type', 'projet')
        ),
        lire('projets-fichiers', () =>
          supabase
            .from('fichiers')
            .select('id, dossier_id, type_doc, montant_ttc, variantes, a_trancher_raison, decision, date_reprise, created_at')
            .not('dossier_id', 'is', null)
        ),
        lire('brief-taches', () => supabase.from('dossier_note_taches').select('*').eq('fait', false).not('echeance', 'is', null)),
        lire('projets-notes', () => supabase.from('dossier_notes').select('dossier_id, created_at')),
        lire('projets-etapes', () => supabase.from('dossier_etapes_historique').select('dossier_id, changed_at')),
        lire('projets-financements', () => supabase.from('dossier_financement').select('dossier_id, mode, statut, organisme, montant_finance')),
      ])
      setDossiers(d.valeur)
      setFichiers(f.valeur)
      setTaches(t.valeur)
      setActivite({ notes: n.valeur, etapes: e.valeur })
      setFinancements(fi.valeur)
      setDepuisCache(d.depuisCache || f.depuisCache || t.depuisCache)
      setErreur(null)
    } catch {
      setErreur('Impossible de charger les projets.')
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => {
    setChargement(true)
    charger()
  }, [charger, tentative])

  // Temps réel : INSERT, UPDATE et DELETE sur les tables dont la liste dépend.
  const minuteur = useRef(null)
  useEffect(() => {
    const replanifier = () => {
      clearTimeout(minuteur.current)
      minuteur.current = setTimeout(charger, 500)
    }
    let canal = supabase.channel('projets-temps-reel')
    for (const table of ['dossiers', 'fichiers', 'dossier_note_taches', 'dossier_financement']) {
      canal = canal.on('postgres_changes', { event: '*', schema: 'public', table }, replanifier)
    }
    canal.subscribe()
    return () => {
      clearTimeout(minuteur.current)
      supabase.removeChannel(canal)
    }
  }, [charger])

  const lignes = useMemo(() => construireProjets({ dossiers, fichiers, taches, activite, financements }), [dossiers, fichiers, taches, activite, financements])
  const nombres = useMemo(() => compteurs(lignes), [lignes])
  const affichees = useMemo(() => trier(filtrer(lignes, vue), vue.tri), [lignes, vue])

  const changer = (patch) =>
    setVue((v) => {
      const suivante = { ...v, ...patch }
      ecrireVue(suivante)
      return suivante
    })

  // Position de défilement : enregistrée au moment d'ouvrir une fiche (l'écran suivant la remettrait à zéro
  // avant qu'un écouteur de défilement puisse la lire), rétablie une fois la liste affichée.
  const ouvrir = (dossier) => {
    try {
      sessionStorage.setItem(`${CLE_VUE}:y`, String(window.scrollY))
    } catch {
      // sans importance
    }
    onOpenDossier(dossier)
  }
  useEffect(() => {
    if (chargement || defilementRestaure.current) return
    defilementRestaure.current = true
    if (familleInitiale || filtreInitial) return
    const y = Number(sessionStorage.getItem(`${CLE_VUE}:y`) ?? 0)
    if (y > 0) window.scrollTo(0, y)
  }, [chargement, affichees.length, familleInitiale, filtreInitial])

  const aucunFiltre = !vue.famille && !vue.aTrancher && !vue.reportes && !vue.enAttente && !vue.finAttente && !vue.finNonConfirme && !vue.incomplets && !vue.recherche

  return (
    <div className="min-h-screen bg-fond">
      <header className="sticky top-0 z-10 bg-fond/90 backdrop-blur px-4 pt-6 pb-2">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-accent text-sm font-semibold h-11 -ml-2 pl-2 pr-1 flex items-center">
            ← Accueil
          </button>
          <h1 className="text-lg font-bold text-texte flex-1">Projets</h1>
          <span className="text-sm text-texte-doux tabular-nums" aria-live="polite">
            {affichees.length === lignes.length ? `${lignes.length} projets` : `${affichees.length} sur ${lignes.length}`}
          </span>
        </div>
        <div className="rounded-carte shadow-halo-recherche focus-within:shadow-halo-recherche-focus transition-shadow duration-200 mt-2">
          <input
            type="search"
            value={vue.recherche}
            onChange={(e) => changer({ recherche: e.target.value })}
            placeholder="Rechercher un client, un titre, une ville…"
            aria-label="Rechercher un projet"
            className="w-full bg-carte rounded-carte px-5 min-h-12 text-texte outline-none placeholder:text-texte-faible"
          />
        </div>
      </header>

      <main className="px-4 pb-10">
        {depuisCache && <p className="text-xs text-alerte mb-2 px-1">⚠ Version hors ligne — peut ne pas refléter les derniers changements</p>}
        {chargement && !lignes.length && <p className="text-texte-faible text-sm">Chargement…</p>}
        {erreur && !lignes.length && <EtatErreur message={erreur} onReessayer={() => setTentative((t) => t + 1)} />}

        {(!chargement || lignes.length > 0) && !(erreur && !lignes.length) && (
          <>
            <div role="group" aria-label="Tri" className="flex gap-2 overflow-x-auto py-2 -mx-4 px-4">
              {TRIS.map(([cle, libelle]) => (
                <Pastille key={cle} actif={vue.tri === cle} onClick={() => changer({ tri: cle })} label={`Trier : ${libelle}`} titre={cle === 'anciennete' ? 'Sans action depuis le plus longtemps en haut' : undefined}>
                  {libelle}
                </Pastille>
              ))}
            </div>

            <div role="group" aria-label="Filtres" className="flex flex-wrap gap-2 pb-3">
              {FAMILLES.map((f) => (
                <Pastille
                  key={f.cle}
                  actif={vue.famille === f.cle}
                  couleur={f.couleur}
                  onClick={() => changer({ famille: vue.famille === f.cle ? null : f.cle })}
                  label={`Famille ${f.libelle} : ${nombres.familles[f.cle]}`}
                >
                  {f.libelle} <span className="tabular-nums">{nombres.familles[f.cle]}</span>
                </Pastille>
              ))}
              <Pastille actif={vue.aTrancher} onClick={() => changer({ aTrancher: !vue.aTrancher })} label={`Dossiers à trancher : ${nombres.aTrancher}`}>
                À trancher <span className="tabular-nums">{nombres.aTrancher}</span>
              </Pastille>
              <Pastille actif={vue.reportes} onClick={() => changer({ reportes: !vue.reportes })} label={`Dossiers reportés : ${nombres.reportes}`}>
                Reportés <span className="tabular-nums">{nombres.reportes}</span>
              </Pastille>
              <Pastille actif={vue.enAttente} onClick={() => changer({ enAttente: !vue.enAttente })} label={`Projets en attente : ${nombres.enAttente}`}>
                En attente <span className="tabular-nums">{nombres.enAttente}</span>
              </Pastille>
              <Pastille actif={vue.finAttente} onClick={() => changer({ finAttente: !vue.finAttente })} label={`Financement en attente d'accord : ${nombres.finAttente}`}>
                Financement <span className="tabular-nums">{nombres.finAttente}</span>
              </Pastille>
              <Pastille actif={vue.finNonConfirme} onClick={() => changer({ finNonConfirme: !vue.finNonConfirme })} label={`Signés, financement non confirmé : ${nombres.finNonConfirme}`}>
                Signé, financement ? <span className="tabular-nums">{nombres.finNonConfirme}</span>
              </Pastille>
              <Pastille actif={vue.incomplets} onClick={() => changer({ incomplets: !vue.incomplets })} label={`Projets incomplets : ${nombres.incomplets}`}>
                Incomplets <span className="tabular-nums">{nombres.incomplets}</span>
              </Pastille>
              {!aucunFiltre && (
                <button
                  onClick={() => changer({ ...VUE_PAR_DEFAUT, tri: vue.tri })}
                  className="flex-shrink-0 min-h-11 px-3 text-sm text-accent font-semibold"
                >
                  Effacer les filtres
                </button>
              )}
            </div>

            {affichees.length === 0 ? (
              <p className="text-texte-faible text-sm py-6 text-center">Aucun projet pour ces filtres.</p>
            ) : (
              <ul className="space-y-2" aria-label="Projets">
                {affichees.map((l) => (
                  <li key={l.id} data-dossier-id={l.id}>
                    <button
                      onClick={() => ouvrir(l.dossier)}
                      style={{ borderColor: l.famille.couleur }}
                      className="w-full text-left bg-carte rounded-xl shadow-sm border-l-[7px] px-4 py-3 min-h-[72px] active:scale-[0.99] transition"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-texte truncate">{l.client}</span>
                        <span className={`flex-shrink-0 text-sm tabular-nums ${l.aChiffrer ? 'text-alerte' : 'text-texte-doux'}`}>
                          {l.montant != null ? euros(l.montant) : l.aChiffrer ? 'à chiffrer' : '—'}
                        </span>
                      </span>
                      <span className="block text-sm text-texte-doux truncate">{l.titre}</span>
                      <span className="flex items-center justify-between gap-3 mt-1">
                        <span className="inline-flex items-center gap-1.5 text-xs text-texte min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: l.famille.couleur }} aria-hidden="true" />
                          <span className="truncate">{l.etape}</span>
                        </span>
                        <span className="text-xs text-texte-faible flex-shrink-0 tabular-nums">
                          {l.jours == null ? '' : l.jours === 0 ? "aujourd'hui" : `il y a ${l.jours} j`}
                        </span>
                      </span>
                      {l.financement && (
                        <span className="block text-xs text-texte-doux mt-0.5 truncate">Financement · {resume(l.financement)}</span>
                      )}
                      {l.motifs.length > 0 && (
                        <span className="block text-xs text-alerte mt-0.5 truncate">
                          {l.motifs[0].texte}
                          {l.autres > 0 ? ` · +${l.autres}` : ''}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  )
}
