import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { DELAI_RENVOI_S, dernierEmail, effacerRetourLien, messageConnexion, messageLien, retenirEmail, retourLienInitial } from '../lib/session'
import { libelleVersion } from '../lib/version'

// Connexion par LIEN reçu par e-mail (mode principal) ou par code à 6 chiffres (« J'ai reçu un code »). Un seul
// utilisateur existe côté Supabase ; `shouldCreateUser: false` empêche toute autre adresse de se créer un compte.
// Flux implicite : le lien fonctionne même ouvert dans un autre navigateur que celui qui l'a demandé. Sur iPhone,
// un lien ouvert depuis Mail atterrit dans Safari, dont le stockage est séparé de l'app installée : d'où le code.
export default function Login() {
  // email → envoi → lien (lien envoyé) → code → verification ; 'retour' : lien en cours de lecture
  const [depart] = useState(retourLienInitial)
  const [etape, setEtape] = useState(depart.jetons ? 'retour' : 'email')
  const [email, setEmail] = useState(dernierEmail)
  const [code, setCode] = useState('')
  const [erreur, setErreur] = useState(() => (depart.erreur ? messageLien(depart.erreur) : ''))
  const [lienRefuse] = useState(Boolean(depart.erreur))
  // L'adresse d'ouverture n'est prise en compte qu'une fois : une déconnexion plus tard n'affiche pas un vieux message.
  useEffect(() => effacerRetourLien(), [])
  const [envoyeA, setEnvoyeA] = useState(null)
  const [finRenvoi, setFinRenvoi] = useState(0) // instant (ms) à partir duquel un nouvel envoi est possible
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const restant = Math.max(0, Math.ceil((finRenvoi - maintenant) / 1000))
  const verificationEnCours = useRef(false)

  // Compte à rebours calculé sur l'heure réelle (échéance) : une app mise en arrière-plan puis rouverte affiche le bon délai.
  useEffect(() => {
    if (finRenvoi <= Date.now()) return undefined
    const t = setInterval(() => setMaintenant(Date.now()), 1000)
    return () => clearInterval(t)
  }, [finRenvoi])

  // Lien en cours de lecture : si la session n'arrive pas (lien illisible), on rend la main au lieu de rester bloqué.
  useEffect(() => {
    if (etape !== 'retour') return undefined
    const t = setTimeout(() => {
      setErreur('Connexion impossible avec ce lien. Demandez-en un nouveau.')
      setEtape('email')
    }, 8000)
    return () => clearTimeout(t)
  }, [etape])

  // depuis : écran d'où part la demande ('email' | 'lien' | 'code'). Le même envoi sert au lien et au code (même message).
  const envoyer = async (depuis, e) => {
    e?.preventDefault()
    const adresse = email.trim().toLowerCase()
    if (!adresse) return
    if (depuis === 'email') setEtape('envoi')
    setErreur('')
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: adresse,
        // Le lien ramène sur l'adresse d'où la demande est faite (production ou version de test).
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/` },
      })
      if (error) throw error
      retenirEmail(adresse)
      setEmail(adresse)
      setEnvoyeA(Date.now())
      setMaintenant(Date.now())
      setFinRenvoi(Date.now() + DELAI_RENVOI_S * 1000)
      setCode('')
      setEtape(depuis === 'code' ? 'code' : 'lien')
    } catch (err) {
      setErreur(messageConnexion(err, { phase: 'envoi' }))
      setEtape(depuis)
    }
  }

  const verifier = async (valeur = code) => {
    if (verificationEnCours.current || valeur.length !== 6) return
    verificationEnCours.current = true
    setEtape('verification')
    setErreur('')
    try {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: valeur, type: 'email' })
      if (error) throw error
      // Succès : onAuthStateChange (useSession) bascule sur l'application.
    } catch (err) {
      setErreur(messageConnexion(err, { phase: 'verification', envoyeA }))
      setCode('')
      setEtape('code')
    } finally {
      verificationEnCours.current = false
    }
  }

  const saisirCode = (e) => {
    const valeur = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(valeur)
    if (valeur.length === 6) verifier(valeur) // le code collé par iOS (suggestion du clavier) se valide seul
  }

  const enCode = etape === 'code' || etape === 'verification'
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-fond">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-texte">Field V9</h1>

        {etape === 'retour' && (
          <p role="status" className="text-sm text-texte-doux">Connexion en cours…</p>
        )}

        {(etape === 'email' || etape === 'envoi') && (
          <form onSubmit={(e) => envoyer('email', e)} className="space-y-3">
            <p className="text-sm text-texte-doux">Un lien de connexion vous est envoyé par e-mail.</p>
            <label htmlFor="email" className="block text-xs text-texte-doux px-1">Adresse e-mail</label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full min-h-12 rounded-imbrique border border-separateur bg-carte px-3 text-texte"
            />
            <button type="submit" disabled={etape === 'envoi' || !email.trim()} className="w-full min-h-12 rounded-carte bg-accent text-white font-semibold disabled:opacity-60">
              {etape === 'envoi' ? 'Envoi du lien…' : lienRefuse ? 'Renvoyer un lien' : 'Recevoir le lien'}
            </button>
          </form>
        )}

        {etape === 'lien' && (
          <div className="space-y-3">
            <p className="text-[15px] text-texte">
              Lien envoyé à <span className="font-medium break-all">{email}</span>. Ouvrez-le sur cet appareil.
            </p>
            <p className="text-sm text-texte-doux">Sur iPhone, ouvrez le lien dans Safari.</p>
            <button type="button" onClick={() => envoyer('lien')} disabled={restant > 0} className="w-full min-h-12 rounded-carte border border-separateur bg-carte text-texte font-medium disabled:text-texte-faible">
              {restant > 0 ? `Renvoyer le lien (${restant} s)` : 'Renvoyer le lien'}
            </button>
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => { setErreur(''); setEtape('code') }} className="min-h-11 text-sm text-texte-doux underline">
                J'ai reçu un code
              </button>
              <button type="button" onClick={() => { setEtape('email'); setEnvoyeA(null); setErreur('') }} className="min-h-11 text-sm text-texte-doux">
                Changer d'adresse
              </button>
            </div>
          </div>
        )}

        {enCode && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              verifier()
            }}
            className="space-y-3"
          >
            <p className="text-sm text-texte-doux">
              Code envoyé à <span className="text-texte font-medium">{email}</span> (dans le même e-mail que le lien).
            </p>
            <label htmlFor="code" className="block text-xs text-texte-doux px-1">Code à 6 chiffres</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={saisirCode}
              disabled={etape === 'verification'}
              placeholder="000000"
              className="w-full min-h-14 rounded-imbrique border border-separateur bg-carte px-3 text-center text-2xl tracking-[0.4em] tabular-nums text-texte"
            />
            <button type="submit" disabled={etape === 'verification' || code.length !== 6} className="w-full min-h-12 rounded-carte bg-accent text-white font-semibold disabled:opacity-60">
              {etape === 'verification' ? 'Vérification…' : 'Valider'}
            </button>
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => envoyer('code')} disabled={restant > 0} className="min-h-11 text-sm text-accent-vif font-medium disabled:text-texte-faible">
                {restant > 0 ? `Renvoyer le code (${restant} s)` : 'Renvoyer le code'}
              </button>
              <button type="button" onClick={() => { setErreur(''); setEtape('lien') }} className="min-h-11 text-sm text-texte-doux">
                Retour
              </button>
            </div>
          </form>
        )}

        {erreur && (
          <p role="alert" className="text-sm text-erreur">
            {erreur}
          </p>
        )}
      </div>
      <p data-testid="version" className="mt-10 text-[11px] text-texte-faible tabular-nums">{libelleVersion()}</p>
    </main>
  )
}
