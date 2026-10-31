import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

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
      if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else if (!data.session) setInfo('Almost done! Open the email we sent you and tap the link, then sign in.')
    }
    setBusy(false)
  }

  async function google() {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError('Google sign-in is not set up yet. Use email for now.')
  }

  return (
    <div className="center-screen">
      <div className="auth">
        <div className="logo-mark">👋</div>
        <h1 className="title">friendsapp</h1>
        <p className="muted tagline">See what your friends are up to, where they are, and who's in for tonight.</p>

        <div className="seg two">
          <button className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')} type="button">
            Sign in
          </button>
          <button className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')} type="button">
            Create account
          </button>
        </div>

        <form className="stack" onSubmit={submit}>
          <input
            id="email"
            className="input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            id="password"
            className="input"
            type="password"
            placeholder={mode === 'up' ? 'Password (at least 6 characters)' : 'Password'}
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="error">{error}</p>}
          {info && <p className="info">{info}</p>}
          <button className="btn block" disabled={busy}>
            {mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="or">or</div>
        <button className="btn ghost block" onClick={google} type="button">
          Continue with Google
        </button>
      </div>
    </div>
  )
}
