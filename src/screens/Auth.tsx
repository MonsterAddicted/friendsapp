import { useEffect, useState, type FormEvent } from 'react'
import { loginProviders, supabase } from '../lib/supabase'
import { t } from '../lib/i18n'

// If Google/Apple sign-in failed, Supabase sends the person back with ?error=… (or #error=…). Read it once, then tidy the URL.
const oauthError = (() => {
  const q = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.slice(1))
  const e = q.get('error_description') ?? h.get('error_description') ?? q.get('error') ?? h.get('error')
  if (e) window.history.replaceState(null, '', '/')
  return e
})()

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [providers, setProviders] = useState({ google: false, apple: false })
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    loginProviders().then(setProviders)
    if (oauthError) setError(t("Sign-in with Google or Apple didn't work. Try again, or use email."))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message === 'Invalid login credentials' ? t('Wrong email or password.') : error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else if (!data.session) setInfo(t('Almost done! Open the email we sent you and tap the link, then sign in.'))
    }
    setBusy(false)
  }

  async function oauth(provider: 'google' | 'apple') {
    setError('')
    setLeaving(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      // Back to the same page afterwards. Invite links (?join=, ?add=) are remembered in the meantime.
      options: { redirectTo: window.location.origin, queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined },
    })
    if (error) {
      setLeaving(false)
      setError(t('This sign-in is not set up yet. Use email for now.'))
    }
  }

  const social = providers.google || providers.apple

  return (
    <div className="center-screen">
      <div className="auth">
        <div className="logo-mark">👋</div>
        <h1 className="title">friendsapp</h1>
        <p className="muted tagline">{t("See what your friends are up to, where they are, and who's in for tonight.")}</p>

        <div className="seg two">
          <button className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')} type="button">
            {t('Sign in')}
          </button>
          <button className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')} type="button">
            {t('Create account')}
          </button>
        </div>

        <form className="stack" onSubmit={submit}>
          <input
            id="email"
            className="input"
            type="email"
            placeholder={t('Email')}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            id="password"
            className="input"
            type="password"
            placeholder={mode === 'up' ? t('Password (at least 6 characters)') : t('Password')}
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="error">{error}</p>}
          {info && <p className="info">{info}</p>}
          <button className="btn block" disabled={busy}>
            {mode === 'in' ? t('Sign in') : t('Create account')}
          </button>
        </form>

        {social && <div className="or">{t('or')}</div>}
        {providers.google && (
          <button className="btn ghost block google" onClick={() => oauth('google')} type="button" disabled={leaving}>
            <GoogleLogo />
            {t('Continue with Google')}
          </button>
        )}
        {providers.apple && (
          <button className="btn apple block" onClick={() => oauth('apple')} type="button" disabled={leaving}>
            {t('Continue with Apple')}
          </button>
        )}
      </div>
    </div>
  )
}
