import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError } from '../lib/app'
import { t } from '../lib/i18n'
import { Avatar, COLORS, EMOJIS } from '../components/ui'
import type { Favs, Profile } from '../types'

const FAVS: { key: keyof Favs; emoji: string; label: string; example: string }[] = [
  { key: 'food', emoji: '🍕', label: 'Favourite food', example: 'Pizza' },
  { key: 'game', emoji: '🎮', label: 'Favourite game', example: 'FIFA' },
  { key: 'music', emoji: '🎵', label: 'Favourite music', example: 'Drake' },
  { key: 'place', emoji: '📍', label: 'Favourite place', example: 'The lake' },
]

/** Used for the first-time setup and for editing your profile later. */
export function ProfileForm({ userId, existing, onSaved }: { userId: string; existing?: Profile; onSaved: (p: Profile) => void }) {
  const [name, setName] = useState(existing?.display_name ?? '')
  const [username, setUsername] = useState(existing?.username ?? '')
  const [emoji, setEmoji] = useState(existing?.emoji ?? EMOJIS[0])
  const [color, setColor] = useState(existing?.color ?? COLORS[0])
  const [bio, setBio] = useState(existing?.bio ?? '')
  const [favs, setFavs] = useState<Favs>(existing?.favs ?? {})
  const [birthday, setBirthday] = useState(existing?.birthday ?? '')
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    const uname = username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) return setError(t('Username: 3–20 letters, numbers or _ (no spaces).'))
    setBusy(true)
    setError('')
    const row: Record<string, unknown> = { id: userId, display_name: name.trim(), username: uname, emoji, color }
    // Extra profile fields only exist after database update 5, so only send them when used
    if (existing) {
      const cleanFavs = Object.fromEntries(Object.entries(favs).map(([k, v]) => [k, (v ?? '').trim().slice(0, 40)]).filter(([, v]) => v))
      if (bio.trim() || existing.bio) row.bio = bio.trim() || null
      if (Object.keys(cleanFavs).length || (existing.favs && Object.keys(existing.favs).length)) row.favs = cleanFavs
      if (birthday || existing.birthday) row.birthday = birthday || null
    }
    const q = existing ? supabase.from('profiles').update(row).eq('id', userId).select().single() : supabase.from('profiles').insert(row).select().single()
    const { data, error } = await q
    setBusy(false)
    if (error) setError(niceError(error))
    else onSaved(data as Profile)
  }

  return (
    <form className="stack" onSubmit={save}>
      <div className="preview">
        <Avatar p={{ emoji, color }} size={84} />
        <div className="grow">
          <div className="name big">{name || t('Your name')}</div>
          <div className="sub">@{username.toLowerCase() || t('username')}</div>
        </div>
      </div>
      <label className="field">
        {t('Name')}
        <input id="display-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        {t('Username')}
        <input id="username" className="input" value={username} maxLength={20} autoCapitalize="none" onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} required />
      </label>
      <div className="field">
        {t('Avatar')}
        <div className="emoji-grid">
          {EMOJIS.map((x) => (
            <button type="button" key={x} className={'emoji-pick' + (x === emoji ? ' on' : '')} onClick={() => setEmoji(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        {t('Colour')}
        <div className="color-row">
          {COLORS.map((c) => (
            <button type="button" key={c} aria-label={t('Colour') + ' ' + c} className={'color-pick' + (c === color ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>

      {existing &&
        (more || existing.bio || existing.birthday ? (
          <>
            <label className="field">
              {t('About you')}
              <textarea id="bio" className="input" rows={2} maxLength={160} placeholder={t('A few words about you')} value={bio} onChange={(e) => setBio(e.target.value)} />
            </label>
            <label className="field">
              {t('Birthday')}
              <input id="birthday" className="input" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
              <span className="sub tiny">{t('Friends get a reminder on the day. Only day and month are shown.')}</span>
            </label>
            <div className="field">
              {t('Favourites')}
              <div className="fav-inputs">
                {FAVS.map((f) => (
                  <div className="composer-row" key={f.key}>
                    <span className="fav-emoji" aria-hidden>
                      {f.emoji}
                    </span>
                    <input
                      id={'fav-' + f.key}
                      className="input grow small-input"
                      maxLength={40}
                      aria-label={t(f.label)}
                      placeholder={t(f.label) + ' · ' + t('e.g. {x}', { x: f.example })}
                      value={favs[f.key] ?? ''}
                      onChange={(e) => setFavs({ ...favs, [f.key]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <button type="button" className="link inline" onClick={() => setMore(true)}>
            + {t('Add bio, birthday and favourites')}
          </button>
        ))}

      {error && <p className="error">{error}</p>}
      <button className="btn block" disabled={busy}>
        {existing ? t('Save') : t("Let's go")}
      </button>
    </form>
  )
}

export function ProfileSetup({ userId, onDone }: { userId: string; onDone: (p: Profile) => void }) {
  return (
    <div className="center-screen">
      <div className="auth">
        <h1 className="title">{t('Make your profile')}</h1>
        <p className="muted tagline">{t('This is how your friends will see you.')}</p>
        <ProfileForm userId={userId} onSaved={onDone} />
        <button className="link" onClick={() => supabase.auth.signOut()}>
          {t('Sign out')}
        </button>
      </div>
    </div>
  )
}
