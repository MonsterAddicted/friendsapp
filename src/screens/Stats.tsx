import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { KINDS } from './Meetups'
import type { MeetupKind } from '../types'
import { punctuality, type Checkin } from './MeetupExtras'
import { LOCALE, t, tn } from '../lib/i18n'
import type { Rating } from '../types'

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
  punctual: { name: string; pct: number } | null
  late: { name: string; pct: number } | null
  best: { title: string; stars: number } | null
  snacks: { name: string; n: number } | null
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
        .select('id, kind, place, starts_at, title')
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
      const checkins = past.length
        ? (((await supabase.from('meetup_checkins').select('*').in('meetup_id', past.map((m) => m.id))).data as Checkin[]) ?? [])
        : []
      const punct = punctuality(new Map(past.map((m) => [m.id, m.starts_at])), checkins)
      const snackKing = [...punct].filter(([, v]) => v.snacks > 0).sort((a, b) => b[1].snacks - a[1].snacks)[0]
      const scores = [...punct]
        .filter(([, v]) => v.total >= 2)
        .map(([id, v]) => ({ id, pct: Math.round((v.onTime / v.total) * 100) }))
        .sort((a, b) => b.pct - a.pct)

      // Best-rated hangout this month (needs 2+ ratings)
      const monthIds = past
        .filter((m) => {
          const d = new Date(m.starts_at)
          return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear()
        })
        .map((m) => m.id)
      const ratings = monthIds.length ? (((await supabase.from('meetup_ratings').select('*').in('meetup_id', monthIds)).data as Rating[]) ?? []) : []
      const avg = new Map<string, { sum: number; n: number }>()
      for (const x of ratings) {
        const v = avg.get(x.meetup_id) ?? { sum: 0, n: 0 }
        v.sum += x.stars
        v.n++
        avg.set(x.meetup_id, v)
      }
      const top = [...avg].filter(([, v]) => v.n >= 2).sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)[0]
      const topMeetup = top ? (ms as (Past & { title?: string })[] | null)?.find((m) => m.id === top[0]) : undefined

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
      const nameOf = (id: string) => (id === me.id ? t('You') : members.find((x) => x.id === id)?.display_name ?? '?')

      if (alive)
        setR({
          streak,
          metThisWeek,
          month: now.toLocaleDateString(LOCALE, { month: 'long' }),
          hangouts: month.length,
          top: topUser ? { name: nameOf(topUser[0]), n: topUser[1] } : null,
          kind: topKind?.[0] ?? null,
          spot: topSpot?.[0] ?? null,
          punctual: scores.length ? { name: nameOf(scores[0].id), pct: scores[0].pct } : null,
          late: scores.length > 1 && scores[scores.length - 1].pct < 100 ? { name: nameOf(scores[scores.length - 1].id), pct: scores[scores.length - 1].pct } : null,
          best: top && topMeetup?.title ? { title: topMeetup.title, stars: top[1].sum / top[1].n } : null,
          snacks: snackKing ? { name: nameOf(snackKing[0]), n: snackKing[1].snacks } : null,
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
          <div className="streak-n">{r.streak ? tn(r.streak, '{n}-week streak', '{n}-week streak') : t('No streak yet')}</div>
          <div className="sub">
            {r.streak && !r.metThisWeek
              ? t("You haven't met up this week yet. Do it to keep the streak!")
              : r.streak
                ? t('Met up this week ✓ Keep it going next week.')
                : t('Meet up once a week (2+ people "in") to start a streak.')}
          </div>
        </div>
      </div>
      <div>
        <p className="label">{t('Group Wrapped')} · {r.month}</p>
        <div className="wrapped">
          <div className="tile">
            <b>{r.hangouts}</b>
            <span>{t('hangouts')}</span>
          </div>
          <div className="tile">
            <b>{r.top ? r.top.name : '–'}</b>
            <span>{r.top ? t('most active ({n})', { n: r.top.n }) : t('most active')}</span>
          </div>
          <div className="tile">
            <b>{r.kind ? `${KINDS[r.kind].emoji} ${t(KINDS[r.kind].label)}` : '–'}</b>
            <span>{t('favourite thing')}</span>
          </div>
          <div className="tile">
            <b>{r.spot ?? '–'}</b>
            <span>{t('top spot')}</span>
          </div>
          <div className="tile">
            <b>{r.punctual ? `⏱️ ${r.punctual.name}` : '–'}</b>
            <span>{r.punctual ? t('most punctual ({n}% on time)', { n: r.punctual.pct }) : t('most punctual')}</span>
          </div>
          <div className="tile">
            <b>{r.late ? `🐢 ${r.late.name}` : '–'}</b>
            <span>{r.late ? t('usually late ({n}% on time)', { n: r.late.pct }) : t('usually late')}</span>
          </div>
          <div className="tile">
            <b>{r.best ? `⭐ ${r.best.title}` : '–'}</b>
            <span>{r.best ? t('best hangout ({n} ★)', { n: r.best.stars.toFixed(1) }) : t('best hangout')}</span>
          </div>
          <div className="tile">
            <b>{r.snacks ? `🍫 ${r.snacks.name}` : '–'}</b>
            <span>{r.snacks ? tn(r.snacks.n, 'owes {n} snack', 'owes {n} snacks') : t('snacks owed')}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
