import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { KINDS } from './Meetups'
import type { MeetupKind } from '../types'

interface Past {
  id: string
  kind: MeetupKind
  place: string | null
  starts_at: string
}

/** Monday of the week, as YYYY-MM-DD (local time). */
function weekKey(d: Date): string {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`
}

interface Result {
  streak: number
  metThisWeek: boolean
  month: string
  hangouts: number
  top: { name: string; n: number } | null
  kind: MeetupKind | null
  spot: string | null
}

/**
 * A "hangout" = a past meetup where at least 2 people said "I'm in".
 * Streak = weeks in a row with at least one hangout (this week still counts as open).
 */
export function StatsCard() {
  const { group, members, me } = useApp()
  const [r, setR] = useState<Result | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: ms } = await supabase
        .from('meetups')
        .select('id, kind, place, starts_at')
        .eq('group_id', group.id)
        .eq('cancelled', false)
        .not('starts_at', 'is', null)
        .lt('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: false })
        .limit(300)
      const past = (ms as Past[]) ?? []
      const ins = past.length
        ? ((await supabase.from('meetup_responses').select('meetup_id, user_id').eq('answer', 'in').in('meetup_id', past.map((m) => m.id))).data ?? [])
        : []
      const goers = new Map<string, string[]>()
      for (const a of ins as { meetup_id: string; user_id: string }[]) goers.set(a.meetup_id, [...(goers.get(a.meetup_id) ?? []), a.user_id])
      const hangouts = past.filter((m) => (goers.get(m.id)?.length ?? 0) >= 2)

      // Streak
      const weeks = new Set(hangouts.map((m) => weekKey(new Date(m.starts_at))))
      const cur = new Date()
      const metThisWeek = weeks.has(weekKey(cur))
      if (!metThisWeek) cur.setDate(cur.getDate() - 7)
      let streak = 0
      while (weeks.has(weekKey(cur))) {
        streak++
        cur.setDate(cur.getDate() - 7)
      }

      // This month
      const now = new Date()
      const month = hangouts.filter((m) => {
        const d = new Date(m.starts_at)
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      })
      const count = <T,>(xs: T[]) => {
        const c = new Map<T, number>()
        for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1)
        return [...c.entries()].sort((a, b) => b[1] - a[1])[0]
      }
      const topUser = count(month.flatMap((m) => goers.get(m.id) ?? []))
      const topKind = count(month.map((m) => m.kind))
      const topSpot = count(month.map((m) => m.place?.trim()).filter((p): p is string => !!p))
      const nameOf = (id: string) => (id === me.id ? 'You' : members.find((x) => x.id === id)?.display_name ?? '?')

      if (alive)
        setR({
          streak,
          metThisWeek,
          month: now.toLocaleDateString([], { month: 'long' }),
          hangouts: month.length,
          top: topUser ? { name: nameOf(topUser[0]), n: topUser[1] } : null,
          kind: topKind?.[0] ?? null,
          spot: topSpot?.[0] ?? null,
        })
    })()
    return () => {
      alive = false
    }
  }, [group.id, members, me.id])

  if (!r) return null

  return (
    <section className="card stats">
      <div className="streak">
        <div className={'flame' + (r.streak ? '' : ' off')}>🔥</div>
        <div className="grow">
          <div className="streak-n">{r.streak ? `${r.streak}-week streak` : 'No streak yet'}</div>
          <div className="sub">
            {r.streak && !r.metThisWeek
              ? "You haven't met up this week yet. Do it to keep the streak!"
              : r.streak
                ? 'Met up this week ✓ Keep it going next week.'
                : 'Meet up once a week (2+ people "in") to start a streak.'}
          </div>
        </div>
      </div>
      <div>
        <p className="label">Group Wrapped · {r.month}</p>
        <div className="wrapped">
          <div className="tile">
            <b>{r.hangouts}</b>
            <span>hangouts</span>
          </div>
          <div className="tile">
            <b>{r.top ? r.top.name : '–'}</b>
            <span>{r.top ? `most active (${r.top.n})` : 'most active'}</span>
          </div>
          <div className="tile">
            <b>{r.kind ? `${KINDS[r.kind].emoji} ${KINDS[r.kind].label}` : '–'}</b>
            <span>favourite thing</span>
          </div>
          <div className="tile">
            <b>{r.spot ?? '–'}</b>
            <span>top spot</span>
          </div>
        </div>
      </div>
    </section>
  )
}
