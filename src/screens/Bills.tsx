import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { Avatar, Section, Sheet } from '../components/ui'
import { LOCALE, t } from '../lib/i18n'
import type { Expense, ExpenseShare, Member } from '../types'

const fmt = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' })
export const money = (cents: number) => fmt.format(cents / 100)

export interface Debt {
  from: string
  to: string
  cents: number
}

/** Loads all expenses of the open group and keeps them live. */
export function useExpenses() {
  const { group } = useApp()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [shares, setShares] = useState<ExpenseShare[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('expenses').select('*').eq('group_id', group.id).order('created_at', { ascending: false })
    const ex = (data as Expense[]) ?? []
    const sh = ex.length ? ((await supabase.from('expense_shares').select('*').in('expense_id', ex.map((e) => e.id))).data as ExpenseShare[]) : []
    setExpenses(ex)
    setShares(sh ?? [])
  }, [group.id])

  useEffect(() => {
    load()
    let timer: number | undefined
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, 300)
    }
    const ch = supabase
      .channel('expenses-' + group.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${group.id}` }, later)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_shares' }, later)
      .subscribe()
    return () => {
      window.clearTimeout(timer)
      supabase.removeChannel(ch)
    }
  }, [group.id, load])

  return { expenses, shares, reload: load }
}

/** Who owes who, with as few payments as possible. */
export function debts(expenses: Expense[], shares: ExpenseShare[]): Debt[] {
  const net = new Map<string, number>()
  const add = (id: string, c: number) => net.set(id, (net.get(id) ?? 0) + c)
  for (const e of expenses) add(e.paid_by, e.amount_cents)
  for (const s of shares) if (expenses.some((e) => e.id === s.expense_id)) add(s.user_id, -s.amount_cents)
  const owes = [...net].filter(([, c]) => c < 0).map(([id, c]) => ({ id, c: -c }))
  const gets = [...net].filter(([, c]) => c > 0).map(([id, c]) => ({ id, c }))
  owes.sort((a, b) => b.c - a.c)
  gets.sort((a, b) => b.c - a.c)
  const out: Debt[] = []
  let i = 0
  let j = 0
  while (i < owes.length && j < gets.length) {
    const c = Math.min(owes[i].c, gets[j].c)
    if (c > 0) out.push({ from: owes[i].id, to: gets[j].id, cents: c })
    owes[i].c -= c
    gets[j].c -= c
    if (owes[i].c === 0) i++
    if (gets[j].c === 0) j++
  }
  return out
}

/** Split `cents` evenly; leftover cents go to the first people. */
function splitEven(cents: number, ids: string[]) {
  const base = Math.floor(cents / ids.length)
  const rest = cents - base * ids.length
  return ids.map((id, i) => ({ user_id: id, amount_cents: base + (i < rest ? 1 : 0) }))
}

export function SplitBillSheet({
  meetupId,
  defaultPeople,
  onClose,
  onSaved,
}: {
  meetupId?: string | null
  defaultPeople?: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { group, me, members } = useApp()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [paidBy, setPaidBy] = useState(me.id)
  const [between, setBetween] = useState<string[]>(defaultPeople?.length ? defaultPeople : members.map((m) => m.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const cents = Math.round(parseFloat(amount.replace(',', '.')) * 100)
  const valid = Number.isFinite(cents) && cents > 0 && between.length > 0

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid) return setError(t('Enter an amount and pick at least one person.'))
    setBusy(true)
    setError('')
    const { data, error } = await supabase
      .from('expenses')
      .insert({ group_id: group.id, meetup_id: meetupId ?? null, created_by: me.id, paid_by: paidBy, amount_cents: cents, note: note.trim() || null })
      .select()
      .single()
    if (error) {
      setBusy(false)
      return setError(niceError(error))
    }
    const { error: e2 } = await supabase.from('expense_shares').insert(splitEven(cents, between).map((s) => ({ ...s, expense_id: (data as Expense).id })))
    setBusy(false)
    if (e2) return setError(niceError(e2))
    onSaved()
    onClose()
  }

  const toggle = (id: string) => setBetween((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]))
  const name = (m: Member) => (m.id === me.id ? t('You') : m.display_name)

  return (
    <Sheet title={t('Split a bill')} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          {t('How much? (€)')}
          <input id="bill-amount" className="input money-input" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} />
        </label>
        <label className="field">
          {t('For what?')}
          <input id="bill-note" className="input" maxLength={80} placeholder={t('e.g. Pizza, cinema tickets')} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="field">
          {t('Who paid?')}
          <div className="chips wrap">
            {members.map((m) => (
              <button type="button" key={m.id} className={'chip' + (paidBy === m.id ? ' on' : '')} onClick={() => setPaidBy(m.id)}>
                {m.emoji} {name(m)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          {t('Split between')} {valid && <span className="sub">· {t('{amount} each', { amount: money(Math.ceil(cents / between.length)) })}</span>}
          <div className="chips wrap">
            {members.map((m) => (
              <button type="button" key={m.id} className={'chip' + (between.includes(m.id) ? ' on' : '')} onClick={() => toggle(m.id)}>
                {m.emoji} {name(m)}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn block" disabled={busy || !valid}>
          {t('Save')} {valid ? money(cents) : ''}
        </button>
      </form>
    </Sheet>
  )
}

/** "Who owes who" card for the Group tab. */
export function BalancesCard() {
  const { group, me, members } = useApp()
  const { expenses, shares, reload } = useExpenses()
  const [adding, setAdding] = useState(false)
  const byId = new Map(members.map((m) => [m.id, m]))
  const list = debts(expenses, shares)
  const name = (id: string) => (id === me.id ? t('You') : byId.get(id)?.display_name ?? t('Someone'))
  const recent = expenses.filter((e) => !e.is_settlement).slice(0, 5)

  async function settle(d: Debt) {
    const { data, error } = await supabase
      .from('expenses')
      .insert({ group_id: group.id, created_by: me.id, paid_by: d.from, amount_cents: d.cents, note: t('Paid back'), is_settlement: true })
      .select()
      .single()
    if (!error) await supabase.from('expense_shares').insert({ expense_id: (data as Expense).id, user_id: d.to, amount_cents: d.cents })
    reload()
  }

  async function remove(id: string) {
    await supabase.from('expenses').delete().eq('id', id)
    reload()
  }

  return (
    <Section title={t('Who owes who')}>
      <div className="card">
        {list.length === 0 && <p className="sub">{t('All square. Nobody owes anything. 🎉')}</p>}
        {list.map((d) => (
          <div className="row" key={d.from + d.to}>
            <Avatar p={byId.get(d.from)} size={32} />
            <div className="grow">
              <div className="name small">
                {d.from === me.id ? t('You owe {name}', { name: name(d.to) }) : d.to === me.id ? t('{name} owes you', { name: name(d.from) }) : t('{a} owes {b}', { a: name(d.from), b: name(d.to) })}
              </div>
              <div className={'sub' + (d.to === me.id ? ' ok' : '')}>{money(d.cents)}</div>
            </div>
            {(d.from === me.id || d.to === me.id) && (
              <button className="btn ghost small" onClick={() => settle(d)}>
                {t('Mark paid')}
              </button>
            )}
          </div>
        ))}
        <button className="btn ghost small" onClick={() => setAdding(true)}>
          + {t('Add expense')}
        </button>
        {recent.length > 0 && (
          <div className="stack-s">
            <p className="label">{t('Recent')}</p>
            {recent.map((e) => (
              <div className="row" key={e.id}>
                <span className="grow sub">
                  {t('{name} paid {amount}', { name: name(e.paid_by), amount: money(e.amount_cents) })}
                  {e.note ? ` · ${e.note}` : ''}
                </span>
                {e.created_by === me.id && (
                  <button className="icon-btn faint" aria-label={t('Delete expense')} onClick={() => remove(e.id)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {adding && <SplitBillSheet onClose={() => setAdding(false)} onSaved={reload} />}
    </Section>
  )
}
