import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Accès mono-utilisateur : un seul email autorisé, pas de formulaire de
// saisie d'adresse. Code à 6 chiffres plutôt que lien cliquable — un lien
// magique ouvert depuis l'app Mail sur iPhone atterrit dans Safari, pas
// dans la PWA installée (contexte de stockage différent), ce qui aurait
// cassé la connexion précisément sur l'usage terrain le plus fréquent.
const EMAIL_AUTORISE = 'titaniumblack17@gmail.com'

export default function Login() {
  // 'email' → bouton d'envoi ; 'envoi' → requête en cours ; 'code' → saisie
  // du code reçu ; 'verification' → validation en cours.
  const [etape, setEtape] = useState('email')
  const [code, setCode] = useState('')
  const [erreur, setErreur] = useState('')

  const envoyerCode = async () => {
    setEtape('envoi')
    setErreur('')
    const { error } = await supabase.auth.signInWithOtp({
      email: EMAIL_AUTORISE,
      options: { shouldCreateUser: true },
    })
    if (error) {
      setErreur(error.message)
      setEtape('email')
      return
    }
    setEtape('code')
  }

  const valider = async (e) => {
    e.preventDefault()
    setEtape('verification')
    setErreur('')
    const { error } = await supabase.auth.verifyOtp({
      email: EMAIL_AUTORISE,
      token: code,
      type: 'email',
    })
    if (error) {
      setErreur('Code invalide ou expiré — renvoie-en un nouveau.')
      setEtape('code')
      return
    }
    // Succès : onAuthStateChange (useSession) met à jour la session, App
    // re-rend automatiquement sur l'app normale.
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-fond">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-texte">Field V9</h1>
        <p className="text-sm text-texte-faible">
          Accès réservé — code envoyé à {EMAIL_AUTORISE}.
        </p>

        {etape === 'email' || etape === 'envoi' ? (
          <button
            onClick={envoyerCode}
            disabled={etape === 'envoi'}
            className="w-full rounded-carte bg-accent text-white py-2.5 font-medium disabled:opacity-60"
          >
            {etape === 'envoi' ? 'Envoi du code…' : 'Recevoir un code de connexion'}
          </button>
        ) : (
          <form onSubmit={valider} className="space-y-3">
            <p className="text-sm text-texte-faible">
              Code à 6 chiffres reçu par email, valide quelques minutes.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-imbrique border border-separateur bg-carte px-3 py-2.5 text-center text-lg tracking-[0.4em] text-texte"
              placeholder="000000"
            />
            <button
              type="submit"
              disabled={etape === 'verification' || code.length !== 6}
              className="w-full rounded-carte bg-accent text-white py-2.5 font-medium disabled:opacity-60"
            >
              {etape === 'verification' ? 'Vérification…' : 'Valider'}
            </button>
            <button
              type="button"
              onClick={envoyerCode}
              className="w-full text-sm text-texte-faible underline"
            >
              Renvoyer un code
            </button>
          </form>
        )}

        {erreur && <p className="text-sm text-erreur">{erreur}</p>}
      </div>
    </div>
  )
}
