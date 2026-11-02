import type { ReactNode } from 'react'
import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError } from '../lib/app'
import { t } from '../lib/i18n'
import type { Group } from '../types'

/** Create a new group or join one with an invite code. */
export function GroupForms({ onDone }: { onDone: (g: Group) => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error } = await supabase.rpc('create_group', { group_name: name })
    setBusy(false)
    if (error) setError(niceError(error))
    else onDone(data as Group)
  }

  async function join(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error } = await supabase.rpc('join_group', { code })
    setBusy(false)
    if (error) setError(niceError(error))
    else onDone(data as Group)
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={join}>
        <p className="label">{t('Got an invite code?')}</p>
        <input
          id="invite-code"
          className="input code-input"
          placeholder="ABC123"
          maxLength={6}
          value={code}
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          required
        />
        <button className="btn block" disabled={busy || code.length < 6}>
          {t('Join group')}
        </button>
      </form>
      <form className="card" onSubmit={create}>
        <p className="label">{t('Start a new group')}</p>
        <input
          id="group-name"
          className="input"
          placeholder={t('Group name, e.g. The Squad')}
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn ghost block" disabled={busy || !name.trim()}>
          {t('Create group')}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

export function GroupStart({ onDone, error, extra }: { onDone: (g: Group) => void; error?: string; extra?: ReactNode }) {
  return (
    <div className="center-screen">
      <div className="auth">
        <div className="logo-mark">🫂</div>
        <h1 className="title">{t('Find your people')}</h1>
        <p className="muted tagline">{t('Join your friends with their code, or start a group and invite them.')}</p>
        {error && <p className="error">{error}</p>}
        {extra}
        <GroupForms onDone={onDone} />
        <button className="link" onClick={() => supabase.auth.signOut()}>
          {t('Sign out')}
        </button>
      </div>
    </div>
  )
}
