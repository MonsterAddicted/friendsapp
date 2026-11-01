import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { ago, until } from '../lib/time'
import { LOCALE, t } from '../lib/i18n'
import { getSettings } from '../lib/settings'
import { Avatar, isBirthday, Sheet } from '../components/ui'
import type { Profile, Wave } from '../types'

const PRESETS = ['👋 Hi!', '📍 Where you at?', '🍕 Hungry?', '🎮 Gaming?', '🙋 Free later?', '⚽ Football?', '😴 Wake up!', '❤️ Miss you guys']
const BIRTHDAY = '🎂 Happy birthday!'

const lastSent = new Map<string, number>()
const COOLDOWN = 20000

const FAV_LABELS: [keyof NonNullable<Profile['favs']>, string, string][] = [
  ['food', '🍕', 'Food'],
  ['game', '🎮', 'Game'],
  ['music', '🎵', 'Music'],
  ['place', '📍', 'Place'],
]

/** "14 March" (year not shown) */
export function birthdayText(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return new Date(2000, m - 1, d).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' })
}

/** A friend's profile: bio, favourites, birthday, waves, mute and (for admins) remove. */
export function PersonSheet({ person, groupId, onClose }: { person: Profile; groupId?: string; onClose: () => void }) {
  const { group, me, muted, toggleMute, isAdmin, members } = useApp()
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [custom, setCustom] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const isMe = person.id === me.id
  const busy = !!person.busy_until && Date.parse(person.busy_until) > Date.now()
  const inGroup = members.some((m) => m.id === person.id)
  const favs = FAV_LABELS.filter(([k]) => person.favs?.[k])

  async function send(message: string) {
    if (Date.now() - (lastSent.get(person.id) ?? 0) < COOLDOWN) return setError(t('Give them a second to answer 🙂'))
    setError('')
    const { error } = await supabase.from('waves').insert({ group_id: groupId ?? group.id, from_user: me.id, to_user: person.id, message })
    if (error) return setError(niceError(error))
    lastSent.set(person.id, Date.now())
    setSent(message)
    setTimeout(onClose, 900)
  }

  async function remove() {
    const { error } = await supabase.from('group_members').delete().eq('group_id', group.id).eq('user_id', person.id)
    if (error) return setError(niceError(error))
    onClose()
  }

  const presets = isBirthday(person.birthday) ? [BIRTHDAY, ...PRESETS.slice(0, 7)] : PRESETS

  return (
    <Sheet title={isMe ? t('You') : person.display_name} onClose={onClose}>
      <div className="stack">
        <div className="profile-head">
          <Avatar p={person} size={64} dot />
          <div className="grow">
            <div className="name big">{person.display_name}</div>
            <div className="sub">@{person.username}</div>
            {busy && <div className="sub">🔕 {t('Busy {until}', { until: until(person.busy_until!) })}</div>}
          </div>
        </div>
        {person.bio && <p className="bio">{person.bio}</p>}
        {(favs.length > 0 || person.birthday) && (
          <div className="fav-list">
            {favs.map(([k, e, label]) => (
              <div className="fav" key={k}>
                <span>{e}</span>
                <span className="sub tiny">{t(label)}</span>
                <b>{person.favs![k]}</b>
              </div>
            ))}
            {person.birthday && (
              <div className="fav">
                <span>🎂</span>
                <span className="sub tiny">{t('Birthday')}</span>
                <b>{birthdayText(person.birthday)}</b>
              </div>
            )}
          </div>
        )}

        {!isMe && (
          <>
            <p className="label">{t('Send a wave')}</p>
            {sent ? (
              <p className="info">
                {t('Sent:')} {t(sent)}
              </p>
            ) : busy ? (
              <p className="sub">{t('{name} is busy right now. Try again later.', { name: person.display_name })}</p>
            ) : (
              <>
                <div className="wave-grid">
                  {presets.map((p) => (
                    <button key={p} className="wave-pick" onClick={() => send(t(p))}>
                      {t(p)}
                    </button>
                  ))}
                </div>
                <form
                  className="composer-row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (custom.trim()) send(custom.trim())
                  }}
                >
                  <input id="wave-custom" className="input grow" maxLength={60} placeholder={t('Or write your own…')} value={custom} onChange={(e) => setCustom(e.target.value)} />
                  <button className="btn small" disabled={!custom.trim()}>
                    {t('Send')}
                  </button>
                </form>
              </>
            )}
            {error && <p className="error">{error}</p>}

            <div className="sheet-actions">
              <button className="link" onClick={() => toggleMute(person.id)}>
                {muted.has(person.id) ? '🔔 ' + t('Unmute posts') : '🔇 ' + t('Mute posts')}
              </button>
              {isAdmin && inGroup && !confirmRemove && (
                <button className="link danger" onClick={() => setConfirmRemove(true)}>
                  {t('Remove from group')}
                </button>
              )}
            </div>
            {confirmRemove && (
              <div className="confirm">
                <p className="name">{t('Remove {name} from "{group}"?', { name: person.display_name, group: group.name })}</p>
                <p className="sub">{t('They can only come back with a new invite.')}</p>
                <div className="row">
                  <button className="btn ghost small grow" onClick={() => setConfirmRemove(false)}>
                    {t('Cancel')}
                  </button>
                  <button className="btn danger small grow" onClick={remove}>
                    {t('Remove')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}

type Incoming = Wave & { sender: Profile | null }

/** Pops up waves sent to you, on top of every screen. */
export function WaveInbox() {
  const { me } = useApp()
  const [waves, setWaves] = useState<Incoming[]>([])
  const [replyTo, setReplyTo] = useState<{ p: Profile; groupId: string } | null>(null)

  useEffect(() => {
    let alive = true
    const since = new Date(Date.now() - 12 * 3600e3).toISOString()
    const withSender = async (w: Wave): Promise<Incoming> => {
      const { data } = await supabase.from('profiles').select('*').eq('id', w.from_user).maybeSingle()
      return { ...w, sender: (data as Profile) ?? null }
    }
    supabase
      .from('waves')
      .select('*')
      .eq('to_user', me.id)
      .eq('seen', false)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(async ({ data }) => {
        const list = await Promise.all(((data as Wave[]) ?? []).map(withSender))
        if (alive) setWaves(list)
      })
    const ch = supabase
      .channel('waves-' + me.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'waves', filter: `to_user=eq.${me.id}` }, async (p) => {
        const w = await withSender(p.new as Wave)
        if (!alive) return
        if (getSettings().vibrate) navigator.vibrate?.(80)
        setWaves((prev) => [w, ...prev.filter((x) => x.id !== w.id)].slice(0, 3))
      })
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [me.id])

  async function dismiss(id: string) {
    setWaves((prev) => prev.filter((w) => w.id !== id))
    await supabase.from('waves').update({ seen: true }).eq('id', id)
  }

  return (
    <>
      {waves.length > 0 && (
        <div className="toasts">
          {waves.map((w) => (
            <div className="toast" key={w.id} role="status">
              <Avatar p={w.sender ?? undefined} size={38} />
              <div className="grow">
                <div className="name small">
                  {w.sender?.display_name ?? t('A friend')} <span className="sub tiny">· {ago(w.created_at)}</span>
                </div>
                <div className="toast-msg">{w.message}</div>
              </div>
              {w.sender && (
                <button
                  className="btn small"
                  onClick={() => {
                    setReplyTo({ p: w.sender!, groupId: w.group_id })
                    dismiss(w.id)
                  }}
                >
                  {t('Wave back')}
                </button>
              )}
              <button className="icon-btn" aria-label={t('Dismiss')} onClick={() => dismiss(w.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {replyTo && <PersonSheet person={replyTo.p} groupId={replyTo.groupId} onClose={() => setReplyTo(null)} />}
    </>
  )
}
