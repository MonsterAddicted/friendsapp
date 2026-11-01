import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { privacyOn, setSetting, useSettings, type DeviceSettings, type PrivacyKey } from '../lib/settings'
import { Avatar, Section, Sheet, Toggle } from '../components/ui'
import { LocationModePicker } from '../components/LocationMode'
import { ProfileForm } from './ProfileForm'
import { NotificationsCard } from './Notifications'
import { birthdayText } from './Waves'

const SHOW: { key: keyof DeviceSettings; label: string; help: string }[] = [
  { key: 'showFree', label: '"I\'m free" card', help: 'Top of the feed' },
  { key: 'showMemories', label: 'On this day', help: 'Meetups from the same day in earlier years' },
  { key: 'showCountdowns', label: 'Coming up', help: 'Countdowns, holidays and birthdays' },
  { key: 'showBestDay', label: 'Best day finder', help: 'Top of the Meetups tab' },
  { key: 'showWeather', label: 'Weather on meetups', help: 'Forecast for the meetup time' },
  { key: 'showStats', label: 'Streak & Wrapped', help: 'Top of the Group tab' },
]

const PRIVACY: { key: PrivacyKey; label: string; help: string }[] = [
  { key: 'online', label: 'Show when I\'m online', help: 'Green dot while you have the app open' },
  { key: 'seen', label: 'Seen by', help: 'Friends see that you saw their posts. Turn off and you won\'t see theirs either.' },
  { key: 'battery', label: 'Share my battery', help: 'Shown next to your pin on the map (where the phone allows it)' },
]

export function SettingsScreen() {
  const { me, setMe } = useApp()
  const s = useSettings()
  const [editing, setEditing] = useState(false)

  async function setPrivacy(key: PrivacyKey, on: boolean) {
    const privacy = { ...(me.privacy ?? {}), [key]: on }
    setMe({ ...me, privacy })
    await supabase.from('profiles').update({ privacy }).eq('id', me.id)
  }

  function setLang(lang: DeviceSettings['lang']) {
    setSetting('lang', lang)
    window.location.reload()
  }

  return (
    <>
      <Section>
        <button className="card profile-card" onClick={() => setEditing(true)}>
          <Avatar p={me} size={56} />
          <span className="grow">
            <span className="name big block">{me.display_name}</span>
            <span className="sub block">@{me.username}</span>
            {me.bio && <span className="sub block ellipsis">{me.bio}</span>}
            {me.birthday && <span className="sub block">🎂 {birthdayText(me.birthday)}</span>}
          </span>
          <span className="btn ghost small">{t('Edit')}</span>
        </button>
      </Section>

      <Section title={t('Location sharing')}>
        <div className="card">
          <LocationModePicker />
        </div>
      </Section>

      <NotificationsCard />

      <Section title={t('Look')}>
        <div className="card">
          <div className="field">
            {t('Theme')}
            <div className="seg">
              {(['system', 'light', 'dark'] as const).map((x) => (
                <button key={x} className={s.theme === x ? 'on' : ''} onClick={() => setSetting('theme', x)}>
                  {t(x === 'system' ? 'Auto' : x === 'light' ? 'Light' : 'Dark')}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            {t('Language')}
            <div className="seg">
              {(['auto', 'en', 'de'] as const).map((x) => (
                <button key={x} className={s.lang === x ? 'on' : ''} onClick={() => setLang(x)}>
                  {x === 'auto' ? t('Auto') : x === 'en' ? 'English' : 'Deutsch'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title={t('Show on screen')}>
        <div className="card toggles">
          {SHOW.map((x) => (
            <Toggle key={x.key} id={'set-' + x.key} label={t(x.label)} help={t(x.help)} checked={!!s[x.key]} onChange={(v) => setSetting(x.key, v as never)} />
          ))}
        </div>
      </Section>

      <Section title={t('Feel')}>
        <div className="card toggles">
          <Toggle id="set-vibrate" label={t('Vibrate on waves')} help={t('A short buzz when someone waves at you')} checked={s.vibrate} onChange={(v) => setSetting('vibrate', v)} />
          <Toggle id="set-motion" label={t('Animations')} help={t('Turn off for a calmer app')} checked={s.motion} onChange={(v) => setSetting('motion', v)} />
        </div>
      </Section>

      <Section title={t('Privacy')}>
        <div className="card toggles">
          {PRIVACY.map((x) => (
            <Toggle key={x.key} id={'privacy-' + x.key} label={t(x.label)} help={t(x.help)} checked={privacyOn(me.privacy, x.key)} onChange={(v) => setPrivacy(x.key, v)} />
          ))}
        </div>
      </Section>

      <Account />

      {editing && (
        <Sheet title={t('Edit profile')} onClose={() => setEditing(false)}>
          <ProfileForm
            userId={me.id}
            existing={me}
            onSaved={(p) => {
              setMe(p)
              setEditing(false)
            }}
          />
        </Sheet>
      )}
    </>
  )
}

function Account() {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function del() {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('delete_account')
    if (error) {
      setBusy(false)
      return setError(niceError(error))
    }
    await supabase.auth.signOut()
  }

  return (
    <Section title={t('Account')}>
      <div className="card">
        <button className="btn ghost block" onClick={() => supabase.auth.signOut()}>
          {t('Sign out')}
        </button>
        {confirm ? (
          <div className="confirm danger">
            <p className="name">{t('Delete your account?')}</p>
            <p className="sub">{t('Your profile, posts, meetups and everything else you added are deleted for good. Groups you started are handed to another member.')}</p>
            <div className="row">
              <button className="btn ghost small grow" onClick={() => setConfirm(false)} disabled={busy}>
                {t('Cancel')}
              </button>
              <button className="btn danger small grow" onClick={del} disabled={busy}>
                {t('Delete forever')}
              </button>
            </div>
          </div>
        ) : (
          <button className="link danger" onClick={() => setConfirm(true)}>
            {t('Delete account')}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
      <p className="sub tiny center">friendsapp · v0.4</p>
    </Section>
  )
}
