import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp, useTick } from '../lib/app'
import { ago, until } from '../lib/time'
import { t } from '../lib/i18n'
import { privacyOn, useSettings } from '../lib/settings'
import { Avatar, Section, Sheet } from '../components/ui'
import type { Status } from '../types'
import { FreeNow } from './FreeNow'
import { CountdownsCard } from './Countdowns'
import { Memories } from './Memories'
import { GroupIntro } from './Tutorial'

const EMOJIS = ['💬', '🍕', '🎮', '📚', '💼', '🏃', '🎵', '🚗', '🛋️', '😴', '🎉', '☕']

/** One tap posts these right away. */
const QUICK: [string, string][] = [
  ['📚', 'Studying'],
  ['🎮', 'Gaming'],
  ['🍕', 'Eating'],
  ['💼', 'Working'],
  ['🏃', 'Training'],
  ['🛋️', 'Chilling'],
  ['🚗', 'On the road'],
  ['😴', 'Sleeping'],
]

const DAY_MS = 24 * 3600e3
const fresh = (s: Status) => Date.now() - Date.parse(s.created_at) < DAY_MS
const isSpotify = (u: string) => /^https:\/\/open\.spotify\.com\/\S+$/.test(u.trim())

/** Song name from Spotify (no key needed). Falls back to nothing. */
async function songTitle(url: string): Promise<string | null> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 3000)
    const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(url), { signal: ctl.signal })
    clearTimeout(timer)
    if (!r.ok) return null
    const j = (await r.json()) as { title?: string }
    return j.title?.slice(0, 120) ?? null
  } catch {
    return null
  }
}

interface View {
  status_id: string
  user_id: string
}

export function Feed() {
  const { group, me, members, goTab, openPerson, muted } = useApp()
  const settings = useSettings()
  const [items, setItems] = useState<Status[] | null>(null)
  const [views, setViews] = useState<View[]>([])
  useTick()

  const shareSeen = privacyOn(me.privacy, 'seen')

  useEffect(() => {
    let alive = true
    setItems(null)
    const since = new Date(Date.now() - DAY_MS).toISOString()
    supabase
      .from('statuses')
      .select('*')
      .eq('group_id', group.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => alive && setItems((data as Status[]) ?? []))

    const ch = supabase
      .channel('statuses-' + group.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'statuses', filter: `group_id=eq.${group.id}` }, (p) => {
        const s = p.new as Status
        setItems((prev) => (prev && !prev.some((x) => x.id === s.id) ? [s, ...prev] : prev))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'statuses' }, (p) => {
        const id = (p.old as { id: string }).id
        setItems((prev) => prev?.filter((x) => x.id !== id) ?? prev)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'status_views' }, (p) => {
        const v = p.new as View
        setViews((prev) => (prev.some((x) => x.status_id === v.status_id && x.user_id === v.user_id) ? prev : [...prev, v]))
      })
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [group.id])

  const visible = useMemo(() => (items ?? []).filter((s) => fresh(s) && !muted.has(s.user_id)), [items, muted])

  // Load who saw what, and mark friends' posts as seen by me
  const idKey = visible.map((s) => s.id).join(',')
  useEffect(() => {
    if (!visible.length) return
    supabase
      .from('status_views')
      .select('status_id, user_id')
      .in('status_id', visible.map((s) => s.id))
      .then(({ data }) => data && setViews(data as View[]))
    if (!shareSeen) return
    const unseen = visible.filter((s) => s.user_id !== me.id).map((s) => ({ status_id: s.id, user_id: me.id }))
    if (unseen.length) supabase.from('status_views').upsert(unseen, { ignoreDuplicates: true }).then(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, shareSeen, me.id])

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  // Everyone's latest status, newest first; people without one go last.
  const rightNow = useMemo(() => {
    const latest = new Map<string, Status>()
    for (const s of visible) if (!latest.has(s.user_id)) latest.set(s.user_id, s)
    return [...members]
      .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : (latest.get(b.id)?.created_at ?? '').localeCompare(latest.get(a.id)?.created_at ?? '')))
      .map((m) => ({ m, s: latest.get(m.id) }))
  }, [visible, members, me.id])

  const added = (s: Status) => setItems((prev) => (prev && !prev.some((x) => x.id === s.id) ? [s, ...prev] : prev))

  async function remove(id: string) {
    setItems((prev) => prev?.filter((x) => x.id !== id) ?? prev)
    await supabase.from('statuses').delete().eq('id', id)
  }

  return (
    <>
      <BusyBanner />
      <GroupIntro posted={(items ?? []).some((s) => s.user_id === me.id)} />
      {settings.showMemories && <Memories />}
      {settings.showFree && <FreeNow />}
      <Composer onPosted={added} />

      <Section title={t('Right now')}>
        <div className="now-row">
          {rightNow.map(({ m, s }) => {
            const busy = m.busy_until && Date.parse(m.busy_until) > Date.now()
            return (
              <button className={'now-card' + (s ? '' : ' stale')} key={m.id} onClick={() => openPerson(m.id)}>
                <div className="now-top">
                  <Avatar p={m} size={38} dot />
                  <span className="now-emoji">{busy ? '🔕' : s?.emoji ?? '💤'}</span>
                </div>
                <div className="name small">{m.id === me.id ? t('You') : m.display_name}</div>
                <div className="now-text">{busy ? t('Busy {until}', { until: until(m.busy_until!) }) : s?.text ?? t('Nothing posted today')}</div>
                {s && !busy && <div className="sub tiny">{ago(s.created_at)}</div>}
              </button>
            )
          })}
        </div>
      </Section>

      {settings.showCountdowns && <CountdownsCard onSetRegion={() => goTab('group')} />}

      <Section title={t('Last 24 hours')}>
        {items === null && <p className="muted">{t('Loading…')}</p>}
        {items !== null && visible.length === 0 && (
          <div className="empty">
            <div className="empty-icon">✍️</div>
            {t("Nothing here yet. Post what you're up to and your friends will see it right away.")}
          </div>
        )}
        {visible.map((s) => {
          const who = byId.get(s.user_id)
          const seenBy = views.filter((v) => v.status_id === s.id && v.user_id !== me.id).map((v) => byId.get(v.user_id)?.display_name).filter(Boolean)
          return (
            <article className="post" key={s.id}>
              <button className="plain" onClick={() => openPerson(s.user_id)} aria-label={who?.display_name}>
                <Avatar p={who} size={42} dot />
              </button>
              <div className="grow">
                <div className="post-head">
                  <span className="name">{s.user_id === me.id ? t('You') : who?.display_name ?? t('Someone')}</span>
                  <span className="sub tiny">{ago(s.created_at)}</span>
                </div>
                <p className="post-text">
                  <span className="post-emoji">{s.emoji}</span> {s.text}
                </p>
                {s.song_url && (
                  <a className="song" href={s.song_url} target="_blank" rel="noopener noreferrer">
                    <span className="song-icon">🎵</span>
                    <span className="grow ellipsis">{s.song_title || t('Listen on Spotify')}</span>
                  </a>
                )}
                {s.user_id === me.id && shareSeen && (
                  <p className="seen">👀 {seenBy.length ? t('Seen by {names}', { names: seenBy.join(', ') }) : t('Not seen yet')}</p>
                )}
              </div>
              {s.user_id === me.id && (
                <button className="icon-btn faint" aria-label={t('Delete post')} onClick={() => remove(s.id)}>
                  ✕
                </button>
              )}
            </article>
          )
        })}
      </Section>
    </>
  )
}

/* ---------------- Composer ---------------- */

function Composer({ onPosted }: { onPosted: (s: Status) => void }) {
  const { group, me } = useApp()
  const [text, setText] = useState('')
  const [emoji, setEmoji] = useState('💬')
  const [picking, setPicking] = useState(false)
  const [song, setSong] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [busySheet, setBusySheet] = useState(false)

  async function send(e: string, txt: string) {
    setBusy(true)
    setError('')
    const row: Record<string, unknown> = { group_id: group.id, user_id: me.id, emoji: e, text: txt }
    if (song && isSpotify(song)) {
      row.song_url = song.trim()
      row.song_title = await songTitle(song.trim())
    }
    const { data, error } = await supabase.from('statuses').insert(row).select().single()
    setBusy(false)
    if (error) return setError(niceError(error))
    onPosted(data as Status)
    setText('')
    setEmoji('💬')
    setSong(null)
    setPicking(false)
  }

  function post(e: FormEvent) {
    e.preventDefault()
    if (song !== null && song.trim() && !isSpotify(song)) return setError(t('Paste a Spotify link (open.spotify.com/…)'))
    if (text.trim()) send(emoji, text.trim())
  }

  const isBusy = !!me.busy_until && Date.parse(me.busy_until) > Date.now()

  return (
    <form className="card composer" onSubmit={post}>
      <div className="composer-row">
        <button type="button" className="emoji-btn" onClick={() => setPicking((p) => !p)} aria-label={t('Pick an emoji')}>
          {emoji}
        </button>
        <input
          id="status-text"
          className="input grow"
          placeholder={t('What are you doing right now?')}
          value={text}
          maxLength={280}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {picking && (
        <div className="chips">
          {EMOJIS.map((x) => (
            <button
              type="button"
              key={x}
              className={'chip emoji' + (x === emoji ? ' on' : '')}
              onClick={() => {
                setEmoji(x)
                setPicking(false)
              }}
            >
              {x}
            </button>
          ))}
        </div>
      )}
      {song !== null && (
        <div className="composer-row">
          <span className="song-icon">🎵</span>
          <input
            id="status-song"
            className="input grow small-input"
            placeholder={t('Paste a Spotify link')}
            value={song}
            inputMode="url"
            onChange={(e) => setSong(e.target.value)}
          />
          <button type="button" className="icon-btn" aria-label={t('Remove song')} onClick={() => setSong(null)}>
            ✕
          </button>
        </div>
      )}
      {text.trim() ? (
        <button className="btn block" disabled={busy}>
          {t('Post')} {emoji}
        </button>
      ) : (
        <>
          <p className="sub tiny">{t('Or tap to post:')}</p>
          <div className="chips">
            {QUICK.map(([e, label]) => (
              <button type="button" key={label} className="chip" disabled={busy} onClick={() => send(e, t(label))}>
                {e} {t(label)}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="composer-tools">
        {song === null && (
          <button type="button" className="tool" onClick={() => setSong('')}>
            🎵 {t('Add a song')}
          </button>
        )}
        {!isBusy && (
          <button type="button" className="tool" onClick={() => setBusySheet(true)}>
            🔕 {t('Busy mode')}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {busySheet && <BusySheet onClose={() => setBusySheet(false)} />}
    </form>
  )
}

/* ---------------- Busy mode ---------------- */

const BUSY: { label: string; until: () => Date }[] = [
  { label: '1 hour', until: () => new Date(Date.now() + 3600e3) },
  { label: '2 hours', until: () => new Date(Date.now() + 2 * 3600e3) },
  { label: '4 hours', until: () => new Date(Date.now() + 4 * 3600e3) },
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

export async function setBusyUntil(meId: string, until: Date | null) {
  return supabase.from('profiles').update({ busy_until: until?.toISOString() ?? null }).eq('id', meId)
}

function BusySheet({ onClose }: { onClose: () => void }) {
  const { me, setMe } = useApp()
  const [error, setError] = useState('')

  async function pick(d: Date) {
    const { error } = await setBusyUntil(me.id, d)
    if (error) return setError(niceError(error))
    setMe({ ...me, busy_until: d.toISOString() })
    onClose()
  }

  return (
    <Sheet title={t('Busy mode')} onClose={onClose}>
      <div className="stack">
        <p className="sub">{t("No waves and no notifications while you're busy. Friends see a 🔕 on your card. SOS alerts still come through.")}</p>
        <div className="wave-grid">
          {BUSY.map((b) => (
            <button key={b.label} type="button" className="wave-pick" onClick={() => pick(b.until())}>
              {t(b.label)}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </Sheet>
  )
}

function BusyBanner() {
  const { me, setMe } = useApp()
  if (!me.busy_until || Date.parse(me.busy_until) <= Date.now()) return null
  async function end() {
    setMe({ ...me, busy_until: null })
    await setBusyUntil(me.id, null)
  }
  return (
    <div className="banner">
      <span className="banner-icon">🔕</span>
      <span className="grow">
        <b>{t("You're busy")}</b> <span className="sub">{until(me.busy_until)}</span>
      </span>
      <button className="btn ghost small" onClick={end}>
        {t('End')}
      </button>
    </div>
  )
}
