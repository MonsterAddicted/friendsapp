import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { t } from '../lib/i18n'
import { ago } from '../lib/time'
import { getSettings } from '../lib/settings'
import { Sheet } from '../components/ui'
import type { Spin } from '../types'

const COLORS = ['#ff7a1a', '#5b6cff', '#13c2a3', '#ff4d6d', '#f5b800', '#c04cf2', '#1fa2ff', '#3ccf4e']

const PRESETS: { title: string; options: string[] }[] = [
  { title: '🍽️ What do we eat?', options: ['🍕 Pizza', '🍔 Burger', '🥙 Döner', '🍣 Sushi', '🍜 Asian', '🌮 Mexican'] },
  { title: '🎯 What do we do?', options: ['🎬 Movie', '🎮 Gaming', '🎳 Bowling', '⚽ Football', '🛋️ Chill', '🚶 Walk'] },
]

/** The newest spin in the group (last 3 hours), shown on the Meetups tab. */
export function LatestSpin() {
  const { group, members, me } = useApp()
  const [spin, setSpin] = useState<Spin | null>(null)

  useEffect(() => {
    const since = new Date(Date.now() - 3 * 3600e3).toISOString()
    supabase
      .from('wheel_spins')
      .select('*')
      .eq('group_id', group.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => setSpin(((data as Spin[]) ?? [])[0] ?? null))
    const ch = supabase
      .channel('spins-' + group.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wheel_spins', filter: `group_id=eq.${group.id}` }, (p) => setSpin(p.new as Spin))
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [group.id])

  if (!spin) return null
  const who = spin.user_id === me.id ? t('You') : members.find((m) => m.id === spin.user_id)?.display_name ?? t('Someone')
  return (
    <div className="banner spin-result">
      <span className="banner-icon">🎡</span>
      <span className="grow">
        <span className="sub tiny block">
          {who} · {spin.title} · {ago(spin.created_at)}
        </span>
        <b className="spin-winner">{spin.options[spin.result]}</b>
      </span>
    </div>
  )
}

/** Spin a wheel; the result is saved, so everyone in the group sees the same answer. */
export function WheelSheet({ onClose }: { onClose: () => void }) {
  const { group, me, members } = useApp()
  const presets = [...PRESETS.map((p) => ({ title: t(p.title), options: p.options.map((o) => t(o)) })), { title: '💸 ' + t('Who pays?'), options: members.map((m) => m.display_name) }]
  const [title, setTitle] = useState(presets[0].title)
  const [options, setOptions] = useState<string[]>(presets[0].options)
  const [draft, setDraft] = useState('')
  const [angle, setAngle] = useState(0)
  const [result, setResult] = useState<number | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [error, setError] = useState('')

  function usePreset(i: number) {
    setTitle(presets[i].title)
    setOptions(presets[i].options.slice(0, 12))
    setResult(null)
  }

  async function spin() {
    if (options.length < 2 || spinning) return
    setError('')
    const pick = Math.floor(Math.random() * options.length)
    const { error } = await supabase.from('wheel_spins').insert({ group_id: group.id, user_id: me.id, title: title.slice(0, 60), options, result: pick })
    if (error) return setError(niceError(error))
    // Land the middle of slice `pick` under the pointer at the top
    const slice = 360 / options.length
    const target = 360 - (pick * slice + slice / 2)
    const turns = getSettings().motion ? 5 : 0
    setSpinning(true)
    setResult(null)
    setAngle((a) => a - (a % 360) + turns * 360 + target)
    setTimeout(
      () => {
        setSpinning(false)
        setResult(pick)
        if (getSettings().vibrate) navigator.vibrate?.(60)
      },
      turns ? 3200 : 50,
    )
  }

  const slice = 360 / Math.max(options.length, 1)
  const gradient = options.map((_, i) => `${COLORS[i % COLORS.length]} ${i * slice}deg ${(i + 1) * slice}deg`).join(', ')

  return (
    <Sheet title={'🎡 ' + t('Decision wheel')} onClose={onClose}>
      <div className="stack">
        <div className="chips">
          {presets.map((p, i) => (
            <button key={i} className={'chip' + (p.title === title ? ' on' : '')} onClick={() => usePreset(i)} disabled={spinning}>
              {p.title}
            </button>
          ))}
        </div>

        <div className="wheel-box">
          <div className="wheel-pointer" aria-hidden>
            ▼
          </div>
          <div className="wheel" style={{ background: `conic-gradient(${gradient})`, transform: `rotate(${angle}deg)` }}>
            {options.map((o, i) => (
              <span key={i} className="wheel-label" style={{ transform: `rotate(${i * slice + slice / 2}deg)` }}>
                <span>{o.length > 14 ? o.slice(0, 13) + '…' : o}</span>
              </span>
            ))}
          </div>
        </div>
        <p className="spin-winner center" aria-live="polite">
          {result !== null ? '🎉 ' + options[result] : ' '}
        </p>

        <button className="btn block big-btn" disabled={spinning || options.length < 2} onClick={spin}>
          {spinning ? t('Spinning…') : t('Spin!')}
        </button>

        <details className="wheel-edit">
          <summary>{t('Change the options ({n})', { n: options.length })}</summary>
          <div className="stack-s">
            <input id="wheel-title" className="input small-input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('Question')} />
            <div className="chips wrap">
              {options.map((o, i) => (
                <span className="chip spot-chip" key={i}>
                  {o}
                  <button className="chip-x" aria-label={t('Remove {name}', { name: o })} onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <form
              className="composer-row"
              onSubmit={(e) => {
                e.preventDefault()
                if (draft.trim() && options.length < 12) {
                  setOptions([...options, draft.trim().slice(0, 30)])
                  setDraft('')
                }
              }}
            >
              <input id="wheel-add" className="input grow small-input" maxLength={30} placeholder={t('Add an option')} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button className="btn small" disabled={!draft.trim() || options.length >= 12}>
                {t('Add')}
              </button>
            </form>
          </div>
        </details>
        {error && <p className="error">{error}</p>}
      </div>
    </Sheet>
  )
}
