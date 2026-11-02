import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { Section, Toggle } from '../components/ui'
import { disablePush, enablePush, needsHomeScreen, pushEnabledHere, pushSupported } from '../lib/push'

export const NOTIFY_KINDS: { id: string; label: string; help: string }[] = [
  { id: 'waves', label: 'Waves', help: 'When someone waves at you' },
  { id: 'meetups', label: 'New meetups', help: 'When someone starts a meetup' },
  { id: 'free', label: 'Friends are free', help: 'When a friend taps "I\'m free"' },
  { id: 'reminders', label: 'Meetup reminders', help: '1 hour before a meetup you joined' },
  { id: 'nudge', label: 'Daily check-in', help: 'Once a day: "What are you doing?"' },
  { id: 'nearby', label: 'Nearby friends', help: 'When a friend is under 300 m away (both on Live)' },
  { id: 'birthdays', label: 'Birthdays', help: 'In the morning on a friend\'s birthday' },
  { id: 'friends', label: 'Friends', help: 'Friend requests and group invites' },
]

export function NotificationsCard() {
  const { me, setMe } = useApp()
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const prefs = (me.notify ?? {}) as Record<string, boolean>

  useEffect(() => {
    pushEnabledHere().then(setOn)
  }, [])

  async function toggleDevice() {
    setBusy(true)
    setError('')
    try {
      if (on) {
        await disablePush()
        setOn(false)
      } else {
        await enablePush()
        setOn(true)
      }
    } catch (e) {
      setError(t((e as Error).message || 'Could not turn on notifications.'))
    }
    setBusy(false)
  }

  async function toggleKind(id: string, value: boolean) {
    const notify = { ...prefs, [id]: value }
    setMe({ ...me, notify })
    await supabase.from('profiles').update({ notify }).eq('id', me.id)
  }

  return (
    <Section title={t('Notifications')}>
      <div className="card">
        {!pushSupported() ? (
          <p className="sub">{t("This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.")}</p>
        ) : needsHomeScreen() ? (
          <p className="sub">{t('On iPhone, first add friendsapp to your home screen (Share → Add to Home Screen), then open it from there to turn on notifications.')}</p>
        ) : (
          <div className="row">
            <div className="grow">
              <div className="name">{on ? t('On for this device 🔔') : t('Off on this device')}</div>
              <div className="sub">{on ? t('Pick what you want to hear about below.') : t('Get told when friends are free, wave or plan something.')}</div>
            </div>
            <button className={'btn small' + (on ? ' ghost' : '')} disabled={busy || on === null} onClick={toggleDevice}>
              {on ? t('Turn off') : t('Turn on')}
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="toggles">
          {NOTIFY_KINDS.map((k) => (
            <Toggle key={k.id} id={'notify-' + k.id} label={t(k.label)} help={t(k.help)} checked={prefs[k.id] !== false} onChange={(v) => toggleKind(k.id, v)} />
          ))}
        </div>
        <p className="sub tiny">{t('🆘 SOS alerts always come through, even in busy mode.')}</p>
      </div>
    </Section>
  )
}
