import React from 'react'
import { supabase } from '../lib/supabaseClient'
import EtatErreur from './EtatErreur'
import JaugeObjectif from './JaugeObjectif'
import BandeAppeler, { BoutonAppeler } from './BandeAppeler'
import FeuilleBasse from './FeuilleBasse'
import PastilleAttente from './PastilleAttente'
import { nomClient } from '../lib/client'
import { TYPE_LABELS } from '../constants/dossiers'
import {
  Ligne,
  LigneNavigation,
  TuileKPI,
  CarteAnomalies,
  CarteRapportHebdo,
  TAG_LABELS,
  euros,
} from './BoardBlocs'

// Morceaux d'affichage du Board, partagés par l'ancien accueil (BriefSoir) et
// l'accueil unique : même JSX, mêmes données (useBoardData), même N.

const lignesAussi = (b, items, fermer, onOpenDossier) =>
  items.map((item) => (
    <Ligne
      key={item.cle}
      dossier={item.dossier}
      onOuvrir={(d) => {
        fermer?.()
        onOpenDossier(d)
      }}
      tag={item.type}
      ligneSecondaire={item.libelle}
      droite={item.droite}
      alerte
      onFait={item.type === 'devis' ? undefined : () => b.traiterElement(item)}
    />
  ))

/** En-tête collant : recherche rapide + pastilles de navigation. */
export function BoardEntete({ b, onOpenClient, onClients, onPipeline, onCapture, onDashboard, retour }) {
  const { rechercheTexte, setRechercheTexte, resultatsRecherche } = b
  return (
    <div className="sticky top-0 z-10 bg-fond/90 backdrop-blur">
      <header className="px-4 pt-6 pb-3 overflow-x-hidden">
        {retour && (
          <button onClick={retour.onClick} className="text-accent text-sm font-semibold h-11 -ml-2 pl-2 pr-3 mb-1 flex items-center">
            ← {retour.label}
          </button>
        )}
          <div className="relative">
            {/* Même halo que ClientList.jsx (porté par le div, pas l'input —
                voir son commentaire pour la raison iOS/Safari). */}
            <div className="rounded-carte shadow-halo-recherche focus-within:shadow-halo-recherche-focus transition-shadow duration-200">
              <input
                value={rechercheTexte}
                onChange={(e) => setRechercheTexte(e.target.value)}
                type="search"
                placeholder="Rechercher un praticien, une ville…"
                aria-label="Rechercher un client"
                className="w-full bg-carte rounded-carte pl-5 pr-10 py-4 text-texte outline-none placeholder:text-texte-faible"
              />
            </div>
            {rechercheTexte && (
              <button
                onClick={() => setRechercheTexte('')}
                aria-label="Effacer la recherche"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-texte-fantome text-lg leading-none"
              >
                ×
              </button>
            )}
            {rechercheTexte && (
              <ul className="absolute left-0 right-0 mt-1 bg-carte rounded-xl shadow-lg overflow-hidden z-20 max-h-72 overflow-y-auto">
                {resultatsRecherche.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-texte-faible">Aucun client pour « {rechercheTexte} ».</li>
                ) : (
                  resultatsRecherche.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={async () => {
                          // La recherche rapide ne charge que id/prénom/nom/
                          // cabinet/ville (une liste complète, en une fois,
                          // pour filtrer en local à chaque frappe) — sans
                          // cette relecture complète, la fiche s'ouvrait sur
                          // cet objet tronqué et affichait téléphone/e-mail
                          // vides alors qu'ils existaient bien en base (bug
                          // constaté le 21/09, voir PASSATION.md). Repli sur
                          // l'objet tronqué si la relecture échoue (hors
                          // ligne) plutôt que de bloquer la navigation.
                          const { data } = await supabase
                            .from('clients')
                            .select('*')
                            .eq('id', c.id)
                            .maybeSingle()
                          onOpenClient(data ?? c)
                          setRechercheTexte('')
                        }}
                        className="w-full text-left px-4 py-3 active:bg-carte-douce"
                      >
                        <p className="text-texte font-medium truncate">{nomClient(c) ?? 'Client'}</p>
                        {(c.nom_cabinet || c.ville) && (
                          <p className="text-xs text-texte-doux truncate">
                            {[c.nom_cabinet, c.ville].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-3">
            <button
              onClick={onClients}
              className="flex-shrink-0 px-4 h-11 rounded-full bg-carte text-accent text-xs font-semibold shadow"
            >
              Clients
            </button>
            <button
              onClick={() => onPipeline()}
              className="flex-shrink-0 px-4 h-11 rounded-full bg-carte text-accent text-xs font-semibold shadow"
            >
              Pipeline
            </button>
            <button
              onClick={onCapture}
              className="flex-shrink-0 px-4 h-11 rounded-full bg-carte text-accent text-xs font-semibold shadow"
            >
              Capture
            </button>
            {onDashboard && (
              <button
                onClick={onDashboard}
                className="flex-shrink-0 px-4 h-11 rounded-full bg-carte text-accent text-xs font-semibold shadow"
              >
                Dashboard
              </button>
            )}
          </div>
        </header>
    </div>
  )
}

/** KPI, ligne « N actions », bande « À appeler », « Aussi à traiter ». */
export function BoardHaut({ b, onPipeline, onOpenDossier }) {
  const {
    chargement, erreur, setTentative, depuisCache, bilan, board, enAttente, setFeuille, kpiRef, aussiATraiterRef,
    aussiATraiterDeplie, setAussiATraiterDeplie, allerAAussiATraiter, allerAObjectif, LIMITE_AUSSI_A_TRAITER,
  } = b
  return (
    <>
        {chargement && <p className="text-texte-faible text-sm">Point avec Todoist…</p>}

        {!chargement && erreur && (
          <EtatErreur message={erreur} onReessayer={() => setTentative((t) => t + 1)} />
        )}

        {!chargement && !erreur && (
          <>
            {depuisCache && (
              <p className="text-xs text-alerte mb-2 px-1">
                ⚠ Version hors ligne — peut ne pas refléter les derniers changements
              </p>
            )}

            <div ref={kpiRef} className="grid grid-cols-6 lg:grid-cols-5 gap-3 mt-2">
              <TuileKPI
                className="col-span-2 lg:col-span-1"
                titre="Dossiers actifs"
                valeur={bilan.totalActifsTousTypes}
                onClick={() => onPipeline()}
              />
              <TuileKPI
                className="col-span-2 lg:col-span-1"
                titre={`Objectif ${bilan.annee}`}
                valeur={`${bilan.pourcentageObjectif} %`}
                sousTitre={euros(bilan.signe)}
                onClick={allerAObjectif}
              />
              <TuileKPI
                className="col-span-2 lg:col-span-1"
                titre="À traiter"
                valeur={bilan.totalATraiter}
                urgent={bilan.totalATraiter > 0}
                onClick={allerAAussiATraiter}
              />
              <TuileKPI
                className="col-span-3 lg:col-span-1"
                titre="SAV ouverts"
                valeur={bilan.savOuverts.length}
                sousTitre={bilan.savEnRetard > 0 ? `dont ${bilan.savEnRetard} en retard` : null}
                urgent={bilan.savEnRetard > 0}
                onClick={() => onPipeline('sav')}
              />
              <TuileKPI
                className="col-span-3 lg:col-span-1"
                titre="En attente"
                valeur={enAttente.length}
                sousTitre="un tiers doit répondre"
                onClick={() => setFeuille('attente')}
              />
            </div>

            {/* Total remonté ici (retiré à côté du header « Aussi à
                traiter » plus bas, pour ne plus le montrer deux fois) : un
                seul chiffre à lire juste sous les KPI dit tout de suite
                l'ampleur de la soirée, avant même de croiser la carte
                Priorité. */}
            <p className="text-center text-sm text-texte-doux mt-3">
              {bilan.elementsUrgents.length} action{bilan.elementsUrgents.length > 1 ? 's' : ''} à traiter
              aujourd'hui · {board.contacts.length} contact{board.contacts.length > 1 ? 's' : ''} à appeler
            </p>

            {board.prioriteJour && (
              <BandeAppeler
                nombre={board.contacts.length}
                premier={board.prioriteJour}
                onOuvrirFeuille={() => setFeuille('appeler')}
                onOuvrirDossier={onOpenDossier}
              />
            )}

            <section ref={aussiATraiterRef} className="mt-6 scroll-mt-32">
              <h2 className="text-xs text-texte-faible uppercase tracking-wider px-1 mb-2">Aussi à traiter · {board.aussiATraiter.length}
              </h2>
              {board.aussiATraiter.length === 0 ? (
                <p className="text-texte-faible text-sm px-1">Rien d'autre en attente.</p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {lignesAussi(
                      b,
                      aussiATraiterDeplie ? board.aussiATraiter : board.aussiATraiter.slice(0, LIMITE_AUSSI_A_TRAITER),
                      undefined,
                      onOpenDossier
                    )}
                  </ul>
                  {!aussiATraiterDeplie && board.aussiATraiter.length > LIMITE_AUSSI_A_TRAITER && (
                    <button
                      onClick={() => setAussiATraiterDeplie(true)}
                      className="w-full text-center text-sm text-accent font-semibold py-3"
                    >
                      Voir les {board.aussiATraiter.length - LIMITE_AUSSI_A_TRAITER} autres
                    </button>
                  )}
                </>
              )}
            </section>
          </>
        )}
    </>
  )
}

/** Jauge d'objectif détaillée (projection, signé, facturé, reportable). */
export function BoardJauge({ b }) {
  const { chargement, erreur, bilan, objectifRef } = b
  if (chargement || erreur) return null
  return (
    <>
            <section ref={objectifRef} className="mt-6 scroll-mt-32">
              <h2 className="text-xs text-texte-faible uppercase tracking-wider px-1 mb-2">
                Objectif {bilan.annee}
              </h2>
              <JaugeObjectif
                annee={bilan.annee}
                projection={bilan.projection}
                signe={bilan.signe}
                facture={bilan.facture}
                reportables={bilan.reportables}
              />
              {bilan.planFacture > 0 && (
                <p className="text-xs text-texte-doux mt-2 px-1">
                  Casquette technique, hors objectif : {bilan.planFacture} plan
                  {bilan.planFacture > 1 ? 's' : ''} soldé{bilan.planFacture > 1 ? 's' : ''} ·{' '}
                  {euros(bilan.planFacture * 500)}
                </p>
              )}
            </section>
    </>
  )
}

/** Listes de navigation : À traiter, Production, Financier. */
export function BoardListes({ b, onPipeline }) {
  const { chargement, erreur, bilan, aTrancherPar, setFeuille, allerAAussiATraiter } = b
  if (chargement || erreur) return null
  return (
    <>
            <h2 className="text-xs text-texte-faible uppercase tracking-wider px-1 mt-6 mb-1">
              À traiter
            </h2>
            <div className="space-y-2">
              <LigneNavigation
                titre="SAV ouverts"
                compte={bilan.savOuverts.length}
                urgent={bilan.savOuverts.some((d) => d.statut !== 'en_attente')}
                onClick={() => onPipeline('sav')}
              />
              <LigneNavigation
                titre="Devis sans réponse"
                compte={bilan.devisSansReponse.length}
                urgent={bilan.devisSansReponse.length > 0}
                onClick={() => onPipeline('projet', 'devis_envoye')}
              />
              {/* À rappeler et Tâches en retard n'ont pas de colonne Pipeline
                  unique (un rappel ou une tâche vit sur un dossier de
                  n'importe quel type/étape) — mais ces mêmes dossiers sont
                  déjà listés en détail dans « Aussi à traiter » juste
                  au-dessus : y défiler est la cible exacte, pas une
                  approximation. */}
              <LigneNavigation
                titre="À rappeler"
                compte={bilan.aRappeler.length}
                urgent={bilan.aRappeler.length > 0}
                onClick={allerAAussiATraiter}
              />
              {aTrancherPar.nbDevis > 0 && (
                <button
                  onClick={() => setFeuille('trancher')}
                  className="w-full flex items-center justify-between gap-3 bg-carte rounded-xl px-4 min-h-12 text-left active:scale-[0.99] transition"
                >
                  <span className="text-texte">Devis à trancher</span>
                  <span className="flex items-center gap-2 text-alerte tabular-nums">
                    {aTrancherPar.nbDevis} devis · {aTrancherPar.nbDossiers} dossier
                    {aTrancherPar.nbDossiers > 1 ? 's' : ''}
                    <span className="text-texte-faible" aria-hidden="true">›</span>
                  </span>
                </button>
              )}
              <LigneNavigation
                titre="Tâches en retard"
                compte={bilan.tachesEnRetard.length}
                urgent={bilan.tachesEnRetard.length > 0}
                onClick={allerAAussiATraiter}
              />
            </div>

            <h2 className="text-xs text-texte-faible uppercase tracking-wider px-1 mt-6 mb-1">
              Production
            </h2>
            <div className="space-y-2">
              {/* Rappels à venir n'a pas non plus de colonne dédiée et n'est
                  pas dans « Aussi à traiter » (rien n'y est en retard) —
                  approximation : ouvre le Pipeline vue Projet, où vivent la
                  plupart des rappels. */}
              <LigneNavigation
                titre="Rappels à venir"
                compte={bilan.aVenir.length}
                onClick={() => onPipeline('projet')}
              />
              <LigneNavigation
                titre="Plans à produire"
                compte={bilan.plansAProduire.length}
                onClick={() => onPipeline('plan')}
              />
              {/* À chiffrer est exact, pas une approximation : tous les
                  dossiers sans montant estimé (bilan.sansMontant) sont de
                  type Projet. */}
              <LigneNavigation
                titre="À chiffrer"
                compte={bilan.sansMontant.length}
                onClick={() => onPipeline('projet')}
              />
            </div>

            <h2 className="text-xs text-texte-faible uppercase tracking-wider px-1 mt-6 mb-1">
              Financier
            </h2>
            <div className="space-y-2">
              <LigneNavigation
                titre="Règlements de plans à encaisser"
                compte={bilan.reglements.length}
                onClick={() => onPipeline('plan', 'reglement_demande')}
              />
            </div>

            {bilan.reglements.length > 0 && (
              <p className="text-xs text-texte-doux px-1 mt-2">
                {euros(bilan.duParPlans)} facturables, plans livrés et non réglés.
              </p>
            )}
    </>
  )
}

/** Qualité des données, anomalies détectées, rapport hebdo. */
export function BoardQualite({ b }) {
  const { chargement, erreur, bilan, couvertureFaible, anomalies, sectionsOuvertes, toggleSection, resoudreAnomalie, rapportHebdo } = b
  if (chargement || erreur) return null
  return (
    <>
            <h2 className="text-xs text-texte-faible uppercase tracking-wider px-1 mt-6 mb-1">
              Qualité des données
            </h2>

            {couvertureFaible && (
              <section className="mt-2">
                <div className="bg-alerte/10 border border-alerte/30 rounded-xl px-4 py-3">
                  <p className="text-sm text-texte">
                    {bilan.signesSansMontant > 0
                      ? `${bilan.signesSansMontant} dossier${bilan.signesSansMontant > 1 ? 's' : ''} sur ${bilan.nbSignes} déjà signé${bilan.nbSignes > 1 ? 's' : ''} n'${bilan.signesSansMontant > 1 ? 'ont' : 'a'} pas de montant : ${bilan.signesSansMontant > 1 ? 'ils manquent' : 'il manque'} à l'objectif sans se voir.`
                      : `Seuls ${bilan.chiffres} dossiers sur ${bilan.totalActifs} portent un montant estimé.`}
                  </p>
                  <p className="text-xs text-texte-doux mt-1">
                    Tant que les autres ne sont pas chiffrés, la jauge dit moins que la réalité.
                  </p>
                </div>
              </section>
            )}

            <CarteAnomalies
              anomalies={anomalies}
              ouverte={!!sectionsOuvertes.anomalies}
              onToggle={() => toggleSection('anomalies')}
              onResoudre={resoudreAnomalie}
            />

            <CarteRapportHebdo
              rapport={rapportHebdo}
              ouverte={!!sectionsOuvertes.rapport}
              onToggle={() => toggleSection('rapport')}
            />
    </>
  )
}

/** Feuilles du bas (À appeler, En attente, Devis à trancher), invite de texte, retour en haut. */
export function BoardFeuilles({ b, onOpenDossier }) {
  const { feuille, fermerFeuille, board, enAttente, aTrancherPar, plusTard, boitePrompt, montrerRetourHaut, retourEnHaut } = b
  return (
    <>
      {feuille === 'appeler' && (
        <FeuilleBasse titre={`À appeler · ${board.contacts.length}`} onFermer={fermerFeuille}>
          {board.contacts.length === 0 ? (
            <p className="text-texte-faible text-sm py-4">Rien à appeler.</p>
          ) : (
            <ul className="divide-y divide-separateur">
              {board.contacts.map((item) => (
                <li key={item.cle} className="flex items-center gap-2 min-h-14 py-1">
                  <button
                    onClick={() => {
                      fermerFeuille()
                      onOpenDossier(item.dossier)
                    }}
                    className="flex-1 min-w-0 min-h-11 text-left"
                  >
                    {item.cle === board.prioriteJour?.cle && (
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-alerte">
                        Priorité du jour
                      </span>
                    )}
                    <span className="block text-[15px] font-bold text-texte truncate">
                      <span className="inline-block align-middle text-[10px] font-semibold uppercase tracking-wide text-alerte bg-fond rounded px-1.5 py-0.5 mr-1.5">
                        {TAG_LABELS[item.type]}
                      </span>
                      {nomClient(item.dossier.clients) ?? '—'}
                    </span>
                    <span className="block text-xs text-alerte font-medium truncate">
                      {item.joursRetard > 0
                        ? `En retard de ${item.joursRetard} jour${item.joursRetard > 1 ? 's' : ''}`
                        : "À traiter aujourd'hui"}
                    </span>
                    <span className="block text-xs text-texte-doux truncate">
                      {item.libelle}
                      {item.autres.length > 0 && ` (+${item.autres.length})`}
                    </span>
                  </button>
                  <button
                    onClick={() => plusTard(item.cle)}
                    className="flex-shrink-0 h-11 px-2 text-xs text-texte-doux"
                  >
                    Plus tard
                  </button>
                  <BoutonAppeler
                    item={item}
                    onOuvrir={(d) => {
                      fermerFeuille()
                      onOpenDossier(d)
                    }}
                    className="flex-shrink-0 w-[88px] h-11 rounded-imbrique bg-accent-vif text-fond text-sm font-bold flex items-center justify-center"
                  />
                </li>
              ))}
            </ul>
          )}
          {board.aussiHorsContacts.length > 0 && (
            <section className="mt-5">
              <h3 className="text-xs text-texte-faible uppercase tracking-wider px-1 mb-2">Aussi à traiter</h3>
              <ul className="space-y-2">{lignesAussi(b, board.aussiHorsContacts, fermerFeuille, onOpenDossier)}</ul>
            </section>
          )}
        </FeuilleBasse>
      )}

      {feuille === 'attente' && (
        <FeuilleBasse titre={`En attente · ${enAttente.length}`} onFermer={fermerFeuille}>
          {enAttente.length === 0 ? (
            <p className="text-texte-faible text-sm py-4">Aucun dossier en attente.</p>
          ) : (
            <ul className="divide-y divide-separateur">
              {enAttente.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => {
                      fermerFeuille()
                      onOpenDossier(d)
                    }}
                    className="w-full min-h-14 py-2 text-left"
                  >
                    <span className="block text-[15px] font-bold text-texte truncate">
                      {nomClient(d.clients) ?? '—'}
                    </span>
                    <span className="block text-xs text-texte-doux truncate mb-1">{d.titre || TYPE_LABELS[d.type]}</span>
                    <PastilleAttente dossier={d} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FeuilleBasse>
      )}

      {feuille === 'trancher' && (
        <FeuilleBasse
          titre={`Devis à trancher · ${aTrancherPar.nbDevis} devis · ${aTrancherPar.nbDossiers} dossier${aTrancherPar.nbDossiers > 1 ? 's' : ''}`}
          onFermer={fermerFeuille}
        >
          <ul className="divide-y divide-separateur">
            {aTrancherPar.lignes.map(({ dossier: d, n }) => (
              <li key={d.id}>
                <button
                  onClick={() => {
                    fermerFeuille()
                    onOpenDossier(d)
                  }}
                  className="w-full min-h-14 py-2 text-left"
                >
                  <span className="block text-[15px] font-bold text-texte truncate">{nomClient(d.clients) ?? '—'}</span>
                  <span className="block text-xs text-texte-doux truncate">
                    {d.titre || TYPE_LABELS[d.type]} · {n} devis à trancher
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </FeuilleBasse>
      )}

      {boitePrompt}

      {montrerRetourHaut && (
        <button
          onClick={retourEnHaut}
          aria-label="Retour en haut"
          className="fixed bottom-6 right-4 z-30 w-12 h-12 rounded-full bg-accent-vif text-[#0A2E33] shadow-lg flex items-center justify-center active:scale-90 transition"
        >
          <span className="text-xl leading-none">↑</span>
        </button>
      )}
    </>
  )
}
