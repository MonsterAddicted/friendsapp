import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { toLocalInput, when } from '../lib/time'
import { Avatar, Sheet } from '../components/ui'
import type { Answer, Meetup, MeetupKind, MeetupResponse } from '../types'

export const KINDS: Record<MeetupKind, { emoji: string; label: string; example: string }> = {
  party: { emoji: '🎉', label: 'Party', example: 'Party at mine?' },
  eat: { emoji: '🍕', label: 'Eat', example: 'Pizza tonight?' },
  sport: { emoji: '⚽', label: 'Sport', example: 'Football in the park?' },
  chill: { emoji: '🛋️', label: 'Chill', example: 'Just hang out?' },
  gaming: { emoji: '🎮', label: 'Gaming', example: 'Gaming session?' },
  other: { emoji: '✨', label: 'Other', example: 'Anyone up for…' },
}

const ANSWERS: { id: Answer; label: string }[] = [
  { id: 'in', label: "I'm in" },
  { id: 'maybe', label: 'Maybe' },
  { id: 'out', label: "Can't" },
]

export function Meetups() {
  const { group, me, members } = useApp()
  const [meetups, setMeetups] = useState<Meetup[] | null>(null)
  const [answers, setAnswers] = useState<MeetupResponse[]>([])
  const [creating, setCreating] = useState(false)
  const idsRef = useRef<string[]>([])

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
    const { data } = await supabase
      .from('meetups')
      .select('*')
      .eq('group_id', group.id)
      .eq('cancelled', false)
      .or(`starts_at.is.null,starts_at.gte."${since}"`)
      .order('starts_at', { ascending: true, nullsFirst: true })
    const list = (data as Meetup[]) ?? []
    idsRef.current = list.map((m) => m.id)
    setMeetups(list)
    if (list.length) {
      const { data: r } = await supabase.from('meetup_responses').select('*').in('meetup_id', idsRef.current)
      setAnswers((r as MeetupResponse[]) ?? [])
    } else setAnswers([])
  }, [group.id])

  useEffect(() => {
    setMeetups(null)
    load()
    const ch = supabase
      .channel('meetups-' + group.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetups', filter: `group_id=eq.${group.id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetup_responses' }, (p) => {
        const row = (p.new && 'meetup_id' in p.new ? p.new : p.old) as MeetupResponse
        if (!row.meetup_id || idsRef.current.includes(row.meetup_id)) load()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [group.id, load])

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  async function respond(meetupId: string, answer: Answer) {
    const mine = answers.find((a) => a.meetup_id === meetupId && a.user_id === me.id)
    if (mine?.answer === answer) {
      setAnswers((prev) => prev.filter((a) => a !== mine))
      await supabase.from('meetup_responses').delete().eq('meetup_id', meetupId).eq('user_id', me.id)
    } else {
      const row: MeetupResponse = { meetup_id: meetupId, user_id: me.id, answer }
      setAnswers((prev) => [...prev.filter((a) => !(a.meetup_id === meetupId && a.user_id === me.id)), row])
      await supabase.from('meetup_responses').upsert({ ...row, updated_at: new Date().toISOString() })
    }
  }

  async function cancel(id: string) {
    setMeetups((prev) => prev?.filter((m) => m.id !== id) ?? prev)
    await supabase.from('meetups').update({ cancelled: true }).eq('id', id)
  }

  return (
    <>
      <button className="btn block" onClick={() => setCreating(true)}>
        + New meetup
      </button>

      {meetups === null && <p className="muted">Loading…</p>}
      {meetups?.length === 0 && (
        <div className="empty">
          <div className="empty-icon">📅</div>
          No plans yet. Start one: pizza, party, football, anything.
        </div>
      )}

      {meetups?.map((m) => {
        const k = KINDS[m.kind]
        const host = byId.get(m.created_by)
        const rs = answers.filter((a) => a.meetup_id === m.id)
        const mine = rs.find((a) => a.user_id === me.id)?.answer
        const going = rs.filter((a) => a.answer === 'in')
        const count = (x: Answer) => rs.filter((a) => a.answer === x).length
        return (
          <article className="card meetup" key={m.id}>
            <div className="row">
              <div className="kind-badge">{k.emoji}</div>
              <div className="grow">
                <h3 className="meetup-title">{m.title}</h3>
                <div className="sub">
                  {k.label} · by {host ? (host.id === me.id ? 'you' : host.display_name) : 'someone'}
                </div>
              </div>
            </div>
            <div className="facts">
              <span>🕒 {m.starts_at ? when(m.starts_at) : 'Time open'}</span>
              {m.place && <span>📍 {m.place}</span>}
            </div>
            {m.details && <p className="details">{m.details}</p>}
            <div className="answers">
              {ANSWERS.map((a) => (
                <button key={a.id} className={`answer ${a.id}` + (mine === a.id ? ' on' : '')} onClick={() => respond(m.id, a.id)}>
                  {a.label} <b>{count(a.id) || ''}</b>
                </button>
              ))}
            </div>
            {going.length > 0 && (
              <div className="going">
                <div className="faces">
                  {going.slice(0, 8).map((a) => (
                    <Avatar key={a.user_id} p={byId.get(a.user_id)} size={28} />
                  ))}
                </div>
                <span className="sub">
                  {going.map((a) => (a.user_id === me.id ? 'you' : byId.get(a.user_id)?.display_name ?? '?')).join(', ')} going
                </span>
              </div>
            )}
            {m.created_by === me.id && (
              <button className="link danger" onClick={() => cancel(m.id)}>
                Cancel meetup
              </button>
            )}
          </article>
        )
      })}

      {creating && <NewMeetup onClose={() => setCreating(false)} onCreated={load} />}
    </>
  )
}

function NewMeetup({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { group, me } = useApp()
  const [kind, setKind] = useState<MeetupKind>('eat')
  const [title, setTitle] = useState('')
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 2 * 3600 * 1000)
    d.setMinutes(0, 0, 0)
    return toLocalInput(d)
  })
  const [place, setPlace] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error } = await supabase
      .from('meetups')
      .insert({
        group_id: group.id,
        created_by: me.id,
        kind,
        title: title.trim() || KINDS[kind].example,
        place: place.trim() || null,
        details: details.trim() || null,
        starts_at: time ? new Date(time).toISOString() : null,
      })
      .select()
      .single()
    if (error) {
      setBusy(false)
      return setError(niceError(error))
    }
    await supabase.from('meetup_responses').insert({ meetup_id: (data as Meetup).id, user_id: me.id, answer: 'in' })
    onCreated()
    onClose()
  }

  return (
    <Sheet title="New meetup" onClose={onClose}>
      <form className="stack" onSubmit={create}>
        <div className="kind-grid">
          {(Object.keys(KINDS) as MeetupKind[]).map((k) => (
            <button type="button" key={k} className={'kind-pick' + (k === kind ? ' on' : '')} onClick={() => setKind(k)}>
              <span>{KINDS[k].emoji}</span>
              {KINDS[k].label}
            </button>
          ))}
        </div>
        <label className="field">
          What?
          <input id="meetup-title" className="input" placeholder={KINDS[kind].example} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          When?
          <input id="meetup-time" className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="field">
          Where?
          <input id="meetup-place" className="input" placeholder="e.g. Luigi's, my place, the park" maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
        <label className="field">
          Anything else?
          <textarea id="meetup-details" className="input" rows={2} maxLength={500} placeholder="Optional" value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn block" disabled={busy}>
          Ask the group {KINDS[kind].emoji}
        </button>
      </form>
    </Sheet>
  )
}
