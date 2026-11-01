import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { niceError, useApp } from '../lib/app'
import { ago } from '../lib/time'
import { Avatar, Sheet } from '../components/ui'
import type { Profile, Wave } from '../types'

const PRESETS = ['👋 Hi!', '📍 Where you at?', '🍕 Hungry?', '🎮 Gaming?', '🙋 Free later?', '⚽ Football?', '😴 Wake up!', '❤️ Miss you guys']

const lastSent = new Map<string, number>()
const COOLDOWN = 20000

export function WaveSheet({ to, groupId, onClose }: { to: Pick<Profile, 'id' | 'display_name' | 'emoji' | 'color'>; groupId?: string; onClose: () => void }) {
  const { group, me } = useApp()
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [custom, setCustom] = useState('')

  async function send(message: string) {
    if (Date.now() - (lastSent.get(to.id) ?? 0) < COOLDOWN) return setError('Give them a second to answer 🙂')
    setError('')
    const { error } = await supabase.from('waves').insert({ group_id: groupId ?? group.id, from_user: me.id, to_user: to.id, message })
    if (error) return setError(niceError(error))
    lastSent.set(to.id, Date.now())
    setSent(message)
    setTimeout(onClose, 900)
  }

  return (
    <Sheet title={`Wave at ${to.display_name}`} onClose={onClose}>
      <div className="stack">
        <div className="preview">
          <Avatar p={to} size={56} />
          <p className="sub">They'll see it pop up right away.</p>
        </div>
        {sent ? (
          <p className="info">Sent: {sent}</p>
        ) : (
          <>
            <div className="wave-grid">
              {PRESETS.map((p) => (
                <button key={p} className="wave-pick" onClick={() => send(p)}>
                  {p}
                </button>
              ))}
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                if (custom.trim()) send(custom.trim())
              }}
            >
              <input id="wave-custom" className="input grow" maxLength={60} placeholder="Or write your own…" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <button className="btn small" disabled={!custom.trim()}>
                Send
              </button>
            </form>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </Sheet>
  )
}

type Incoming = Wave & { sender: Profile | null }

/** Pops up waves sent to you, on top of every screen. */
export function WaveInbox() {
  const { me } = useApp()
  const [waves, setWaves] = useState<Incoming[]>([])
  const [replyTo, setReplyTo] = useState<{ p: Profile; groupId: string } | null>(null)

  useEffect(() => {
    let alive = true
    const since = new Date(Date.now() - 12 * 3600e3).toISOString()
    const withSender = async (w: Wave): Promise<Incoming> => {
      const { data } = await supabase.from('profiles').select('*').eq('id', w.from_user).maybeSingle()
      return { ...w, sender: (data as Profile) ?? null }
    }
    supabase
      .from('waves')
      .select('*')
      .eq('to_user', me.id)
      .eq('seen', false)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(async ({ data }) => {
        const list = await Promise.all(((data as Wave[]) ?? []).map(withSender))
        if (alive) setWaves(list)
      })
    const ch = supabase
      .channel('waves-' + me.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'waves', filter: `to_user=eq.${me.id}` }, async (p) => {
        const w = await withSender(p.new as Wave)
        if (!alive) return
        navigator.vibrate?.(80)
        setWaves((prev) => [w, ...prev.filter((x) => x.id !== w.id)].slice(0, 3))
      })
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [me.id])

  async function dismiss(id: string) {
    setWaves((prev) => prev.filter((w) => w.id !== id))
    await supabase.from('waves').update({ seen: true }).eq('id', id)
  }

  return (
    <>
      {waves.length > 0 && (
        <div className="toasts">
          {waves.map((w) => (
            <div className="toast" key={w.id} role="status">
              <Avatar p={w.sender ?? undefined} size={38} />
              <div className="grow">
                <div className="name small">
                  {w.sender?.display_name ?? 'A friend'} <span className="sub tiny">· {ago(w.created_at)}</span>
                </div>
                <div className="toast-msg">{w.message}</div>
              </div>
              {w.sender && (
                <button
                  className="btn small"
                  onClick={() => {
                    setReplyTo({ p: w.sender!, groupId: w.group_id })
                    dismiss(w.id)
                  }}
                >
                  Wave back
                </button>
              )}
              <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(w.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {replyTo && <WaveSheet to={replyTo.p} groupId={replyTo.groupId} onClose={() => setReplyTo(null)} />}
    </>
  )
}
