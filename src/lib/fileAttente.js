// File d'écriture hors-ligne : une action qui échoue par manque de réseau
// (dictée, note, changement d'étape) est mise en attente ici plutôt que
// perdue, et rejouée automatiquement au retour du réseau. Vit dans
// localStorage pour survivre à un rechargement de page pendant la coupure.
const CLE = 'fv9:file-attente'
const ecouteurs = new Set()

const lireFile = () => {
  try {
    return JSON.parse(localStorage.getItem(CLE) ?? '[]')
  } catch {
    return []
  }
}

const ecrireFile = (file) => {
  try {
    localStorage.setItem(CLE, JSON.stringify(file))
  } catch {
    // localStorage plein/indisponible : rien de plus à faire ici, l'appelant
    // a déjà tenté l'envoi direct avant d'en arriver là.
  }
  ecouteurs.forEach((cb) => cb(file.length))
}

export const mettreEnFile = (action) => {
  const file = lireFile()
  file.push({ ...action, id: crypto.randomUUID(), horodatage: new Date().toISOString() })
  ecrireFile(file)
}

export const tailleFile = () => lireFile().length

// Pour l'indicateur d'UI (Tâche 6) : notifie à chaque changement de taille,
// retourne la fonction de désabonnement.
export const ecouterTailleFile = (callback) => {
  ecouteurs.add(callback)
  return () => ecouteurs.delete(callback)
}

// Deux déclencheurs indépendants (l'effet sur `enLigne` et le filet de
// secours sur `visibilitychange`, voir App.jsx) peuvent réagir au même
// retour de réseau presque simultanément. Sans ce verrou, un second appel
// démarré avant que le premier n'ait écrit sa progression relirait la même
// file et rejouerait la même action une deuxième fois.
let enCours = false

/**
 * Rejoue chaque action en attente, dans l'ordre, via `executer` (fourni par
 * l'appelant — lui seul sait comment envoyer chaque type d'action, voir
 * Tâches 7-9). Une action qui échoue encore reste en file pour la prochaine
 * tentative ; le vidage s'arrête au premier échec pour garder l'ordre
 * d'origine plutôt que de rejouer dans le désordre. Si un vidage est déjà en
 * cours, cet appel ne fait rien plutôt que de retraiter la même tête de file.
 *
 * Le résultat porte `erreur` (chaîne lisible « type: message ») quand le
 * vidage s'est arrêté sur un échec — jusqu'ici cette erreur était juste
 * avalée (`catch { break }`), rendant indiscernable « la sonde a cru le
 * réseau bon mais l'action a quand même échoué » de tout autre blocage.
 */
export async function viderFile(executer) {
  if (enCours) return { traitees: 0, restantes: tailleFile() }
  enCours = true
  try {
    const file = lireFile()
    const restantes = [...file]
    let erreur
    while (restantes.length) {
      const action = restantes[0]
      try {
        await executer(action)
        restantes.shift()
        ecrireFile(restantes)
      } catch (e) {
        erreur = `${action.type}: ${e?.message ?? String(e)}`
        break
      }
    }
    return {
      traitees: file.length - restantes.length,
      restantes: restantes.length,
      ...(erreur && { erreur }),
    }
  } finally {
    enCours = false
  }
}
