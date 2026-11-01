import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { yearsAgo } from '../lib/time'
import { Section } from '../components/ui'
import { KINDS } from './Meetups'
import type { MeetupKind } from '../types'

interface Memory {
  id: string
  title: string
  kind: MeetupKind
  years: number
  with: string[]
}

/** "On this day": meetups from the same date in earlier years. */
export function Memories() {
  const { group, members, me } = useApp()
  const [list, setList] = useState<Memory[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const now = new Date()
      const before = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 300).toISOString()
      const { data } = await supabase
        .from('meetups')
        .select('id, title, kind, starts_at')
        .eq('group_id', group.id)
        .eq('cancelled', false)
        .lt('starts_at', before)
        .order('starts_at', { ascending: false })
        .limit(1000)
      const same = ((data ?? []) as { id: string; title: string; kind: MeetupKind; starts_at: string }[]).filter((m) => {
        const d = new Date(m.starts_at)
        return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear()
      })
      if (!same.length) return alive && setList([])
      const { data: ins } = await supabase.from('meetup_responses').select('meetup_id, user_id').eq('answer', 'in').in('meetup_id', same.map((m) => m.id))
      const names = (id: string) => (id === me.id ? t('you') : members.find((x) => x.id === id)?.display_name)
      if (alive)
        setList(
          same.map((m) => ({
            id: m.id,
            title: m.title,
            kind: m.kind,
            years: now.getFullYear() - new Date(m.starts_at).getFullYear(),
            with: ((ins ?? []) as { meetup_id: string; user_id: string }[])
              .filter((a) => a.meetup_id === m.id)
              .map((a) => names(a.user_id))
              .filter((x): x is string => !!x),
          })),
        )
    })()
    return () => {
      alive = false
    }
  }, [group.id, members, me.id])

  if (!list.length) return null
  return (
    <Section title={'📅 ' + t('On this day')}>
      <div className="card memories">
        {list.map((m) => (
          <div className="row" key={m.id}>
            <div className="kind-badge small">{KINDS[m.kind].emoji}</div>
            <div className="grow">
              <div className="name">{m.title}</div>
              <div className="sub">
                {yearsAgo(m.years)}
                {m.with.length ? ' · ' + t('with {names}', { names: m.with.join(', ') }) : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
