import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp, useTick } from '../lib/app'
import { Avatar, Sheet } from '../components/ui'
import type { Availability, MeetupKind, UpFor } from '../types'

export const UP_FOR: Record<UpFor, { emoji: string; label: string }> = {
  anything: { emoji: '🙌', label: 'Anything' },
  eat: { emoji: '🍕', label: 'Food' },
  party: { emoji: '🎉', label: 'Party' },
  sport: { emoji: '⚽', label: 'Sport' },
  chill: { emoji: '🛋️', label: 'Chill' },
  gaming: { emoji: '🎮', label: 'Gaming' },
}

const DURATIONS: { id: string; label: string; until: () => Date }[] = [
  { id: '1h', label: '1 hour', until: () => new Date(Date.now() + 3600e3) },
  { id: '2h', label: '2 hours', until: () => new Date(Date.now() + 2 * 3600e3) },
  { id: '3h', label: '3 hours', until: () => new Date(Date.now() + 3 * 3600e3) },
  {
    id: 'tonight',
    label: 'Tonight',
    until: () => {
      const d = new Date()
      d.setHours(23, 59, 0, 0)
      return d.getTime() - Date.now() < 2 * 3600e3 ? new Date(Date.now() + 2 * 3600e3) : d
    },
  },
]

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** "Who's free right now" block at the top of the feed. */
export function FreeNow() {
  const { me, members, openNewMeetup } = useApp()
  const [rows, setRows] = useState<Availability[]>([])
  const [picking, setPicking] = useState(false)
  useTick()

  const ids = useMemo(() => members.map((m) => m.id), [members])
  const idKey = ids.join(',')

  const load = useCallback(async () => {
    if (!ids.length) return
    const { data } = await supabase.from('availability').select('*').in('user_id', ids).gt('until', new Date().toISOString())
    setRows((data as Availability[]) ?? [])
  }, [idKey])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('availability-' + idKey.slice(0, 40))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [idKey, load])

  const byId = new Map(members.map((m) => [m.id, m]))
  const free = rows.filter((r) => Date.parse(r.until) > Date.now() && byId.has(r.user_id))
  const mine = free.find((r) => r.user_id === me.id)
  const others = free.filter((r) => r.user_id !== me.id)

  async function stop() {
    setRows((prev) => prev.filter((r) => r.user_id !== me.id))
    await supabase.from('availability').delete().eq('user_id', me.id)
  }

  function startSomething() {
    const wanted = [mine, ...others].map((r) => r?.up_for).filter((u): u is UpFor => !!u && u !== 'anything')
    const kind: MeetupKind = (wanted[0] as MeetupKind | undefined) ?? 'chill'
    openNewMeetup({ kind })
  }

  const names = others.map((r) => byId.get(r.user_id)?.display_name ?? '?')
  const namesText = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`

  return (
    <section className="card free">
      {mine ? (
        <div className="row">
          <div className="free-dot" aria-hidden="true" />
          <div className="grow">
            <div className="name">
              You're free until {clock(mine.until)} {UP_FOR[mine.up_for].emoji}
            </div>
            <div className="sub">{mine.note || `Up for: ${UP_FOR[mine.up_for].label.toLowerCase()}`}</div>
          </div>
          <button className="btn ghost small" onClick={stop}>
            Not free
          </button>
        </div>
      ) : (
        <button className="btn free-btn block" onClick={() => setPicking(true)}>
          🙋 I'm free
        </button>
      )}

      {mine && others.length > 0 && (
        <div className="match">
          <div className="grow">
            <div className="name">
              🔥 {namesText} {others.length === 1 ? 'is' : 'are'} free too!
            </div>
            <div className="sub">Perfect moment to do something.</div>
          </div>
          <button className="btn small" onClick={startSomething}>
            Start something
          </button>
        </div>
      )}

      <div className="stack-s">
        <p className="label">Free right now · {others.length}</p>
        {others.length === 0 && <p className="sub">Nobody else yet. Tap "I'm free" so friends know.</p>}
        {others.map((r) => {
          const p = byId.get(r.user_id)!
          return (
            <div className="row" key={r.user_id}>
              <Avatar p={p} size={36} />
              <div className="grow">
                <div className="name">{p.display_name}</div>
                <div className="sub">
                  until {clock(r.until)} · {UP_FOR[r.up_for].emoji} {r.note || UP_FOR[r.up_for].label}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {picking && <ImFreeSheet onClose={() => setPicking(false)} onSaved={load} />}
    </section>
  )
}

function ImFreeSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { me } = useApp()
  const [dur, setDur] = useState('2h')
  const [upFor, setUpFor] = useState<UpFor>('anything')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const until = DURATIONS.find((d) => d.id === dur)!.until()
    const { error } = await supabase.from('availability').upsert({
      user_id: me.id,
      until: until.toISOString(),
      up_for: upFor,
      note: note.trim() || null,
      updated_at: new Date().toISOString(),
    })
    setBusy(false)
    if (error) return setError(niceError(error))
    onSaved()
    onClose()
  }

  return (
    <Sheet title="I'm free" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="field">
          For how long?
          <div className="chips wrap">
            {DURATIONS.map((d) => (
              <button type="button" key={d.id} className={'chip' + (d.id === dur ? ' on' : '')} onClick={() => setDur(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          Up for
          <div className="kind-grid">
            {(Object.keys(UP_FOR) as UpFor[]).map((u) => (
              <button type="button" key={u} className={'kind-pick' + (u === upFor ? ' on' : '')} onClick={() => setUpFor(u)}>
                <span>{UP_FOR[u].emoji}</span>
                {UP_FOR[u].label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          Note (optional)
          <input id="free-note" className="input" maxLength={80} placeholder="e.g. at home, can come to the city" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn block" disabled={busy}>
          Tell my friends 🙋
        </button>
      </form>
    </Sheet>
  )
}
