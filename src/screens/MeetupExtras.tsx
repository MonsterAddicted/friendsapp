import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { Avatar } from '../components/ui'
import type { Meetup, MeetupResponse, Member } from '../types'

export interface Item {
  id: string
  meetup_id: string
  label: string
  created_by: string
  claimed_by: string | null
}

export interface Checkin {
  meetup_id: string
  user_id: string
  arrived_at: string
}

/** Late = more than 5 minutes after the start time. */
export const LATE_GRACE_MIN = 5

const minutesLate = (start: string, at: number) => Math.round((at - Date.parse(start)) / 60000)

/* ---------------- Who brings what ---------------- */

export function BringList({ m, items, byId, reload }: { m: Meetup; items: Item[]; byId: Map<string, Member>; reload: () => void }) {
  const { me } = useApp()
  const [label, setLabel] = useState('')
  const [open, setOpen] = useState(items.length > 0)
  const [error, setError] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    const { error } = await supabase.from('meetup_items').insert({ meetup_id: m.id, label: label.trim(), created_by: me.id })
    if (error) return setError(niceError(error))
    setLabel('')
    reload()
  }

  async function claim(i: Item) {
    if (i.claimed_by && i.claimed_by !== me.id) return
    await supabase.from('meetup_items').update({ claimed_by: i.claimed_by ? null : me.id }).eq('id', i.id)
    reload()
  }

  async function remove(i: Item) {
    await supabase.from('meetup_items').delete().eq('id', i.id)
    reload()
  }

  if (!open)
    return (
      <button className="link inline" onClick={() => setOpen(true)}>
        🧺 Who brings what?
      </button>
    )

  const missing = items.filter((i) => !i.claimed_by).length
  return (
    <div className="bring">
      <p className="label">Who brings what {items.length > 0 && <span className="sub tiny">· {missing ? `${missing} still needed` : 'all covered ✓'}</span>}</p>
      {items.map((i) => {
        const who = i.claimed_by ? byId.get(i.claimed_by) : undefined
        const mine = i.claimed_by === me.id
        return (
          <div className="bring-item" key={i.id}>
            <button className={'bring-claim' + (i.claimed_by ? ' taken' : '') + (mine ? ' mine' : '')} onClick={() => claim(i)} disabled={!!i.claimed_by && !mine}>
              {who ? <Avatar p={who} size={24} /> : <span className="bring-empty">+</span>}
            </button>
            <span className="grow">
              <span className="name small">{i.label}</span>
              <span className="sub tiny block">{who ? (mine ? 'You bring this (tap to undo)' : `${who.display_name} brings it`) : 'Tap + to bring it'}</span>
            </span>
            {(i.created_by === me.id || m.created_by === me.id) && (
              <button className="icon-btn faint" aria-label="Remove item" onClick={() => remove(i)}>
                ✕
              </button>
            )}
          </div>
        )
      })}
      <form className="row" onSubmit={add}>
        <input id={'item-' + m.id} className="input grow small-input" maxLength={40} placeholder="Add: drinks, chips, controller…" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn small" disabled={!label.trim()}>
          Add
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

/* ---------------- Late tracker ---------------- */

/** From 30 min before until 3 h after the start: who's here, who's late. */
export function LateTracker({ m, answers, checkins, byId, reload }: { m: Meetup; answers: MeetupResponse[]; checkins: Checkin[]; byId: Map<string, Member>; reload: () => void }) {
  const { me } = useApp()
  if (!m.starts_at) return null
  const start = Date.parse(m.starts_at)
  const now = Date.now()
  if (now < start - 30 * 60000 || now > start + 3 * 3600e3) return null

  const coming = answers.filter((a) => a.answer === 'in').map((a) => a.user_id)
  const here = new Map(checkins.map((c) => [c.user_id, c]))
  const iAmIn = coming.includes(me.id)

  async function checkIn() {
    await supabase.from('meetup_checkins').insert({ meetup_id: m.id, user_id: me.id })
    reload()
  }

  return (
    <div className="late">
      <p className="label">{now < start ? 'Starting soon' : "Who's here"}</p>
      {coming.map((id) => {
        const p = byId.get(id)
        const c = here.get(id)
        let status: string
        let cls = ''
        if (c) {
          const late = minutesLate(m.starts_at!, Date.parse(c.arrived_at))
          status = late > LATE_GRACE_MIN ? `Arrived ${late} min late` : 'On time ✓'
          cls = late > LATE_GRACE_MIN ? 'warn' : 'ok'
        } else if (now > start + LATE_GRACE_MIN * 60000) {
          status = `Late · ${minutesLate(m.starts_at!, now)} min`
          cls = 'bad'
        } else {
          status = 'Not here yet'
        }
        return (
          <div className="row" key={id}>
            <Avatar p={p} size={28} />
            <span className="grow name small">{id === me.id ? 'You' : p?.display_name ?? '?'}</span>
            <span className={'late-status ' + cls}>{status}</span>
          </div>
        )
      })}
      {iAmIn && !here.has(me.id) && (
        <button className="btn small" onClick={checkIn}>
          📍 I'm here
        </button>
      )}
    </div>
  )
}

/** On-time share per person, from all check-ins of the group's meetups. */
export function punctuality(starts: Map<string, string>, checkins: Checkin[]) {
  const score = new Map<string, { onTime: number; total: number }>()
  for (const c of checkins) {
    const s = starts.get(c.meetup_id)
    if (!s) continue
    const v = score.get(c.user_id) ?? { onTime: 0, total: 0 }
    v.total++
    if (minutesLate(s, Date.parse(c.arrived_at)) <= LATE_GRACE_MIN) v.onTime++
    score.set(c.user_id, v)
  }
  return score
}
