import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp, useTick } from '../lib/app'
import { ago } from '../lib/time'
import { Avatar } from '../components/ui'
import type { Status } from '../types'
import { FreeNow } from './FreeNow'
import { CountdownsCard } from './Countdowns'
import { WaveSheet } from './Waves'
import type { Member } from '../types'

const QUICK = ['💬', '🍕', '🎮', '📚', '💼', '🏃', '🎵', '🚗', '🛋️', '😴', '🎉', '☕']

export function Feed() {
  const { group, me, members, goTab } = useApp()
  const [items, setItems] = useState<Status[] | null>(null)
  const [text, setText] = useState('')
  const [emoji, setEmoji] = useState('💬')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [waveTo, setWaveTo] = useState<Member | null>(null)
  useTick()

  useEffect(() => {
    let alive = true
    setItems(null)
    supabase
      .from('statuses')
      .select('*')
      .eq('group_id', group.id)
      .order('created_at', { ascending: false })
      .limit(80)
      .then(({ data }) => alive && setItems((data as Status[]) ?? []))

    const ch = supabase
      .channel('statuses-' + group.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'statuses', filter: `group_id=eq.${group.id}` },
        (p) => {
          const s = p.new as Status
          setItems((prev) => (prev && !prev.some((x) => x.id === s.id) ? [s, ...prev] : prev))
        },
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'statuses' }, (p) => {
        const id = (p.old as { id: string }).id
        setItems((prev) => prev?.filter((x) => x.id !== id) ?? prev)
      })
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [group.id])

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  // Everyone's latest status, newest first; people without one go last.
  const rightNow = useMemo(() => {
    const latest = new Map<string, Status>()
    for (const s of items ?? []) if (!latest.has(s.user_id)) latest.set(s.user_id, s)
    return [...members].sort((a, b) => {
      const ta = latest.get(a.id)?.created_at ?? ''
      const tb = latest.get(b.id)?.created_at ?? ''
      return tb.localeCompare(ta)
    }).map((m) => ({ m, s: latest.get(m.id) }))
  }, [items, members])

  async function post(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    const { data, error } = await supabase
      .from('statuses')
      .insert({ group_id: group.id, user_id: me.id, emoji, text: text.trim() })
      .select()
      .single()
    setBusy(false)
    if (error) return setError(niceError(error))
    const s = data as Status
    setItems((prev) => (prev && !prev.some((x) => x.id === s.id) ? [s, ...prev] : prev))
    setText('')
    setEmoji('💬')
  }

  async function remove(id: string) {
    setItems((prev) => prev?.filter((x) => x.id !== id) ?? prev)
    await supabase.from('statuses').delete().eq('id', id)
  }

  return (
    <>
      <FreeNow />
      <CountdownsCard onSetRegion={() => goTab('group')} />
      <form className="card composer" onSubmit={post}>
        <div className="row">
          <Avatar p={me} size={40} />
          <input
            id="status-text"
            className="input grow"
            placeholder="What are you doing right now?"
            value={text}
            maxLength={280}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="chips">
          {QUICK.map((x) => (
            <button type="button" key={x} className={'chip emoji' + (x === emoji ? ' on' : '')} onClick={() => setEmoji(x)}>
              {x}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn block" disabled={busy || !text.trim()}>
          Post {emoji}
        </button>
      </form>

      <section className="stack-s">
        <p className="label">Right now</p>
        <div className="now-row">
          {rightNow.map(({ m, s }) => (
            <button
              className={'now-card' + (s && isFresh(s.created_at) ? '' : ' stale')}
              key={m.id}
              disabled={m.id === me.id}
              onClick={() => setWaveTo(m)}
              aria-label={m.id === me.id ? undefined : `Wave at ${m.display_name}`}
            >
              <div className="now-top">
                <Avatar p={m} size={36} />
                <span className="now-emoji">{s?.emoji ?? '💤'}</span>
              </div>
              <div className="name small">{m.id === me.id ? 'You' : m.display_name}</div>
              <div className="now-text">{s?.text ?? 'No status yet'}</div>
              {s && <div className="sub tiny">{ago(s.created_at)}</div>}
              {m.id !== me.id && <div className="wave-hint">👋 Wave</div>}
            </button>
          ))}
        </div>
      </section>

      <section className="stack-s">
        <p className="label">Timeline</p>
        {items === null && <p className="muted">Loading…</p>}
        {items?.length === 0 && (
          <div className="empty">
            <div className="empty-icon">✍️</div>
            Nothing here yet. Post what you're up to and your friends will see it right away.
          </div>
        )}
        {items?.map((s) => {
          const who = byId.get(s.user_id)
          return (
            <article className="post" key={s.id}>
              <Avatar p={who} size={42} />
              <div className="grow">
                <div className="post-head">
                  <span className="name">{who?.display_name ?? 'Someone'}</span>
                  <span className="sub tiny">{ago(s.created_at)}</span>
                </div>
                <p className="post-text">
                  <span className="post-emoji">{s.emoji}</span> {s.text}
                </p>
              </div>
              {s.user_id === me.id && (
                <button className="icon-btn faint" aria-label="Delete post" onClick={() => remove(s.id)}>
                  ✕
                </button>
              )}
            </article>
          )
        })}
      </section>
      {waveTo && <WaveSheet to={waveTo} onClose={() => setWaveTo(null)} />}
    </>
  )
}

function isFresh(iso: string) {
  return Date.now() - new Date(iso).getTime() < 6 * 3600 * 1000
}
