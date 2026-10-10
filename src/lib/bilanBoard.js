import { dossiersReportes, offresPlat } from './documents'
import { etatRappel, etatEcheanceTache, aujourdhui as calculerAujourdhui } from './rappel'
import {
  STATUTS_SAV_LABELS,
  TYPE_LABELS,
  joursDevisSansReponse,
  joursEnAttente,
  joursDepuisStatut,
  estEnAttente,
  exerciceDe,
  ETAPES_SIGNEES,
  ETAPES_FACTUREES,
  SEUIL_DEVIS_SANS_REPONSE_JOURS,
} from '../constants/dossiers'

// Objectif annuel de la spec (§1) : 5 M€ TTC.
export const OBJECTIF_ANNUEL = 5_000_000

// Calcul unique du Board : l'ancien accueil et la zone « Aujourd'hui » de
// l'accueil lisent exactement les mêmes nombres, il n'existe qu'un seul N.
export function calculerBilan(dossiers, taches, devisSansMontant) {
    // Date locale (versISO via rappel.js), pas toISOString() : sinon un
    // rappel du jour classé « à venir » au lieu d'« à rappeler » entre
    // minuit et 1h-2h du matin heure de Paris — décalage UTC déjà corrigé
    // dans rappel.js, redéfini ici par erreur, désormais réutilisé.
    const aujourdhui = calculerAujourdhui()
    const annee = new Date().getFullYear()
    const projets = dossiers.filter((d) => d.type === 'projet')

    // Les affaires réglées lors d'un exercice passé sont soldées : elles ne
    // pèsent plus sur l'objectif de cette année.
    const actifs = projets.filter(
      (d) => d.statut !== 'perdu' && exerciceDe(d, annee) === annee
    )

    // Un plan livré ou en cours de règlement n'a plus de travail dû : seul
    // « soldé » ferme réellement le dossier — sert au KPI « Dossiers actifs »
    // (Projet + Plan + SAV), pas au détail « Plans à produire » plus bas.
    const plansActifs = dossiers.filter((d) => d.type === 'plan' && d.statut !== 'solde')

    // Un SAV ouvert, c'est un praticien qui ne peut pas travailler. Ça passe
    // avant un rappel commercial, et ça n'a pas besoin d'un écran à soi : un
    // onglet séparé qu'on n'ouvre pas serait pire que rien.
    const savOuverts = dossiers
      .filter((d) => d.type === 'sav' && d.statut !== 'clos')
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))

    // Un devis sans réponse depuis plus d'un mois n'est plus une affaire en
    // cours : soit il se relance, soit il faut le passer perdu et rouvrir un
    // nouveau dossier si le client revient — mais ça se décide, ça ne se
    // laisse pas dormir en « Devis envoyé ».
    const devisSansReponse = dossiers
      .filter((d) => joursDevisSansReponse(d) != null)
      .sort((a, b) => joursDevisSansReponse(b) - joursDevisSansReponse(a))

    const aRappeler = dossiers
      .filter((d) => d.rappel_date && d.rappel_date <= aujourdhui)
      .sort((a, b) => a.rappel_date.localeCompare(b.rappel_date))

    const aVenir = dossiers
      .filter((d) => d.rappel_date && d.rappel_date > aujourdhui)
      .sort((a, b) => a.rappel_date.localeCompare(b.rappel_date))
      .slice(0, 5)

    // Une échéance du jour compte comme en retard (echu), même logique que
    // « À rappeler aujourd'hui » ci-dessus : ça se décide ce soir, pas demain.
    // Le dossier peut manquer (pas encore chargé, ou supprimé entre-temps) —
    // sans lui, rien à afficher pour situer la tâche.
    const tachesEnRetard = taches
      .filter((t) => etatEcheanceTache(t.echeance)?.echu)
      .map((t) => ({ ...t, dossier: dossiers.find((d) => d.id === t.dossier_id) }))
      .filter((t) => t.dossier)
      .sort((a, b) => (a.echeance ?? '').localeCompare(b.echeance ?? ''))

    // Travail technique dû : plans intégrés à une vente, et plans encore à
    // fabriquer.
    const plansAProduire = [
      ...projets.filter((d) => d.plan_statut && d.plan_statut !== 'fait'),
      ...dossiers.filter(
        (d) => d.type === 'plan' && ['a_planifier', 'en_cours'].includes(d.statut)
      ),
    ]

    // Un plan livré n'est pas un plan soldé. Ceux-là ne demandent plus de
    // travail : ils demandent d'être payés, et c'est en les oubliant qu'on
    // travaille gratuitement.
    const reglements = dossiers.filter(
      (d) =>
        d.type === 'plan' &&
        d.remuneration_type === 'facture' &&
        ['installe', 'reglement_demande'].includes(d.statut)
    )

    const somme = (liste) => liste.reduce((t, d) => t + (Number(d.montant_estime) || 0), 0)
    // Même définition que le Dashboard : un dossier « reporté » (offre ou devis mis de
    // côté, rien de retenu) ne compte pas en signé.
    const reportesIds = dossiersReportes(devisSansMontant)
    const signes = actifs.filter((d) => ETAPES_SIGNEES.includes(d.statut) && !reportesIds.has(d.id))
    const factures = actifs.filter((d) => ETAPES_FACTUREES.includes(d.statut))

    // Score commun « jours de retard équivalent » : chaque famille a sa
    // propre référence de retard (une deadline explicite pour rappel/tâche,
    // le franchissement d'un seuil pour le devis, l'ouverture pour un SAV
    // actionnable), mais le résultat se compare en jours, quel que soit le
    // type — c'est ce qui permet un tri unique « tous types confondus ».
    const joursDepuisJour = (dateISO) =>
      Math.round((new Date(aujourdhui + 'T00:00:00') - new Date(dateISO + 'T00:00:00')) / 86_400_000)
    const joursDepuisHorodatage = (ts) => Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000)

    // Un rappel manuel posé pour relancer un devis (note contenant « devis »,
    // ou dossier resté en Devis envoyé/Relance) et l'entrée automatique
    // « Devis sans réponse » (calculée sur l'étape) portent le même signal
    // sur le même dossier — deux lignes pour une seule décision à prendre.
    // Le rappel l'emporte : il est daté par Bruce lui-même, plus précis que
    // le seuil générique de 30j. relanceDevisIds retient les dossiers déjà
    // couverts pour exclure leur doublon de devisSansReponse plus bas.
    const relanceDevisIds = new Set()
    const elementsRappels = aRappeler.map((d) => {
      const estRelanceDevis =
        ['devis_envoye', 'relance'].includes(d.statut) ||
        (d.rappel_note ?? '').toLowerCase().includes('devis')
      if (estRelanceDevis) relanceDevisIds.add(d.id)
      const joursSansReponse = joursDevisSansReponse(d)
      const texteRappel = etatRappel(d.rappel_date, d.rappel_heure)?.texte
      return {
        cle: `rappel-${d.id}`,
        type: estRelanceDevis ? 'relance_devis' : 'rappel',
        dossier: d,
        joursRetard: joursDepuisJour(d.rappel_date),
        libelle: d.rappel_note || d.titre || TYPE_LABELS[d.type],
        // Porte les deux informations quand le devis a lui-même franchi le
        // seuil des 30j — un rappel de relance posé avant ce seuil n'a que
        // sa propre échéance à afficher.
        droite: joursSansReponse != null ? `${texteRappel} · ${joursSansReponse} j sans réponse` : texteRappel,
      }
    })
    const devisRestants = devisSansReponse.filter((d) => !relanceDevisIds.has(d.id))

    const elementsUrgents = [
      ...elementsRappels,
      ...savOuverts
        // Un SAV « en_attente » patiente sur un tiers (pièce, fournisseur) —
        // ce n'est pas un oubli de Bruce, il ne concourt donc pas ici (même
        // logique que `alerte={statut !== 'en_attente'}` dans la section
        // détaillée plus bas).
        .filter((d) => d.statut !== 'en_attente')
        .map((d) => ({
          cle: `sav-${d.id}`,
          type: 'sav',
          dossier: d,
          joursRetard: joursDepuisHorodatage(d.created_at),
          libelle: d.titre || 'SAV',
          droite: STATUTS_SAV_LABELS[d.statut] ?? d.statut,
        })),
      ...tachesEnRetard.map((t) => ({
        cle: `tache-${t.id}`,
        type: 'tache',
        dossier: t.dossier,
        tache: t,
        joursRetard: joursDepuisJour(t.echeance),
        libelle: t.texte,
        droite: etatEcheanceTache(t.echeance)?.texte,
      })),
      ...devisRestants.map((d) => ({
        cle: `devis-${d.id}`,
        type: 'devis',
        dossier: d,
        // Jours au-delà du seuil de 30j, pas le total depuis le changement
        // de statut : sinon un devis à J+31 (1 jour de vrai retard) battrait
        // à tort un rappel vieux de 2 jours, alors que les 30 premiers jours
        // sont un délai normal, pas un retard.
        joursRetard: joursDevisSansReponse(d) - SEUIL_DEVIS_SANS_REPONSE_JOURS,
        libelle: d.titre || TYPE_LABELS[d.type],
        droite: `${joursDevisSansReponse(d)} j sans réponse`,
      })),
    ].sort((a, b) => b.joursRetard - a.joursRetard)

    return {
      savOuverts,
      devisSansReponse,
      aRappeler,
      aVenir,
      tachesEnRetard,
      plansAProduire,
      reglements,
      elementsUrgents,
      duParPlans: reglements.length * 500,
      projection: somme(actifs),
      signe: somme(signes),
      facture: somme(factures),
      pourcentageObjectif: Math.round((somme(signes) / OBJECTIF_ANNUEL) * 100),
      totalActifsTousTypes: actifs.length + plansActifs.length + savOuverts.length,
      totalATraiter: aRappeler.length + savOuverts.length + tachesEnRetard.length,
      savEnRetard: savOuverts.filter((d) => d.statut !== 'en_attente').length,
      // Le trou le plus coûteux n'est pas dans le pipeline lointain : c'est une
      // commande signée sans montant, qui manque à l'objectif sans se voir.
      signesSansMontant: signes.filter((d) => d.montant_estime == null).length,
      nbSignes: signes.length,
      annee,
      // Ce qui basculera sur l'exercice suivant s'il n'est pas réglé d'ici là.
      reportables: signes.filter((d) => !ETAPES_FACTUREES.includes(d.statut)).length,
      chiffres: actifs.filter((d) => d.montant_estime != null).length,
      totalActifs: actifs.length,
      sansMontant: actifs.filter((d) => d.montant_estime == null),
      planFacture: dossiers.filter(
        (d) => d.type === 'plan' && d.remuneration_type === 'facture' && d.statut === 'solde'
      ).length,
    }
}

// Priorité du jour = le premier élément non ignoré (« Plus tard ») du tri
// unique ; « Aussi à traiter » garde tout le monde, y compris les ignorés.
export function calculerBoard(elementsUrgents, ignores) {
    const disponibles = elementsUrgents.filter((e) => !ignores.has(e.cle))
    const prioriteJour = disponibles[0] ?? null
    const aussiATraiter = elementsUrgents.filter((e) => e.cle !== prioriteJour?.cle)
    // Un contact (= un dossier) ne figure qu'une fois dans la feuille « À
    // appeler », même s'il porte plusieurs éléments urgents (deux tâches, un
    // rappel et un devis…) : son premier élément non ignoré le représente, les
    // autres sont comptés dans son motif. « Plus tard » n'écarte que l'élément
    // représenté : le suivant du même dossier prend alors la place.
    // « Aussi à traiter », dans la feuille, ne répète pas les dossiers listés.
    const contacts = []
    const parDossier = new Map()
    for (const e of disponibles) {
      const deja = parDossier.get(e.dossier.id)
      if (deja) deja.autres.push(e)
      else {
        const c = { ...e, autres: [] }
        parDossier.set(e.dossier.id, c)
        contacts.push(c)
      }
    }
    const aussiHorsContacts = aussiATraiter.filter((e) => !parDossier.has(e.dossier.id))
    return { prioriteJour, aussiATraiter, disponibles, contacts, aussiHorsContacts }
}

// Dossiers « en attente » : la plus longue attente en tête.
export function calculerEnAttente(dossiers) {
  return dossiers
    .filter(estEnAttente)
    .sort((a, b) => (joursEnAttente(b) ?? joursDepuisStatut(b) ?? 0) - (joursEnAttente(a) ?? joursDepuisStatut(a) ?? 0))
}

// Potentiel à trancher (par offre) : « N devis · M dossiers » — même calcul que le Dashboard.
export function calculerATrancherPar(devisSansMontant, dossiers) {
    const ouvertes = offresPlat(devisSansMontant).filter((o) => o.etat === 'a_trancher')
    const parDossier = new Map()
    for (const o of ouvertes) parDossier.set(o.dossier_id, (parDossier.get(o.dossier_id) ?? new Set()).add(o.fichier_id))
    const lignes = [...parDossier.entries()]
      .map(([id, devis]) => ({ dossier: dossiers.find((d) => d.id === id), n: devis.size }))
      .filter((l) => l.dossier)
    return { nbDevis: new Set(ouvertes.map((o) => o.fichier_id)).size, nbDossiers: parDossier.size, lignes }
}
