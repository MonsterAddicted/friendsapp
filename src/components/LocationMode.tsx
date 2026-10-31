import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { clearPosition, locationErrorText, shareOnce } from '../lib/location'
import type { LocationMode } from '../types'

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
      setDone('Location shared ✓')
    } catch (e) {
      setError(locationErrorText(e))
    }
  }

  return (
    <div className="stack-s">
      <div className="seg" role="radiogroup" aria-label="Location sharing">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'on' : ''} disabled={busy} onClick={() => choose(m.id)} role="radio" aria-checked={mode === m.id}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="sub">{MODES.find((m) => m.id === mode)?.help}</p>
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
          Share my location now
        </button>
      )}
      {done && <p className="info">{done}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
