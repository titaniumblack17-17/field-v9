import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { tailleFile } from '../lib/fileAttente'
import useConfirm from '../hooks/useConfirm'
import { libelleVersion } from '../lib/version'

export default function Reglages({ onBack, email }) {
  const [confirmer, boiteConfirmation] = useConfirm()
  const [enCours, setEnCours] = useState(false)

  const deconnecter = async () => {
    const attente = tailleFile()
    const detail = attente > 0 ? `${attente} action${attente > 1 ? 's' : ''} en attente d'envoi restent sur cet appareil et partiront à la prochaine connexion.` : 'Un code vous sera redemandé à la prochaine ouverture.'
    if (!(await confirmer(detail, { titre: 'Se déconnecter ?', confirmLabel: 'Se déconnecter' }))) return
    setEnCours(true)
    // Révocation côté serveur si le réseau répond vite ; la session locale est de toute façon retirée (fonctionne hors ligne).
    await Promise.race([supabase.auth.signOut().catch(() => {}), new Promise((r) => setTimeout(r, 2500))])
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    // useSession reçoit SIGNED_OUT : l'écran de connexion prend la place.
  }

  return (
    <div className="min-h-screen bg-fond">
      <header className="px-4 pt-6 pb-3 flex items-center gap-2">
        <button onClick={onBack} className="text-accent text-sm font-semibold h-11 -ml-2 pl-2 pr-1 flex items-center">
          ← Retour
        </button>
        <h1 className="text-lg font-bold text-texte">Réglages</h1>
      </header>
      <main className="px-4 pb-10 space-y-4">
        <section aria-label="Compte" className="bg-carte rounded-xl px-4 py-3">
          <p className="text-xs text-texte-doux">Connecté</p>
          <p className="text-[15px] font-semibold text-texte break-all">{email ?? '—'}</p>
          <button onClick={deconnecter} disabled={enCours} className="mt-3 w-full min-h-12 rounded-carte border border-erreur/60 text-erreur font-semibold disabled:opacity-60">
            {enCours ? 'Déconnexion…' : 'Se déconnecter'}
          </button>
        </section>
        <p data-testid="version" className="text-center text-[11px] text-texte-faible tabular-nums">{libelleVersion()}</p>
      </main>
      {boiteConfirmation}
    </div>
  )
}
