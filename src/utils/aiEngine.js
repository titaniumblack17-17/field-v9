import { ETAPES, ETAPE_MAP } from '../data/db'

const TRIGGERS = [
  { etape: 'devis-envoye', mots: ['envoyé le devis','devis envoyé','j\'ai envoyé','devis transmis','devis parti'], message: 'Devis envoyé détecté → passer en "Devis envoyé" ?' },
  { etape: 'relance', mots: ['relance','pas de retour','aucun retour','pas répondu','silence'], message: 'Relance détectée → passer en "Relance" ?' },
  { etape: 'nego', mots: ['négociation','remise','trop cher','réduction','discount'], message: 'Négociation → passer en "Négociation" ?' },
  { etape: 'valide', mots: ['bon de commande signé','signé','accord','validé','ok pour','go'], message: 'Accord détecté → passer en "Devis validé" ?' },
  { etape: 'commande', mots: ['commande passée','commandé','bc envoyé','bon de commande envoyé'], message: 'Commande passée → passer en "Commande" ?' },
  { etape: 'install', mots: ['installation','technicien','livraison ok','livré','installé'], message: 'Installation → passer en "Installation" ?' },
  { etape: 'suivi', mots: ['installation terminée','fin d\'installation','terminé','tout fonctionne'], message: 'Installation terminée → passer en "Suivi" ?' },
  { etape: 'sav', mots: ['panne','problème','sav','dysfonctionnement','ne fonctionne pas'], message: 'SAV détecté → ouvrir un dossier SAV ?' },
  { etape: 'perdu', mots: ['perdu','refus','a refusé','pas intéressé','concurrent','abandonné'], message: 'Dossier perdu → passer en "Perdu" ?' },
]

const ACTION_PATTERNS = [
  { pattern: /rdv|rendez.?vous/i, action: 'Planifier un RDV', icon: '📅' },
  { pattern: /rappeler|rappel/i, action: 'Rappeler le praticien', icon: '📞' },
  { pattern: /envoyer|mail|email/i, action: 'Envoyer un mail', icon: '✉️' },
  { pattern: /devis|chiffrage/i, action: 'Préparer le devis', icon: '📄' },
  { pattern: /financement|cetelem/i, action: 'Dossier financement', icon: '💰' },
  { pattern: /plan|implantation/i, action: 'Réaliser le plan', icon: '📐' },
  { pattern: /relance/i, action: 'Relancer le prospect', icon: '🔁' },
]

export function analyserNote(texte, etapeActuelle) {
  const txt = texte.toLowerCase()
  const resultat = { etapeSuggere: null, messageSuggestion: null, actionsSuggeres: [] }
  for (const trigger of TRIGGERS) {
    const idxActuel = ETAPES.findIndex(e => e.id === etapeActuelle)
    const idxCible = ETAPES.findIndex(e => e.id === trigger.etape)
    if (idxCible <= idxActuel && !['sav','perdu'].includes(trigger.etape)) continue
    if (trigger.mots.some(m => txt.includes(m))) {
      resultat.etapeSuggere = trigger.etape
      resultat.messageSuggestion = trigger.message
      break
    }
  }
  for (const ap of ACTION_PATTERNS) {
    if (ap.pattern.test(texte)) resultat.actionsSuggeres.push({ action: ap.action, icon: ap.icon })
  }
  return resultat
}

export function calculerProjectionCA(dossiers) {
  const TAUX = { 'prospect':0.20,'devis-cours':0.45,'devis-envoye':0.55,'relance':0.35,'nego':0.65,'valide':0.90,'plan':0.92,'cdc':0.95,'commande':0.98,'reception':0.99,'financement':0.99,'install-prog':1,'install':1,'suivi':1,'sav':1,'perdu':0 }
  let caWeighted=0, caFerme=0, caPotentiel=0
  dossiers.forEach(d => {
    const m = d.montantEstime || 0
    const t = TAUX[d.etape] || 0
    caWeighted += m * t
    if (['install','suivi','sav'].includes(d.etape)) caFerme += m
    else if (d.etape !== 'perdu') caPotentiel += m
  })
  const objectif = 5000000
  return { caWeighted: Math.round(caWeighted), caFerme: Math.round(caFerme), caPotentiel: Math.round(caPotentiel), objectif, txObjectif: Math.min(100, Math.round((caWeighted/objectif)*100)), prospectsNeeded: Math.max(0, Math.round((objectif-caWeighted)/35000/0.2)) }
}

export function genererBrief(dossiers, cabinets, activites, rappels) {
  const cabMap = Object.fromEntries(cabinets.map(c => [c.id, c]))
  const actMap = {}
  activites.forEach(a => { if (!actMap[a.dossierId]) actMap[a.dossierId]=[]; actMap[a.dossierId].push(a) })
  const maintenant = new Date()
  const actifs = dossiers.filter(d => d.etape !== 'perdu')
  const relancesEnRetard = actifs.filter(d => {
    if (d.etape !== 'devis-envoye') return false
    const acts = actMap[d.id] || []
    const derniere = acts.slice(-1)[0]
    if (!derniere) return true
    return (maintenant - new Date(derniere.createdAt)) / 86400000 > 5
  })
  const sansActivite = actifs.filter(d => {
    if (['install','suivi','sav'].includes(d.etape)) return false
    const acts = actMap[d.id] || []
    const derniere = acts.slice(-1)[0]
    if (!derniere) return true
    return (maintenant - new Date(derniere.createdAt)) / 86400000 > 7
  })
  const fortEnjeu = actifs.filter(d => (d.montantEstime||0)>50000 && !d.montantSigne).sort((a,b)=>(b.montantEstime||0)-(a.montantEstime||0)).slice(0,3)
  const fmt = n => !n?'—':n>=1000?(n/1000).toFixed(0)+' k€':n+' €'
  const sections = []
  if (relancesEnRetard.length>0) sections.push({ titre:'🔁 Relances en retard', urgence:'haute', items: relancesEnRetard.map(d=>({ label:cabMap[d.cabinetId]?.praticien||'—', detail:`Devis envoyé · ${fmt(d.montantEstime)} · Sans retour > 5j`, dossierId:d.id })) })
  if (sansActivite.length>0) sections.push({ titre:'😴 Sans activité depuis 7j', urgence:'basse', items: sansActivite.slice(0,4).map(d=>({ label:cabMap[d.cabinetId]?.praticien||'—', detail:`${ETAPE_MAP[d.etape]?.label} · ${fmt(d.montantEstime)}`, dossierId:d.id })) })
  if (fortEnjeu.length>0) sections.push({ titre:'💰 Forts enjeux', urgence:'info', items: fortEnjeu.map(d=>({ label:cabMap[d.cabinetId]?.praticien||'—', detail:`${ETAPE_MAP[d.etape]?.label} · ${fmt(d.montantEstime)}`, dossierId:d.id })) })
  const pipelineTotal = actifs.reduce((s,d)=>s+(d.montantEstime||0),0)
  return { date: maintenant.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}), sections, pipeline:{ total:pipelineTotal, dossierActifs:actifs.length }, creneauxSuggeres: relancesEnRetard.length>0?[{label:'Relances téléphoniques',duree:'1h',moment:'Matin 9h–10h'},{label:'Chiffrages en cours',duree:'1h30',moment:'Milieu de matinée'}]:[{label:'Chiffrages en cours',duree:'1h30',moment:'Milieu de matinée'}] }
}
