import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { toLocalInput } from '../lib/time'
import { Avatar } from '../components/ui'

interface FreeDay {
  user_id: string
  day: string
}

/** Everyone taps the evenings they're free this week; the day most people can make lights up. */
export function BestDay() {
  const { group, me, members, openNewMeetup } = useApp()
  const [rows, setRows] = useState<FreeDay[]>([])

  const days = useMemo(() => {
    const out: { key: string; date: Date }[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setHours(12, 0, 0, 0)
      d.setDate(d.getDate() + i)
      out.push({ key: toLocalInput(d).slice(0, 10), date: d })
    }
    return out
  }, [])

  const load = useCallback(async () => {
    const { data } = await supabase.from('free_days').select('user_id, day').eq('group_id', group.id).gte('day', days[0].key).lte('day', days[6].key)
    setRows((data as FreeDay[]) ?? [])
  }, [group.id, days])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('free-days-' + group.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'free_days', filter: `group_id=eq.${group.id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [group.id, load])

  async function toggle(day: string) {
    const has = rows.some((r) => r.day === day && r.user_id === me.id)
    setRows((prev) => (has ? prev.filter((r) => !(r.day === day && r.user_id === me.id)) : [...prev, { day, user_id: me.id }]))
    if (has) await supabase.from('free_days').delete().eq('group_id', group.id).eq('user_id', me.id).eq('day', day)
    else await supabase.from('free_days').insert({ group_id: group.id, user_id: me.id, day })
  }

  const byId = new Map(members.map((m) => [m.id, m]))
  const people = (day: string) => rows.filter((r) => r.day === day && byId.has(r.user_id)).map((r) => byId.get(r.user_id)!)
  let best: string | null = null
  let bestN = 1
  for (const d of days) {
    const n = people(d.key).length
    if (n > bestN) {
      best = d.key
      bestN = n
    }
  }

  return (
    <section className="card">
      <div className="row">
        <div className="grow">
          <p className="label">Best day this week</p>
          <p className="sub">Tap the evenings you're free.</p>
        </div>
      </div>
      <div className="week">
        {days.map((d, i) => {
          const ps = people(d.key)
          const mine = ps.some((p) => p.id === me.id)
          return (
            <button key={d.key} className={'day' + (mine ? ' on' : '') + (d.key === best ? ' best' : '')} onClick={() => toggle(d.key)} aria-pressed={mine}>
              <span className="day-name">{i === 0 ? 'Today' : d.date.toLocaleDateString([], { weekday: 'short' })}</span>
              <span className="day-num">{d.date.getDate()}</span>
              <span className="day-count">{ps.length || ''}</span>
              {d.key === best && <span className="day-flame">🔥</span>}
            </button>
          )
        })}
      </div>
      {best && (
        <div className="match">
          <div className="grow">
            <div className="name">
              {days.find((d) => d.key === best)!.date.toLocaleDateString([], { weekday: 'long' })} works for {bestN} people
            </div>
            <div className="faces">
              {people(best).map((p) => (
                <Avatar key={p.id} p={p} size={26} />
              ))}
            </div>
          </div>
          <button className="btn small" onClick={() => openNewMeetup({ startsAt: `${best}T19:00` })}>
            Plan it
          </button>
        </div>
      )}
    </section>
  )
}
