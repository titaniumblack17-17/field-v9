// Analyse d'un export vCard (RFC 6350) de Contacts.app (macOS) — logique
// partagée entre les scripts qui complètent les fiches clients Field
// (importer-contacts-mac.mjs) et ceux qui peuplent le carnet de référence
// persistant (peupler-carnet.mjs).

// --- Lecture vCard ---
// Une ligne qui commence par une espace ou une tabulation est la suite de la
// précédente (RFC 6350, "line folding") — un standard qu'Apple applique sur
// les valeurs longues (ex. une adresse complète).
const deplierLignes = (texte) =>
  texte.split(/\r\n|\r|\n/).reduce((lignes, ligne) => {
    if (/^[ \t]/.test(ligne) && lignes.length) {
      lignes[lignes.length - 1] += ligne.slice(1)
    } else {
      lignes.push(ligne)
    }
    return lignes
  }, [])

const parserLigne = (ligne) => {
  const deuxPoints = ligne.indexOf(':')
  if (deuxPoints === -1) return null
  const avant = ligne.slice(0, deuxPoints)
  const valeur = ligne.slice(deuxPoints + 1)
  const [nomBrut, ...params] = avant.split(';')
  const nom = nomBrut.toUpperCase()
  const types = params
    .filter((p) => /^type=/i.test(p))
    .flatMap((p) => p.slice(5).split(','))
    .map((t) => t.toUpperCase())
  return { nom, types, valeur }
}

export const parserVCards = (texte) => {
  const lignes = deplierLignes(texte)
  const cartes = []
  let courante = null
  for (const ligneBrute of lignes) {
    const ligne = ligneBrute.trim()
    if (/^BEGIN:VCARD$/i.test(ligne)) {
      courante = []
      continue
    }
    if (/^END:VCARD$/i.test(ligne)) {
      if (courante) cartes.push(courante)
      courante = null
      continue
    }
    if (!courante) continue
    const champ = parserLigne(ligne)
    if (champ) courante.push(champ)
  }
  return cartes
}

export const chiffres = (v) => (v ?? '').replace(/\D/g, '')

// « +33 6 23 02 60 14 » et « 0623026014 » sont le même numéro écrit
// différemment — sans cette normalisation, un carnet d'adresses qui mélange
// les deux formats pour la même personne se lirait à tort comme deux
// numéros différents (faux conflit) au lieu d'un accord.
export const clefTelephone = (v) => {
  let d = chiffres(v)
  if (d.startsWith('33') && d.length === 11) d = '0' + d.slice(2)
  if (d.startsWith('0033') && d.length === 13) d = '0' + d.slice(4)
  return d
}

// Plan de numérotation français : 06/07 = mobile, 01-05/09 = fixe. Sert de
// repli quand la fiche du carnet n'étiquette pas elle-même le numéro
// (« CELL »/« WORK ») — plus fiable que « le premier numéro trouvé », qui
// rangeait par exemple un standard en 01 dans le champ portable.
export const estMobileFR = (v) => /^0[67]/.test(clefTelephone(v))
export const estFixeFR = (v) => /^0[1-59]/.test(clefTelephone(v))
export const estNumeroFR = (v) => /^0\d{9}$/.test(clefTelephone(v))

// Un numéro non-français (pas 10 chiffres) est extrait tel quel plutôt que
// rejeté : contrairement à la dictée, une entrée de carnet d'adresses n'a
// pas de raison d'être mal transcrite, et rejeter par principe perdrait des
// numéros valides à l'étranger.
const chiffresEnNumero = (v) => {
  const digits = chiffres(v)
  return digits.length >= 8 ? v.trim() : null
}

export const formaterTelephone = (v) => {
  const d = clefTelephone(v)
  if (d.length === 10) return d.match(/.{2}/g).join(' ')
  return v.trim()
}

export const normaliser = (v) =>
  (v ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Un contact peut porter plusieurs TEL/EMAIL avec des TYPE différents — on
// devine portable/cabinet par l'étiquette Apple d'abord, puis par le plan de
// numérotation français. Le fixe est cherché AVANT le repli positionnel du
// portable : un numéro seul, non étiqueté, au format 01-05/09 doit aller au
// cabinet et non au portable (sinon un standard de cabinet se retrouve
// rangé comme numéro personnel du praticien). Un numéro ni CELL/WORK ni
// reconnaissable (étranger, format inhabituel) sert de dernier repli au
// portable plutôt que d'être perdu — mais seulement s'il reste seul en
// lice, jamais au prix d'écraser un vrai fixe détecté par ailleurs.
export const extraireContact = (champs) => {
  const val = (nom) => champs.find((c) => c.nom === nom)?.valeur?.trim() || null

  const tousTels = champs.filter((c) => c.nom === 'TEL')
  let portable = tousTels.find((c) => c.types.some((t) => ['CELL', 'IPHONE', 'MOBILE'].includes(t)))
  let fixe = tousTels.find((c) => c !== portable && c.types.includes('WORK'))
  if (!fixe) fixe = tousTels.find((c) => c !== portable && estFixeFR(c.valeur))
  if (!portable) portable = tousTels.find((c) => c !== fixe && estMobileFR(c.valeur))
  if (!portable) portable = tousTels.find((c) => c !== fixe)

  const tousEmails = champs.filter((c) => c.nom === 'EMAIL')
  const emailPerso = tousEmails.find((c) => !c.types.includes('WORK')) ?? tousEmails[0]
  const emailPro = tousEmails.find((c) => c !== emailPerso && c.types.includes('WORK'))

  // ADR: boîte postale;complément;rue;ville;région;code postal;pays
  const adr = champs.find((c) => c.nom === 'ADR')
  let adresse = null
  let ville = null
  let codePostal = null
  if (adr) {
    const parties = adr.valeur.split(';')
    adresse = [parties[2], parties[1]].filter(Boolean).join(' ').trim() || null
    ville = parties[3]?.trim() || null
    codePostal = parties[5]?.trim() || null
  }

  // N: Nom;Prénom;deuxième prénom;particule;suffixe — repli sur FN (nom
  // complet affiché) si N est absent, en supposant "Prénom Nom".
  const n = val('N')
  let nomFamille = null
  let prenom = null
  if (n) {
    const [nf, pr] = n.split(';')
    nomFamille = nf?.trim() || null
    prenom = pr?.trim() || null
  }
  if (!nomFamille) {
    const fn = val('FN')
    if (fn) {
      const mots = fn.trim().split(/\s+/)
      nomFamille = mots.length > 1 ? mots.slice(1).join(' ') : mots[0]
      prenom = mots.length > 1 ? mots[0] : null
    }
  }

  return {
    nomFamille,
    prenom,
    telephonePortable: portable ? chiffresEnNumero(portable.valeur) : null,
    telephoneCabinet: fixe ? chiffresEnNumero(fixe.valeur) : null,
    email: emailPerso?.valeur || null,
    email_cabinet: emailPro?.valeur || null,
    adresse,
    ville,
    code_postal: codePostal,
  }
}
