import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp, useTick, type MeetupDraft } from '../lib/app'
import { ago, day, toLocalInput, when } from '../lib/time'
import { t, tn } from '../lib/i18n'
import { privacyOn, useSettings } from '../lib/settings'
import { addToCalendar, directionsUrl, weatherAt, type Weather } from '../lib/meetupTools'
import { distanceText, km } from '../lib/geo'
import { getPosition, locationErrorText } from '../lib/location'
import { Avatar, Section, Sheet } from '../components/ui'
import { MiniMap } from '../components/MiniMap'
import { BestDay } from './BestDay'
import { money, SplitBillSheet, useExpenses } from './Bills'
import { BringList, LateTracker, type Checkin, type Item } from './MeetupExtras'
import { saveSpot, useSpots } from './Spots'
import { LatestSpin, WheelSheet } from './Wheel'
import type { Answer, Expense, Meetup, MeetupKind, MeetupOption, MeetupResponse, Member, OnTheWay, Rating, Spot, Vote } from '../types'

export const KINDS: Record<MeetupKind, { emoji: string; label: string; example: string }> = {
  party: { emoji: '🎉', label: 'Party', example: 'Party at mine?' },
  eat: { emoji: '🍕', label: 'Eat', example: 'Pizza tonight?' },
  sport: { emoji: '⚽', label: 'Sport', example: 'Football in the park?' },
  chill: { emoji: '🛋️', label: 'Chill', example: 'Just hang out?' },
  gaming: { emoji: '🎮', label: 'Gaming', example: 'Gaming session?' },
  other: { emoji: '✨', label: 'Other', example: 'Anyone up for…' },
}

export const ANSWERS: { id: Answer; label: string }[] = [
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
  items: Item[]
  checkins: Checkin[]
  ratings: Rating[]
  views: { meetup_id: string; user_id: string }[]
}

/** Meetups stay "current" until 4 h after the start; then they move to "Recent" for 3 days (to rate them). */
const CURRENT_MS = 4 * 3600e3
const RECENT_MS = 3 * 86400e3
const isCurrent = (m: Meetup) => !m.starts_at || Date.parse(m.starts_at) > Date.now() - CURRENT_MS

export function Meetups() {
  const { group, members, me, openNewMeetup } = useApp()
  const settings = useSettings()
  const { spots } = useSpots()
  const [data, setData] = useState<Data | null>(null)
  const [wheel, setWheel] = useState(false)
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const bills = useExpenses()
  useTick()

  const load = useCallback(async () => {
    const since = new Date(Date.now() - RECENT_MS).toISOString()
    const { data: ms } = await supabase
      .from('meetups')
      .select('*')
      .eq('group_id', group.id)
      .eq('cancelled', false)
      .or(`starts_at.is.null,starts_at.gte."${since}"`)
      .order('starts_at', { ascending: true, nullsFirst: true })
    const meetups = (ms as Meetup[]) ?? []
    const ids = meetups.map((m) => m.id)
    if (!ids.length) return setData({ meetups, answers: [], options: [], votes: [], otw: [], items: [], checkins: [], ratings: [], views: [] })
    const [r, o, w, it, ci, ra, vw] = await Promise.all([
      supabase.from('meetup_responses').select('*').in('meetup_id', ids),
      supabase.from('meetup_options').select('*').in('meetup_id', ids).order('position'),
      supabase.from('on_the_way').select('*').in('meetup_id', ids),
      supabase.from('meetup_items').select('*').in('meetup_id', ids).order('created_at'),
      supabase.from('meetup_checkins').select('*').in('meetup_id', ids),
      supabase.from('meetup_ratings').select('*').in('meetup_id', ids),
      supabase.from('meetup_views').select('meetup_id, user_id').in('meetup_id', ids),
    ])
    const options = (o.data as MeetupOption[]) ?? []
    const v = options.length ? await supabase.from('meetup_votes').select('*').in('option_id', options.map((x) => x.id)) : { data: [] }
    setData({
      meetups,
      answers: (r.data as MeetupResponse[]) ?? [],
      options,
      votes: (v.data as Vote[]) ?? [],
      otw: (w.data as OnTheWay[]) ?? [],
      items: (it.data as Item[]) ?? [],
      checkins: (ci.data as Checkin[]) ?? [],
      ratings: (ra.data as Rating[]) ?? [],
      views: (vw.data as Data['views']) ?? [],
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
    for (const table of ['meetups', 'meetup_responses', 'meetup_options', 'meetup_votes', 'on_the_way', 'meetup_items', 'meetup_checkins', 'meetup_ratings', 'meetup_views']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, reload)
    }
    ch.subscribe()
    return () => {
      window.clearTimeout(timer.current)
      supabase.removeChannel(ch)
    }
  }, [group.id, load, reload])

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  // My last shared spot: used for the weather when a meetup has no pin
  useEffect(() => {
    supabase
      .from('locations')
      .select('lat, lng')
      .eq('user_id', me.id)
      .maybeSingle()
      .then(({ data }) => data && setMyLoc(data as { lat: number; lng: number }))
  }, [me.id])

  // "Seen by": mark the meetups I can see
  const shareSeen = privacyOn(me.privacy, 'seen')
  const seenKey = data?.meetups.map((m) => m.id).join(',') ?? ''
  useEffect(() => {
    if (!data || !shareSeen) return
    const rows = data.meetups.filter((m) => m.created_by !== me.id && !data.views.some((v) => v.meetup_id === m.id && v.user_id === me.id)).map((m) => ({ meetup_id: m.id, user_id: me.id }))
    if (rows.length) supabase.from('meetup_views').upsert(rows, { ignoreDuplicates: true }).then(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenKey, shareSeen])

  const current = data?.meetups.filter(isCurrent) ?? []
  const recent = (data?.meetups.filter((m) => !isCurrent(m)) ?? []).reverse()

  /** Where to check the weather: the pin, a favourite spot with the same name, or my last spot. */
  const coordsFor = (m: Meetup) => {
    if (m.lat != null && m.lng != null) return { lat: m.lat, lng: m.lng }
    const spot = spots.find((s: Spot) => s.lat != null && m.place && s.name.toLowerCase() === m.place.trim().toLowerCase())
    if (spot) return { lat: spot.lat!, lng: spot.lng! }
    return myLoc
  }

  return (
    <>
      <div className="row full">
        <button className="btn grow" onClick={() => openNewMeetup()}>
          + {t('New meetup')}
        </button>
        <button className="btn ghost" onClick={() => setWheel(true)}>
          🎡 {t('Decide')}
        </button>
      </div>
      <LatestSpin />
      {settings.showBestDay && <BestDay />}

      {data === null && <p className="muted">{t('Loading…')}</p>}
      {data && current.length === 0 && (
        <div className="empty">
          <div className="empty-icon">📅</div>
          {t('No plans yet. Start one: pizza, party, football, anything.')}
        </div>
      )}

      {data && current.map((m) => (
        <MeetupCard
          key={m.id}
          m={m}
          answers={data.answers.filter((a) => a.meetup_id === m.id)}
          options={data.options.filter((o) => o.meetup_id === m.id)}
          votes={data.votes}
          otw={data.otw.filter((w) => w.meetup_id === m.id)}
          expenses={bills.expenses.filter((e) => e.meetup_id === m.id && !e.is_settlement)}
          onBills={bills.reload}
          items={data.items.filter((i) => i.meetup_id === m.id)}
          checkins={data.checkins.filter((c) => c.meetup_id === m.id)}
          ratings={data.ratings.filter((x) => x.meetup_id === m.id)}
          views={data.views.filter((v) => v.meetup_id === m.id && v.user_id !== m.created_by)}
          coords={settings.showWeather ? coordsFor(m) : null}
          byId={byId}
          setData={setData}
          reload={reload}
        />
      ))}

      {data && recent.length > 0 && (
        <Section title={t('Recent')}>
          {recent.map((m) => (
            <PastCard
              key={m.id}
              m={m}
              going={data.answers.filter((a) => a.meetup_id === m.id && a.answer === 'in').map((a) => a.user_id)}
              ratings={data.ratings.filter((x) => x.meetup_id === m.id)}
              byId={byId}
              setData={setData}
            />
          ))}
        </Section>
      )}
      {wheel && <WheelSheet onClose={() => setWheel(false)} />}
    </>
  )
}

/* ---------------- Ratings ---------------- */

function Stars({ value, onPick, size = '' }: { value: number; onPick?: (n: number) => void; size?: string }) {
  return (
    <span className={'stars ' + size} role={onPick ? 'radiogroup' : undefined} aria-label={t('{n} of 5 stars', { n: value })}>
      {[1, 2, 3, 4, 5].map((n) =>
        onPick ? (
          <button key={n} className={'star' + (n <= value ? ' on' : '')} onClick={() => onPick(n)} role="radio" aria-checked={n === value} aria-label={tn(n, '{n} star', '{n} stars')}>
            ★
          </button>
        ) : (
          <span key={n} className={'star' + (n <= Math.round(value) ? ' on' : '')} aria-hidden>
            ★
          </span>
        ),
      )}
    </span>
  )
}

async function rate(meetupId: string, userId: string, stars: number, setData: Dispatch<SetStateAction<Data | null>>) {
  setData((d) => d && { ...d, ratings: [...d.ratings.filter((x) => !(x.meetup_id === meetupId && x.user_id === userId)), { meetup_id: meetupId, user_id: userId, stars }] })
  await supabase.from('meetup_ratings').upsert({ meetup_id: meetupId, user_id: userId, stars })
}

const average = (rs: Rating[]) => (rs.length ? rs.reduce((a, b) => a + b.stars, 0) / rs.length : 0)

function RateRow({ m, ratings, setData }: { m: Meetup; ratings: Rating[]; setData: Dispatch<SetStateAction<Data | null>> }) {
  const { me } = useApp()
  const mine = ratings.find((x) => x.user_id === me.id)?.stars ?? 0
  return (
    <div className="rate-row">
      <span className="grow">
        <span className="name small block">{mine ? t('Your rating') : t('How was it?')}</span>
        {ratings.length > 0 && (
          <span className="sub tiny">
            {t('Group: {avg} ★ from {n}', { avg: average(ratings).toFixed(1), n: ratings.length })}
          </span>
        )}
      </span>
      <Stars value={mine} onPick={(n) => rate(m.id, me.id, n, setData)} size="big" />
    </div>
  )
}

/** A meetup that already happened: rate it if you were there. */
function PastCard({ m, going, ratings, byId, setData }: { m: Meetup; going: string[]; ratings: Rating[]; byId: Map<string, Member>; setData: Dispatch<SetStateAction<Data | null>> }) {
  const { me } = useApp()
  const wasThere = going.includes(me.id)
  return (
    <article className="card past">
      <div className="row">
        <div className="kind-badge small">{KINDS[m.kind].emoji}</div>
        <div className="grow">
          <div className="name">{m.title}</div>
          <div className="sub">
            {m.starts_at && day(m.starts_at)}
            {m.place ? ' · ' + m.place : ''}
          </div>
        </div>
        <div className="faces">
          {going.slice(0, 5).map((id) => (
            <Avatar key={id} p={byId.get(id)} size={24} />
          ))}
        </div>
      </div>
      {wasThere ? (
        <RateRow m={m} ratings={ratings} setData={setData} />
      ) : (
        ratings.length > 0 && (
          <div className="row">
            <Stars value={average(ratings)} />
            <span className="sub tiny">{t('{avg} from {n}', { avg: average(ratings).toFixed(1), n: ratings.length })}</span>
          </div>
        )
      )}
    </article>
  )
}

/* ---------------- Weather chip ---------------- */

function WeatherChip({ at, coords }: { at: string; coords: { lat: number; lng: number } }) {
  const [w, setW] = useState<Weather | null>(null)
  useEffect(() => {
    let alive = true
    weatherAt(coords.lat, coords.lng, at).then((x) => alive && setW(x))
    return () => {
      alive = false
    }
  }, [at, coords.lat, coords.lng])
  if (!w) return null
  const wet = w.rain >= 50
  return (
    <span className={'weather' + (wet ? ' wet' : '')} title={w.text}>
      {w.emoji} {w.temp}°{w.rain >= 20 ? ` · 💧${w.rain}%` : ''}
      {wet && <span className="sub tiny"> · {t('bring a jacket')}</span>}
    </span>
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
  expenses,
  onBills,
  items,
  checkins,
  ratings,
  views,
  coords,
}: {
  m: Meetup
  answers: MeetupResponse[]
  options: MeetupOption[]
  votes: Vote[]
  otw: OnTheWay[]
  byId: Map<string, Member>
  setData: Dispatch<SetStateAction<Data | null>>
  reload: () => void
  expenses: Expense[]
  onBills: () => void
  items: Item[]
  checkins: Checkin[]
  ratings: Rating[]
  views: { meetup_id: string; user_id: string }[]
  coords: { lat: number; lng: number } | null
}) {
  const { me } = useApp()
  const [showMap, setShowMap] = useState(false)
  const [showSeen, setShowSeen] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [error, setError] = useState('')
  const k = KINDS[m.kind]
  const host = byId.get(m.created_by)
  const mine = answers.find((a) => a.user_id === me.id)?.answer
  const going = answers.filter((a) => a.answer === 'in')
  const count = (x: Answer) => answers.filter((a) => a.answer === x).length
  const nameOf = (id: string) => (id === me.id ? t('you') : byId.get(id)?.display_name ?? '?')

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

  const timeText = voting && timeOpts.length ? t('Time: vote below') : m.starts_at ? when(m.starts_at) : t('Time open')
  const placeText = voting && placeOpts.length ? t('Place: vote below') : m.place
  const route = !voting || !placeOpts.length ? directionsUrl(m) : null
  const started = !!m.starts_at && Date.now() > Date.parse(m.starts_at) + 30 * 60000

  return (
    <article className="card meetup">
      <div className="row">
        <div className="kind-badge">{k.emoji}</div>
        <div className="grow">
          <h3 className="meetup-title">{m.title}</h3>
          <div className="sub">
            {t(k.label)} · {t('by {name}', { name: host ? nameOf(host.id) : t('someone') })}
          </div>
        </div>
      </div>
      <div className="facts">
        <span>🕒 {timeText}</span>
        {placeText && <span>📍 {placeText}</span>}
      </div>
      {m.details && <p className="details">{m.details}</p>}
      {(m.starts_at || route) && (
        <div className="meetup-tools">
          {m.starts_at && coords && !voting && <WeatherChip at={m.starts_at} coords={coords} />}
          {m.starts_at && (!voting || !timeOpts.length) && (
            <button className="tool" onClick={() => addToCalendar(m)}>
              📅 {t('Calendar')}
            </button>
          )}
          {route && (
            <a className="tool" href={route} target="_blank" rel="noopener noreferrer">
              🧭 {t('Directions')}
            </a>
          )}
        </div>
      )}

      {voting && (
        <div className="poll">
          {timeOpts.length > 0 && (
            <PollList title={t('When?')} opts={timeOpts} votes={votes} lead={timeLeader} me={me.id} byId={byId} onVote={vote} labelOf={(o) => when(o.starts_at!)} />
          )}
          {placeOpts.length > 0 && (
            <PollList title={t('Where?')} opts={placeOpts} votes={votes} lead={placeLeader} me={me.id} byId={byId} onVote={vote} labelOf={(o) => o.label ?? ''} />
          )}
          <p className="sub">{t('{n} of {total} voted. You can pick more than one.', { n: voters.size, total: byId.size })}</p>
          {m.created_by === me.id && (
            <button className="btn small" onClick={lockIn}>
              {t('Lock it in:')} {[timeLeader && when(timeLeader.starts_at!), placeLeader?.label].filter(Boolean).join(' · ')}
            </button>
          )}
        </div>
      )}

      <div className="answers">
        {ANSWERS.map((a) => (
          <button key={a.id} className={`answer ${a.id}` + (mine === a.id ? ' on' : '')} onClick={() => respond(a.id)}>
            {t(a.label)} <b>{count(a.id) || ''}</b>
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
          <span className="sub">{t('{names} going', { names: going.map((a) => nameOf(a.user_id)).join(', ') })}</span>
        </div>
      )}

      {(otw.length > 0 || mine === 'in') && (
        <div className="otw">
          <p className="label">{t('On the way')}</p>
          {otw.map((w) => {
            const p = byId.get(w.user_id)
            const status = w.arrived ? t('Arrived ✓') : goal ? distanceText(km(w, goal)) : t('Sharing live · {ago}', { ago: ago(w.updated_at) })
            return (
              <div className="row" key={w.user_id}>
                <Avatar p={p} size={32} />
                <div className="grow">
                  <div className="name small">{w.user_id === me.id ? t('You') : p?.display_name}</div>
                  <div className={'sub' + (w.arrived ? ' ok' : '')}>{status}</div>
                </div>
              </div>
            )
          })}
          {mine === 'in' && !myOtw && (
            <button className="btn ghost small" onClick={startOtw}>
              🚶 {t("I'm on my way")}
            </button>
          )}
          {myOtw && !myOtw.arrived && (
            <p className="sub">
              {t('Your location is shared with this meetup until you arrive (max 3 h).')}{' '}
              <button className="link inline" onClick={stopOtw}>
                {t('Stop')}
              </button>
            </p>
          )}
          {(otw.length > 0 || goal) && (
            <button className="link inline" onClick={() => setShowMap((s) => !s)}>
              {showMap ? t('Hide map') : t('Show map')}
            </button>
          )}
          {showMap && (
            <MiniMap
              pin={goal}
              people={otw
                .filter((w) => !w.arrived)
                .map((w) => {
                  const p = byId.get(w.user_id)
                  return { id: w.user_id, lat: w.lat, lng: w.lng, emoji: p?.emoji ?? '🙂', color: p?.color ?? '#999', name: w.user_id === me.id ? t('You') : p?.display_name ?? '?' }
                })}
            />
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}

      <LateTracker m={m} answers={answers} checkins={checkins} byId={byId} reload={reload} />
      {started && mine === 'in' && <RateRow m={m} ratings={ratings} setData={setData} />}
      <BringList m={m} items={items} byId={byId} reload={reload} />

      <div className="bills">
        {expenses.map((e) => (
          <div className="sub" key={e.id}>
            💸 {t('{name} paid {amount}', { name: e.paid_by === me.id ? t('You') : nameOf(e.paid_by), amount: money(e.amount_cents) })}
            {e.note ? ' · ' + e.note : ''}
          </div>
        ))}
        <button className="link inline" onClick={() => setSplitting(true)}>
          💸 {t('Split a bill')}
        </button>
      </div>
      {splitting && <SplitBillSheet meetupId={m.id} defaultPeople={going.map((a) => a.user_id)} onClose={() => setSplitting(false)} onSaved={onBills} />}

      {m.created_by === me.id && (
        <div className="card-foot">
          {privacyOn(me.privacy, 'seen') && (
            <button className="link inline" onClick={() => setShowSeen((x) => !x)}>
              👀 {views.length ? tn(views.length, 'Seen by {n}', 'Seen by {n}') : t('Not seen yet')}
            </button>
          )}
          <button className="link danger inline" onClick={cancel}>
            {t('Cancel meetup')}
          </button>
        </div>
      )}
      {showSeen && views.length > 0 && <p className="sub tiny">{views.map((v) => nameOf(v.user_id)).join(', ')}</p>}
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
              {labelOf(o)} {isLead && <span className="tag">{t('Leading')}</span>}
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
  const { spots } = useSpots()
  const [saveAsSpot, setSaveAsSpot] = useState(false)
  const [kind, setKind] = useState<MeetupKind>(draft.kind ?? 'eat')
  const [title, setTitle] = useState(draft.title ?? '')
  const [timeMode, setTimeMode] = useState<'fixed' | 'vote'>('fixed')
  const [times, setTimes] = useState<string[]>(() => {
    const d = draft.startsAt ? new Date(draft.startsAt) : new Date(Date.now() + 2 * 3600e3)
    d.setMinutes(0, 0, 0)
    const d2 = new Date(d.getTime() + 24 * 3600e3)
    return [toLocalInput(d), toLocalInput(d2)]
  })
  const [placeMode, setPlaceMode] = useState<'fixed' | 'vote'>('fixed')
  const [places, setPlaces] = useState<string[]>([draft.place ?? '', ''])
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
    if (timeMode === 'vote' && timeOpts.length < 2) return setError(t('Add at least 2 times to vote on.'))
    if (placeMode === 'vote' && placeOpts.length < 2) return setError(t('Add at least 2 places to vote on.'))
    setBusy(true)
    setError('')
    const { data, error } = await supabase
      .from('meetups')
      .insert({
        group_id: group.id,
        created_by: me.id,
        kind,
        title: title.trim() || t(KINDS[kind].example),
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
      ...(timeMode === 'vote' ? timeOpts.map((tm, i) => ({ meetup_id: id, kind: 'time', starts_at: new Date(tm).toISOString(), position: i })) : []),
      ...(placeMode === 'vote' ? placeOpts.map((p, i) => ({ meetup_id: id, kind: 'place', label: p, position: i })) : []),
    ]
    if (opts.length) await supabase.from('meetup_options').insert(opts)
    await supabase.from('meetup_responses').insert({ meetup_id: id, user_id: me.id, answer: 'in' })
    if (saveAsSpot && placeMode === 'fixed' && placeOpts[0] && !spots.some((s) => s.name.toLowerCase() === placeOpts[0].toLowerCase())) await saveSpot(group.id, me.id, placeOpts[0], pin)
    onCreated()
    onClose()
  }

  const editList = (list: string[], set: (v: string[]) => void, i: number, v: string) => set(list.map((x, j) => (j === i ? v : x)))

  return (
    <Sheet title={t('New meetup')} onClose={onClose}>
      <form className="stack" onSubmit={create}>
        <div className="kind-grid">
          {(Object.keys(KINDS) as MeetupKind[]).map((k) => (
            <button type="button" key={k} className={'kind-pick' + (k === kind ? ' on' : '')} onClick={() => setKind(k)}>
              <span>{KINDS[k].emoji}</span>
              {t(KINDS[k].label)}
            </button>
          ))}
        </div>
        <label className="field">
          {t('What?')}
          <input id="meetup-title" className="input" placeholder={t(KINDS[kind].example)} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <div className="field">
          {t('When?')}
          <div className="seg two">
            <button type="button" className={timeMode === 'fixed' ? 'on' : ''} onClick={() => setTimeMode('fixed')}>
              {t('Set a time')}
            </button>
            <button type="button" className={timeMode === 'vote' ? 'on' : ''} onClick={() => setTimeMode('vote')}>
              {t('Let friends vote')}
            </button>
          </div>
          {(timeMode === 'fixed' ? times.slice(0, 1) : times).map((tm, i) => (
            <div className="row" key={i}>
              <input id={`meetup-time-${i}`} className="input grow" type="datetime-local" value={tm} onChange={(e) => editList(times, setTimes, i, e.target.value)} />
              {timeMode === 'vote' && times.length > 2 && (
                <button type="button" className="icon-btn" aria-label={t('Remove time')} onClick={() => setTimes(times.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {timeMode === 'vote' && times.length < 4 && (
            <button type="button" className="link inline" onClick={() => setTimes([...times, times[times.length - 1]])}>
              + {t('Add another time')}
            </button>
          )}
        </div>

        <div className="field">
          {t('Where?')}
          <div className="seg two">
            <button type="button" className={placeMode === 'fixed' ? 'on' : ''} onClick={() => setPlaceMode('fixed')}>
              {t('Set a place')}
            </button>
            <button type="button" className={placeMode === 'vote' ? 'on' : ''} onClick={() => setPlaceMode('vote')}>
              {t('Let friends vote')}
            </button>
          </div>
          {(placeMode === 'fixed' ? places.slice(0, 1) : places).map((p, i) => (
            <div className="row" key={i}>
              <input
                id={`meetup-place-${i}`}
                className="input grow"
                placeholder={i === 0 ? t("e.g. Luigi's, my place, the park") : t('Another option')}
                maxLength={120}
                value={p}
                onChange={(e) => editList(places, setPlaces, i, e.target.value)}
              />
              {placeMode === 'vote' && places.length > 2 && (
                <button type="button" className="icon-btn" aria-label={t('Remove place')} onClick={() => setPlaces(places.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {placeMode === 'vote' && places.length < 4 && (
            <button type="button" className="link inline" onClick={() => setPlaces([...places, ''])}>
              + {t('Add another place')}
            </button>
          )}
          {placeMode === 'fixed' && spots.length > 0 && (
            <div className="chips">
              {spots.map((sp) => (
                <button
                  type="button"
                  key={sp.id}
                  className={'chip' + (places[0] === sp.name ? ' on' : '')}
                  onClick={() => {
                    setPlaces([sp.name, ...places.slice(1)])
                    if (sp.lat != null && sp.lng != null) setPin({ lat: sp.lat, lng: sp.lng })
                  }}
                >
                  {sp.emoji} {sp.name}
                </button>
              ))}
            </div>
          )}
          {placeMode === 'fixed' && places[0].trim() && !spots.some((sp) => sp.name.toLowerCase() === places[0].trim().toLowerCase()) && (
            <label className="check-row">
              <input type="checkbox" checked={saveAsSpot} onChange={(e) => setSaveAsSpot(e.target.checked)} />
              ⭐ {t('Save as favourite spot')}
            </label>
          )}
          {placeMode === 'fixed' &&
            (pinning ? (
              <div className="stack-s">
                <p className="sub">{t('Tap the map to set the meeting point. Friends who are "on their way" then see how far away they are.')}</p>
                <MiniMap pin={pin} onPick={setPin} height={200} />
                <div className="row">
                  <button type="button" className="btn ghost small" onClick={useMyLocation}>
                    {t('Use my location')}
                  </button>
                  <button
                    type="button"
                    className="link inline"
                    onClick={() => {
                      setPin(null)
                      setPinning(false)
                    }}
                  >
                    {t('Remove pin')}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="link inline" onClick={() => setPinning(true)}>
                📍 {t('Pin it on the map (optional)')}
              </button>
            ))}
        </div>

        <label className="field">
          {t('Anything else?')}
          <textarea id="meetup-details" className="input" rows={2} maxLength={500} placeholder={t('Optional')} value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn block" disabled={busy}>
          {t('Ask the group')} {KINDS[kind].emoji}
        </button>
      </form>
    </Sheet>
  )
}
