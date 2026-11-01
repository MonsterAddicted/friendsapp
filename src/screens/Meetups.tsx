import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp, useTick, type MeetupDraft } from '../lib/app'
import { ago, toLocalInput, when } from '../lib/time'
import { distanceText, km } from '../lib/geo'
import { getPosition, locationErrorText } from '../lib/location'
import { Avatar, Sheet } from '../components/ui'
import { MiniMap } from '../components/MiniMap'
import type { Answer, Meetup, MeetupKind, MeetupOption, MeetupResponse, Member, OnTheWay, Vote } from '../types'

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

interface Data {
  meetups: Meetup[]
  answers: MeetupResponse[]
  options: MeetupOption[]
  votes: Vote[]
  otw: OnTheWay[]
}

export function Meetups() {
  const { group, members, openNewMeetup } = useApp()
  const [data, setData] = useState<Data | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useTick()

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 6 * 3600e3).toISOString()
    const { data: ms } = await supabase
      .from('meetups')
      .select('*')
      .eq('group_id', group.id)
      .eq('cancelled', false)
      .or(`starts_at.is.null,starts_at.gte."${since}"`)
      .order('starts_at', { ascending: true, nullsFirst: true })
    const meetups = (ms as Meetup[]) ?? []
    const ids = meetups.map((m) => m.id)
    if (!ids.length) return setData({ meetups, answers: [], options: [], votes: [], otw: [] })
    const [r, o, w] = await Promise.all([
      supabase.from('meetup_responses').select('*').in('meetup_id', ids),
      supabase.from('meetup_options').select('*').in('meetup_id', ids).order('position'),
      supabase.from('on_the_way').select('*').in('meetup_id', ids),
    ])
    const options = (o.data as MeetupOption[]) ?? []
    const v = options.length ? await supabase.from('meetup_votes').select('*').in('option_id', options.map((x) => x.id)) : { data: [] }
    setData({
      meetups,
      answers: (r.data as MeetupResponse[]) ?? [],
      options,
      votes: (v.data as Vote[]) ?? [],
      otw: (w.data as OnTheWay[]) ?? [],
    })
  }, [group.id])

  // Many small changes can arrive at once; reload at most every 300 ms.
  const reload = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(load, 300)
  }, [load])

  useEffect(() => {
    setData(null)
    load()
    const ch = supabase.channel('meetups-' + group.id)
    for (const table of ['meetups', 'meetup_responses', 'meetup_options', 'meetup_votes', 'on_the_way']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, reload)
    }
    ch.subscribe()
    return () => {
      window.clearTimeout(timer.current)
      supabase.removeChannel(ch)
    }
  }, [group.id, load, reload])

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  return (
    <>
      <button className="btn block" onClick={() => openNewMeetup()}>
        + New meetup
      </button>

      {data === null && <p className="muted">Loading…</p>}
      {data?.meetups.length === 0 && (
        <div className="empty">
          <div className="empty-icon">📅</div>
          No plans yet. Start one: pizza, party, football, anything.
        </div>
      )}

      {data?.meetups.map((m) => (
        <MeetupCard
          key={m.id}
          m={m}
          answers={data.answers.filter((a) => a.meetup_id === m.id)}
          options={data.options.filter((o) => o.meetup_id === m.id)}
          votes={data.votes}
          otw={data.otw.filter((w) => w.meetup_id === m.id)}
          byId={byId}
          setData={setData}
          reload={reload}
        />
      ))}
    </>
  )
}

function MeetupCard({
  m,
  answers,
  options,
  votes,
  otw,
  byId,
  setData,
  reload,
}: {
  m: Meetup
  answers: MeetupResponse[]
  options: MeetupOption[]
  votes: Vote[]
  otw: OnTheWay[]
  byId: Map<string, Member>
  setData: Dispatch<SetStateAction<Data | null>>
  reload: () => void
}) {
  const { me } = useApp()
  const [showMap, setShowMap] = useState(false)
  const [error, setError] = useState('')
  const k = KINDS[m.kind]
  const host = byId.get(m.created_by)
  const mine = answers.find((a) => a.user_id === me.id)?.answer
  const going = answers.filter((a) => a.answer === 'in')
  const count = (x: Answer) => answers.filter((a) => a.answer === x).length
  const nameOf = (id: string) => (id === me.id ? 'you' : byId.get(id)?.display_name ?? '?')

  const timeOpts = options.filter((o) => o.kind === 'time').sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))
  const placeOpts = options.filter((o) => o.kind === 'place')
  const voting = !m.poll_locked && options.length > 0
  const timeLeader = leader(timeOpts, votes)
  const placeLeader = leader(placeOpts, votes)
  const voters = new Set(votes.filter((v) => options.some((o) => o.id === v.option_id)).map((v) => v.user_id))

  const myOtw = otw.find((w) => w.user_id === me.id)
  const goal = m.lat != null && m.lng != null ? { lat: m.lat, lng: m.lng } : null

  async function respond(answer: Answer) {
    setData((d) => d && { ...d, answers: [...d.answers.filter((a) => !(a.meetup_id === m.id && a.user_id === me.id)), ...(mine === answer ? [] : [{ meetup_id: m.id, user_id: me.id, answer }])] })
    if (mine === answer) await supabase.from('meetup_responses').delete().eq('meetup_id', m.id).eq('user_id', me.id)
    else await supabase.from('meetup_responses').upsert({ meetup_id: m.id, user_id: me.id, answer, updated_at: new Date().toISOString() })
    if (answer !== 'in' && myOtw) await stopOtw()
  }

  async function vote(o: MeetupOption) {
    const has = votes.some((v) => v.option_id === o.id && v.user_id === me.id)
    setData((d) => d && { ...d, votes: has ? d.votes.filter((v) => !(v.option_id === o.id && v.user_id === me.id)) : [...d.votes, { option_id: o.id, user_id: me.id }] })
    if (has) await supabase.from('meetup_votes').delete().eq('option_id', o.id).eq('user_id', me.id)
    else await supabase.from('meetup_votes').insert({ option_id: o.id, user_id: me.id })
  }

  async function lockIn() {
    await supabase
      .from('meetups')
      .update({
        poll_locked: true,
        starts_at: timeLeader?.starts_at ?? m.starts_at,
        place: placeLeader?.label ?? m.place,
      })
      .eq('id', m.id)
    reload()
  }

  async function startOtw() {
    setError('')
    try {
      const pos = await getPosition()
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      const { error } = await supabase.from('on_the_way').upsert({
        meetup_id: m.id,
        user_id: me.id,
        ...here,
        arrived: false,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      if (error) setError(niceError(error))
      reload()
    } catch (e) {
      setError(locationErrorText(e))
    }
  }

  async function stopOtw() {
    setData((d) => d && { ...d, otw: d.otw.filter((w) => !(w.meetup_id === m.id && w.user_id === me.id)) })
    await supabase.from('on_the_way').delete().eq('meetup_id', m.id).eq('user_id', me.id)
  }

  async function cancel() {
    setData((d) => d && { ...d, meetups: d.meetups.filter((x) => x.id !== m.id) })
    await supabase.from('meetups').update({ cancelled: true }).eq('id', m.id)
  }

  const timeText = voting && timeOpts.length ? 'Time: vote below' : m.starts_at ? when(m.starts_at) : 'Time open'
  const placeText = voting && placeOpts.length ? 'Place: vote below' : m.place

  return (
    <article className="card meetup">
      <div className="row">
        <div className="kind-badge">{k.emoji}</div>
        <div className="grow">
          <h3 className="meetup-title">{m.title}</h3>
          <div className="sub">
            {k.label} · by {host ? nameOf(host.id) : 'someone'}
          </div>
        </div>
      </div>
      <div className="facts">
        <span>🕒 {timeText}</span>
        {placeText && <span>📍 {placeText}</span>}
      </div>
      {m.details && <p className="details">{m.details}</p>}

      {voting && (
        <div className="poll">
          {timeOpts.length > 0 && (
            <PollList title="When?" opts={timeOpts} votes={votes} lead={timeLeader} me={me.id} byId={byId} onVote={vote} labelOf={(o) => when(o.starts_at!)} />
          )}
          {placeOpts.length > 0 && (
            <PollList title="Where?" opts={placeOpts} votes={votes} lead={placeLeader} me={me.id} byId={byId} onVote={vote} labelOf={(o) => o.label ?? ''} />
          )}
          <p className="sub">
            {voters.size} of {byId.size} voted. You can pick more than one.
          </p>
          {m.created_by === me.id && (
            <button className="btn small" onClick={lockIn}>
              Lock it in: {[timeLeader && when(timeLeader.starts_at!), placeLeader?.label].filter(Boolean).join(' · ')}
            </button>
          )}
        </div>
      )}

      <div className="answers">
        {ANSWERS.map((a) => (
          <button key={a.id} className={`answer ${a.id}` + (mine === a.id ? ' on' : '')} onClick={() => respond(a.id)}>
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
          <span className="sub">{going.map((a) => nameOf(a.user_id)).join(', ')} going</span>
        </div>
      )}

      {(otw.length > 0 || mine === 'in') && (
        <div className="otw">
          <p className="label">On the way</p>
          {otw.map((w) => {
            const p = byId.get(w.user_id)
            const status = w.arrived ? 'Arrived ✓' : goal ? distanceText(km(w, goal)) : `Sharing live · ${ago(w.updated_at)}`
            return (
              <div className="row" key={w.user_id}>
                <Avatar p={p} size={32} />
                <div className="grow">
                  <div className="name small">{w.user_id === me.id ? 'You' : p?.display_name}</div>
                  <div className={'sub' + (w.arrived ? ' ok' : '')}>{status}</div>
                </div>
              </div>
            )
          })}
          {mine === 'in' && !myOtw && (
            <button className="btn ghost small" onClick={startOtw}>
              🚶 I'm on my way
            </button>
          )}
          {myOtw && !myOtw.arrived && (
            <p className="sub">
              Your location is shared with this meetup until you arrive (max 3 h).{' '}
              <button className="link inline" onClick={stopOtw}>
                Stop
              </button>
            </p>
          )}
          {(otw.length > 0 || goal) && (
            <button className="link inline" onClick={() => setShowMap((s) => !s)}>
              {showMap ? 'Hide map' : 'Show map'}
            </button>
          )}
          {showMap && (
            <MiniMap
              pin={goal}
              people={otw
                .filter((w) => !w.arrived)
                .map((w) => {
                  const p = byId.get(w.user_id)
                  return { id: w.user_id, lat: w.lat, lng: w.lng, emoji: p?.emoji ?? '🙂', color: p?.color ?? '#999', name: w.user_id === me.id ? 'You' : p?.display_name ?? '?' }
                })}
            />
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {m.created_by === me.id && (
        <button className="link danger" onClick={cancel}>
          Cancel meetup
        </button>
      )}
    </article>
  )
}

/** The option with the most votes; ties go to the earlier option. */
function leader(opts: MeetupOption[], votes: Vote[]): MeetupOption | undefined {
  let best: MeetupOption | undefined
  let bestN = -1
  for (const o of opts) {
    const n = votes.filter((v) => v.option_id === o.id).length
    if (n > bestN) {
      best = o
      bestN = n
    }
  }
  return best
}

function PollList({
  title,
  opts,
  votes,
  lead,
  me,
  byId,
  onVote,
  labelOf,
}: {
  title: string
  opts: MeetupOption[]
  votes: Vote[]
  lead: MeetupOption | undefined
  me: string
  byId: Map<string, Member>
  onVote: (o: MeetupOption) => void
  labelOf: (o: MeetupOption) => string
}) {
  const max = Math.max(1, ...opts.map((o) => votes.filter((v) => v.option_id === o.id).length))
  return (
    <div className="stack-s">
      <p className="label">{title}</p>
      {opts.map((o) => {
        const vs = votes.filter((v) => v.option_id === o.id)
        const mineVoted = vs.some((v) => v.user_id === me)
        const isLead = o.id === lead?.id && vs.length > 0
        return (
          <button key={o.id} className={'poll-opt' + (mineVoted ? ' on' : '')} onClick={() => onVote(o)}>
            <span className="poll-fill" style={{ width: `${(vs.length / max) * 100}%` }} />
            <span className="poll-check">{mineVoted ? '✓' : ''}</span>
            <span className="grow poll-label">
              {labelOf(o)} {isLead && <span className="tag">Leading</span>}
            </span>
            <span className="faces">
              {vs.slice(0, 4).map((v) => (
                <Avatar key={v.user_id} p={byId.get(v.user_id)} size={22} />
              ))}
            </span>
            <b className="poll-n">{vs.length}</b>
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- New meetup ---------------- */

export function NewMeetup({ draft, onClose, onCreated }: { draft: MeetupDraft; onClose: () => void; onCreated: () => void }) {
  const { group, me } = useApp()
  const [kind, setKind] = useState<MeetupKind>(draft.kind ?? 'eat')
  const [title, setTitle] = useState(draft.title ?? '')
  const [timeMode, setTimeMode] = useState<'fixed' | 'vote'>('fixed')
  const [times, setTimes] = useState<string[]>(() => {
    const d = new Date(Date.now() + 2 * 3600e3)
    d.setMinutes(0, 0, 0)
    const d2 = new Date(d.getTime() + 24 * 3600e3)
    return [toLocalInput(d), toLocalInput(d2)]
  })
  const [placeMode, setPlaceMode] = useState<'fixed' | 'vote'>('fixed')
  const [places, setPlaces] = useState<string[]>(['', ''])
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [pinning, setPinning] = useState(false)
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function useMyLocation() {
    setError('')
    try {
      const p = await getPosition()
      setPin({ lat: p.coords.latitude, lng: p.coords.longitude })
    } catch (e) {
      setError(locationErrorText(e))
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    const timeOpts = times.filter(Boolean)
    const placeOpts = places.map((p) => p.trim()).filter(Boolean)
    if (timeMode === 'vote' && timeOpts.length < 2) return setError('Add at least 2 times to vote on.')
    if (placeMode === 'vote' && placeOpts.length < 2) return setError('Add at least 2 places to vote on.')
    setBusy(true)
    setError('')
    const { data, error } = await supabase
      .from('meetups')
      .insert({
        group_id: group.id,
        created_by: me.id,
        kind,
        title: title.trim() || KINDS[kind].example,
        place: placeMode === 'fixed' ? placeOpts[0] || null : null,
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
        details: details.trim() || null,
        starts_at: timeMode === 'fixed' && timeOpts[0] ? new Date(timeOpts[0]).toISOString() : null,
      })
      .select()
      .single()
    if (error) {
      setBusy(false)
      return setError(niceError(error))
    }
    const id = (data as Meetup).id
    const opts = [
      ...(timeMode === 'vote' ? timeOpts.map((t, i) => ({ meetup_id: id, kind: 'time', starts_at: new Date(t).toISOString(), position: i })) : []),
      ...(placeMode === 'vote' ? placeOpts.map((p, i) => ({ meetup_id: id, kind: 'place', label: p, position: i })) : []),
    ]
    if (opts.length) await supabase.from('meetup_options').insert(opts)
    await supabase.from('meetup_responses').insert({ meetup_id: id, user_id: me.id, answer: 'in' })
    onCreated()
    onClose()
  }

  const editList = (list: string[], set: (v: string[]) => void, i: number, v: string) => set(list.map((x, j) => (j === i ? v : x)))

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

        <div className="field">
          When?
          <div className="seg two">
            <button type="button" className={timeMode === 'fixed' ? 'on' : ''} onClick={() => setTimeMode('fixed')}>
              Set a time
            </button>
            <button type="button" className={timeMode === 'vote' ? 'on' : ''} onClick={() => setTimeMode('vote')}>
              Let friends vote
            </button>
          </div>
          {(timeMode === 'fixed' ? times.slice(0, 1) : times).map((t, i) => (
            <div className="row" key={i}>
              <input id={`meetup-time-${i}`} className="input grow" type="datetime-local" value={t} onChange={(e) => editList(times, setTimes, i, e.target.value)} />
              {timeMode === 'vote' && times.length > 2 && (
                <button type="button" className="icon-btn" aria-label="Remove time" onClick={() => setTimes(times.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {timeMode === 'vote' && times.length < 4 && (
            <button type="button" className="link inline" onClick={() => setTimes([...times, times[times.length - 1]])}>
              + Add another time
            </button>
          )}
        </div>

        <div className="field">
          Where?
          <div className="seg two">
            <button type="button" className={placeMode === 'fixed' ? 'on' : ''} onClick={() => setPlaceMode('fixed')}>
              Set a place
            </button>
            <button type="button" className={placeMode === 'vote' ? 'on' : ''} onClick={() => setPlaceMode('vote')}>
              Let friends vote
            </button>
          </div>
          {(placeMode === 'fixed' ? places.slice(0, 1) : places).map((p, i) => (
            <div className="row" key={i}>
              <input
                id={`meetup-place-${i}`}
                className="input grow"
                placeholder={i === 0 ? "e.g. Luigi's, my place, the park" : 'Another option'}
                maxLength={120}
                value={p}
                onChange={(e) => editList(places, setPlaces, i, e.target.value)}
              />
              {placeMode === 'vote' && places.length > 2 && (
                <button type="button" className="icon-btn" aria-label="Remove place" onClick={() => setPlaces(places.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {placeMode === 'vote' && places.length < 4 && (
            <button type="button" className="link inline" onClick={() => setPlaces([...places, ''])}>
              + Add another place
            </button>
          )}
          {placeMode === 'fixed' &&
            (pinning ? (
              <div className="stack-s">
                <p className="sub">Tap the map to set the meeting point. Friends who are "on their way" then see how far away they are.</p>
                <MiniMap pin={pin} onPick={setPin} height={200} />
                <div className="row">
                  <button type="button" className="btn ghost small" onClick={useMyLocation}>
                    Use my location
                  </button>
                  <button
                    type="button"
                    className="link inline"
                    onClick={() => {
                      setPin(null)
                      setPinning(false)
                    }}
                  >
                    Remove pin
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="link inline" onClick={() => setPinning(true)}>
                📍 Pin it on the map (optional)
              </button>
            ))}
        </div>

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
