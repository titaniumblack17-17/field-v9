import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { DELAI_RENVOI_S, dernierEmail, messageConnexion, retenirEmail } from '../lib/session'
import { libelleVersion } from '../lib/version'

// Connexion par code à 6 chiffres envoyé par e-mail (jamais un lien : ouvert depuis Mail sur iPhone, un lien
// atterrit dans Safari et non dans l'app installée, dont le stockage est séparé). Un seul utilisateur existe côté
// Supabase ; `shouldCreateUser: false` empêche toute autre adresse de se créer un compte.
export default function Login() {
  const [etape, setEtape] = useState('email') // email → envoi → code → verification
  const [email, setEmail] = useState(dernierEmail)
  const [code, setCode] = useState('')
  const [erreur, setErreur] = useState('')
  const [envoyeA, setEnvoyeA] = useState(null)
  const [finRenvoi, setFinRenvoi] = useState(0) // instant (ms) à partir duquel un nouveau code peut être demandé
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const restant = Math.max(0, Math.ceil((finRenvoi - maintenant) / 1000))
  const verificationEnCours = useRef(false)

  // Compte à rebours visible avant de pouvoir renvoyer un code. Calculé sur l'heure réelle (échéance), pas en décomptant
  // des ticks : une app mise en arrière-plan puis rouverte affiche le bon délai.
  useEffect(() => {
    if (finRenvoi <= Date.now()) return undefined
    const t = setInterval(() => setMaintenant(Date.now()), 1000)
    return () => clearInterval(t)
  }, [finRenvoi])

  const envoyerCode = async (e) => {
    e?.preventDefault()
    const adresse = email.trim().toLowerCase()
    if (!adresse) return
    setEtape('envoi')
    setErreur('')
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: adresse, options: { shouldCreateUser: false } })
      if (error) throw error
      retenirEmail(adresse)
      setEmail(adresse)
      setEnvoyeA(Date.now())
      setMaintenant(Date.now())
      setFinRenvoi(Date.now() + DELAI_RENVOI_S * 1000)
      setCode('')
      setEtape('code')
    } catch (err) {
      setErreur(messageConnexion(err, { phase: 'envoi' }))
      // Un renvoi refusé depuis l'étape du code laisse l'écran du code ; une première demande revient au formulaire.
      setEtape(envoyeA ? 'code' : 'email')
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

        {!enCode ? (
          <form onSubmit={envoyerCode} className="space-y-3">
            <p className="text-sm text-texte-doux">Un code à 6 chiffres vous est envoyé par e-mail.</p>
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
              {etape === 'envoi' ? 'Envoi du code…' : 'Recevoir un code'}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              verifier()
            }}
            className="space-y-3"
          >
            <p className="text-sm text-texte-doux">
              Code envoyé à <span className="text-texte font-medium">{email}</span>.
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
              <button type="button" onClick={envoyerCode} disabled={restant > 0} className="min-h-11 text-sm text-accent-vif font-medium disabled:text-texte-faible">
                {restant > 0 ? `Renvoyer le code (${restant} s)` : 'Renvoyer le code'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEtape('email')
                  setEnvoyeA(null)
                  setErreur('')
                }}
                className="min-h-11 text-sm text-texte-doux"
              >
                Changer d'adresse
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
