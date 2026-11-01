import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp, useTick } from '../lib/app'
import { clearPosition, locationErrorText, shareOnce } from '../lib/location'
import type { LocationMode } from '../types'
import { t } from '../lib/i18n'
import { clock } from '../lib/time'

const MODES: { id: LocationMode; label: string; help: string }[] = [
  { id: 'off', label: 'Off', help: 'Nobody sees where you are.' },
  { id: 'manual', label: 'Tap to share', help: 'Your spot only updates when you tap "Share my location now".' },
  { id: 'live', label: 'Live', help: 'Updates by itself while the app is open.' },
]

export function LocationModePicker() {
  const { me, setMe } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const mode = me.location_mode

  async function choose(next: LocationMode) {
    if (next === mode) return
    setBusy(true)
    setError('')
    setDone('')
    const { data, error } = await supabase.from('profiles').update({ location_mode: next }).eq('id', me.id).select().single()
    if (error) {
      setError(niceError(error))
    } else {
      setMe({ ...me, ...data })
      if (next === 'off') await clearPosition(me.id)
      else await shareNow()
    }
    setBusy(false)
  }

  async function shareNow() {
    setError('')
    setDone('')
    try {
      await shareOnce(me.id)
      setDone(t('Location shared ✓'))
    } catch (e) {
      setError(locationErrorText(e))
    }
  }

  return (
    <div className="stack-s">
      <div className="seg" role="radiogroup" aria-label={t('Location sharing')}>
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'on' : ''} disabled={busy} onClick={() => choose(m.id)} role="radio" aria-checked={mode === m.id}>
            {t(m.label)}
          </button>
        ))}
      </div>
      <p className="sub">{t(MODES.find((m) => m.id === mode)?.help ?? '')}</p>
      {mode === 'manual' && (
        <button
          className="btn small"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await shareNow()
            setBusy(false)
          }}
        >
          {t('Share my location now')}
        </button>
      )}
      {mode !== 'off' && <Ghost />}
      {done && <p className="info">{done}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

const GHOSTS: { label: string; until: () => Date }[] = [
  { label: '1 h', until: () => new Date(Date.now() + 3600e3) },
  { label: '3 h', until: () => new Date(Date.now() + 3 * 3600e3) },
  {
    label: 'Until tomorrow',
    until: () => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(8, 0, 0, 0)
      return d
    },
  },
]

/** Ghost mode: hide your location for a while; it comes back by itself. */
function Ghost() {
  const { me, setMe } = useApp()
  useTick()
  const active = !!me.ghost_until && Date.parse(me.ghost_until) > Date.now()

  async function set(until: Date | null) {
    const ghost_until = until?.toISOString() ?? null
    setMe({ ...me, ghost_until })
    await supabase.from('profiles').update({ ghost_until }).eq('id', me.id)
  }

  if (active)
    return (
      <div className="ghost-row on">
        <span className="grow">
          👻 {t('Hidden until {time}', { time: clock(me.ghost_until!) })}
        </span>
        <button className="btn ghost small" onClick={() => set(null)}>
          {t('Show me again')}
        </button>
      </div>
    )
  return (
    <div className="ghost-row">
      <span className="sub">👻 {t('Ghost mode:')}</span>
      {GHOSTS.map((g) => (
        <button key={g.label} className="chip" onClick={() => set(g.until())}>
          {t(g.label)}
        </button>
      ))}
    </div>
  )
}
