import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { toLocalInput } from '../lib/time'
import { Sheet } from '../components/ui'

// Holidays come from OpenHolidays (free, no key): https://openholidaysapi.org
const API = 'https://openholidaysapi.org'

interface Countdown {
  id: string
  title: string
  emoji: string
  day: string
  created_by: string
}

interface Item {
  key: string
  title: string
  emoji: string
  day: string
  mine?: string
  kind: 'own' | 'holiday' | 'school'
}

interface ApiHoliday {
  id: string
  startDate: string
  name: { language: string; text: string }[]
}

const todayKey = () => toLocalInput(new Date()).slice(0, 10)

function daysUntil(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / 86400e3)
}

const holidayCache = new Map<string, Item[]>()

async function fetchHolidays(country: string, subdivision: string | null): Promise<Item[]> {
  const from = todayKey()
  const toD = new Date()
  toD.setDate(toD.getDate() + 200)
  const to = toLocalInput(toD).slice(0, 10)
  const key = `${country}|${subdivision}|${from}`
  if (holidayCache.has(key)) return holidayCache.get(key)!
  const q = `countryIsoCode=${country}&languageIsoCode=EN&validFrom=${from}&validTo=${to}${subdivision ? `&subdivisionCode=${subdivision}` : ''}`
  const get = async (path: string): Promise<ApiHoliday[]> => {
    try {
      const r = await fetch(`${API}/${path}?${q}`)
      return r.ok ? await r.json() : []
    } catch {
      return []
    }
  }
  const [pub, school] = await Promise.all([get('PublicHolidays'), get('SchoolHolidays')])
  const name = (h: ApiHoliday) => h.name.find((n) => n.language === 'EN')?.text ?? h.name[0]?.text ?? 'Holiday'
  const items: Item[] = [
    ...pub.map((h) => ({ key: 'p' + h.id, title: name(h), emoji: holidayEmoji(name(h)), day: h.startDate, kind: 'holiday' as const })),
    ...school.map((h) => ({ key: 's' + h.id, title: name(h), emoji: '🏖️', day: h.startDate, kind: 'school' as const })),
  ]
  holidayCache.set(key, items)
  return items
}

function holidayEmoji(n: string): string {
  const s = n.toLowerCase()
  if (s.includes('christmas')) return '🎄'
  if (s.includes('new year')) return '🎆'
  if (s.includes('easter')) return '🐣'
  if (s.includes('labour') || s.includes('may day')) return '🛠️'
  return '🎉'
}

/** "Coming up" card on the feed: the group's own countdowns + holidays + school holidays for the group's region. */
export function CountdownsCard({ onSetRegion }: { onSetRegion: () => void }) {
  const { group, me } = useApp()
  const [own, setOwn] = useState<Countdown[]>([])
  const [holidays, setHolidays] = useState<Item[]>([])
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('countdowns').select('*').eq('group_id', group.id).gte('day', todayKey()).order('day')
    setOwn((data as Countdown[]) ?? [])
  }, [group.id])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('countdowns-' + group.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'countdowns', filter: `group_id=eq.${group.id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [group.id, load])

  useEffect(() => {
    let alive = true
    if (group.country) fetchHolidays(group.country, group.subdivision ?? null).then((h) => alive && setHolidays(h))
    else setHolidays([])
    return () => {
      alive = false
    }
  }, [group.country, group.subdivision])

  async function remove(id: string) {
    setOwn((prev) => prev.filter((c) => c.id !== id))
    await supabase.from('countdowns').delete().eq('id', id)
  }

  const items: Item[] = [...own.map((c) => ({ key: c.id, title: c.title, emoji: c.emoji, day: c.day, mine: c.created_by === me.id ? c.id : undefined, kind: 'own' as const })), ...holidays]
    .filter((i) => daysUntil(i.day) >= 0)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.kind === 'own' ? -1 : 1))
  const shown = showAll ? items : items.slice(0, 4)

  return (
    <section className="card">
      <div className="row">
        <p className="label grow">Coming up</p>
        <button className="link inline" onClick={() => setAdding(true)}>
          + Countdown
        </button>
      </div>
      {!group.country && (
        <button className="hint" onClick={onSetRegion}>
          📍 Set your group's region to see holidays and school holidays here.
        </button>
      )}
      {items.length === 0 && group.country && <p className="sub">Nothing coming up. Add a countdown for your next big thing.</p>}
      <div className="countdowns">
        {shown.map((i) => {
          const n = daysUntil(i.day)
          return (
            <div className={'countdown ' + i.kind} key={i.key}>
              <span className="cd-emoji">{i.emoji}</span>
              <span className="grow">
                <span className="name small block">{i.title}</span>
                <span className="sub tiny">{i.kind === 'school' ? 'School holidays' : i.kind === 'holiday' ? 'Public holiday' : 'Countdown'}</span>
              </span>
              <span className="cd-days">
                {n === 0 ? 'Today!' : n === 1 ? 'Tomorrow' : (
                  <>
                    <b>{n}</b> days
                  </>
                )}
              </span>
              {i.mine && (
                <button className="icon-btn faint" aria-label="Delete countdown" onClick={() => remove(i.mine!)}>
                  ✕
                </button>
              )}
            </div>
          )
        })}
      </div>
      {items.length > 4 && (
        <button className="link inline" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show less' : `Show all ${items.length}`}
        </button>
      )}
      {adding && <AddCountdown onClose={() => setAdding(false)} onSaved={load} />}
    </section>
  )
}

const CD_EMOJIS = ['⏳', '🎉', '🎂', '✈️', '🏖️', '🎵', '🎓', '⚽', '🎮', '🎄']

function AddCountdown({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { group, me } = useApp()
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('⏳')
  const [day, setDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('countdowns').insert({ group_id: group.id, created_by: me.id, title: title.trim(), emoji, day })
    setBusy(false)
    if (error) return setError(niceError(error))
    onSaved()
    onClose()
  }

  return (
    <Sheet title="New countdown" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          What's happening?
          <input id="cd-title" className="input" maxLength={40} placeholder="e.g. Festival, Lea's birthday, Holidays" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="field">
          When?
          <input id="cd-day" className="input" type="date" min={todayKey()} value={day} onChange={(e) => setDay(e.target.value)} required />
        </label>
        <div className="chips wrap">
          {CD_EMOJIS.map((x) => (
            <button type="button" key={x} className={'chip emoji' + (x === emoji ? ' on' : '')} onClick={() => setEmoji(x)}>
              {x}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn block" disabled={busy || !title.trim() || !day}>
          Start countdown {emoji}
        </button>
      </form>
    </Sheet>
  )
}

/* ---------------- Region setting (Group tab) ---------------- */

interface Country {
  isoCode: string
  name: { language: string; text: string }[]
}
interface Subdivision {
  code: string
  name: { language: string; text: string }[]
  children?: Subdivision[]
}
const en = (n: { language: string; text: string }[]) => n.find((x) => x.language === 'EN')?.text ?? n[0]?.text ?? ''

export function RegionCard() {
  const { group, me, members, reloadGroups } = useApp()
  const isAdmin = members.find((m) => m.id === me.id)?.role === 'admin'
  const [countries, setCountries] = useState<Country[]>([])
  const [subs, setSubs] = useState<Subdivision[]>([])
  const [country, setCountry] = useState(group.country ?? '')
  const [sub, setSub] = useState(group.subdivision ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch(`${API}/Countries?languageIsoCode=EN`)
      .then((r) => r.json())
      .then((c: Country[]) => setCountries(c.sort((a, b) => en(a.name).localeCompare(en(b.name)))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!country) return setSubs([])
    fetch(`${API}/Subdivisions?countryIsoCode=${country}&languageIsoCode=EN`)
      .then((r) => r.json())
      .then((s: Subdivision[]) => setSubs(s.sort((a, b) => en(a.name).localeCompare(en(b.name)))))
      .catch(() => setSubs([]))
  }, [country])

  async function save(c: string, s: string) {
    setBusy(true)
    setMsg('')
    const { error } = await supabase.from('groups').update({ country: c || null, subdivision: s || null }).eq('id', group.id)
    await reloadGroups()
    setBusy(false)
    setMsg(error ? niceError(error) : 'Saved ✓')
  }

  /** Find country + state from where you are right now (OpenStreetMap lookup). */
  async function detect() {
    setBusy(true)
    setMsg('')
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 15000 }))
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`)
      const j = await r.json()
      const c = String(j.address?.country_code ?? '').toUpperCase()
      const s = String(j.address?.['ISO3166-2-lvl4'] ?? '')
      if (!c) throw new Error()
      setCountry(c)
      setSub(s)
      await save(c, s)
    } catch {
      setBusy(false)
      setMsg('Could not find your region. Pick it from the list instead.')
    }
  }

  const label = [en(countries.find((c) => c.isoCode === group.country)?.name ?? []), en(subs.find((s) => s.code === group.subdivision)?.name ?? [])].filter(Boolean).join(' · ')

  return (
    <section className="stack-s" id="region">
      <p className="label">Group region</p>
      <div className="card">
        <p className="sub">Used for the holiday and school holiday countdowns on the feed.</p>
        {!isAdmin ? (
          <p className="name">{label || group.country || 'Not set yet. Ask an admin to set it.'}</p>
        ) : (
          <>
            <select id="region-country" className="input" value={country} onChange={(e) => { setCountry(e.target.value); setSub('') }}>
              <option value="">Choose a country…</option>
              {countries.map((c) => (
                <option key={c.isoCode} value={c.isoCode}>
                  {en(c.name)}
                </option>
              ))}
            </select>
            {subs.length > 0 && (
              <select id="region-sub" className="input" value={sub} onChange={(e) => setSub(e.target.value)}>
                <option value="">Whole country</option>
                {subs.map((s) => (
                  <option key={s.code} value={s.code}>
                    {en(s.name)}
                  </option>
                ))}
              </select>
            )}
            <div className="row">
              <button className="btn small grow" disabled={busy || !country} onClick={() => save(country, sub)}>
                Save region
              </button>
              <button className="btn ghost small" disabled={busy} onClick={detect}>
                📍 Detect
              </button>
            </div>
          </>
        )}
        {msg && <p className={msg.startsWith('Saved') ? 'info' : 'error'}>{msg}</p>}
      </div>
    </section>
  )
}
