import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError } from '../lib/app'
import { Avatar, COLORS, EMOJIS } from '../components/ui'
import type { Profile } from '../types'

/** Used for the first-time setup and for editing your profile later. */
export function ProfileForm({
  userId,
  existing,
  onSaved,
}: {
  userId: string
  existing?: Profile
  onSaved: (p: Profile) => void
}) {
  const [name, setName] = useState(existing?.display_name ?? '')
  const [username, setUsername] = useState(existing?.username ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? EMOJIS[0])
  const [color, setColor] = useState(existing?.color ?? COLORS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    const uname = username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) {
      setError('Username: 3–20 letters, numbers or _ (no spaces).')
      return
    }
    setBusy(true)
    setError('')
    const row = { id: userId, display_name: name.trim(), username: uname, emoji, color }
    const q = existing
      ? supabase.from('profiles').update(row).eq('id', userId).select().single()
      : supabase.from('profiles').insert(row).select().single()
    const { data, error } = await q
    setBusy(false)
    if (error) setError(niceError(error))
    else onSaved(data as Profile)
  }

  return (
    <form className="stack" onSubmit={save}>
      <div className="preview">
        <Avatar p={{ emoji, color }} size={84} />
        <div>
          <div className="name big">{name || 'Your name'}</div>
          <div className="sub">@{username.toLowerCase() || 'username'}</div>
        </div>
      </div>
      <label className="field">
        Name
        <input id="display-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        Username
        <input
          id="username"
          className="input"
          value={username}
          maxLength={20}
          autoCapitalize="none"
          onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
          required
        />
      </label>
      <div className="field">
        Avatar
        <div className="emoji-grid">
          {EMOJIS.map((x) => (
            <button type="button" key={x} className={'emoji-pick' + (x === emoji ? ' on' : '')} onClick={() => setEmoji(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        Colour
        <div className="color-row">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={'Colour ' + c}
              className={'color-pick' + (c === color ? ' on' : '')}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn block" disabled={busy}>
        {existing ? 'Save' : "Let's go"}
      </button>
    </form>
  )
}

export function ProfileSetup({ userId, onDone }: { userId: string; onDone: (p: Profile) => void }) {
  return (
    <div className="center-screen">
      <div className="auth">
        <h1 className="title">Make your profile</h1>
        <p className="muted tagline">This is how your friends will see you.</p>
        <ProfileForm userId={userId} onSaved={onDone} />
        <button className="link" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
