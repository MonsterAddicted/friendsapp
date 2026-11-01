import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { t } from '../lib/i18n'

// Apple login needs an Apple Developer account. Turn it on with VITE_APPLE_LOGIN=1 once it's set up in Supabase.
const APPLE = import.meta.env.VITE_APPLE_LOGIN === '1'

export function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

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
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(t('This sign-in is not set up yet. Use email for now.'))
  }

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

        <div className="or">{t('or')}</div>
        <button className="btn ghost block" onClick={() => oauth('google')} type="button">
          {t('Continue with Google')}
        </button>
        {APPLE && (
          <button className="btn apple block" onClick={() => oauth('apple')} type="button">
            {t('Continue with Apple')}
          </button>
        )}
      </div>
    </div>
  )
}
