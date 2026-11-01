import type { ReactNode } from 'react'
import type { Profile } from '../types'
import { useOnlineIds } from '../lib/presence'
import { t } from '../lib/i18n'

type AvatarPerson = Pick<Profile, 'emoji' | 'color'> & Partial<Pick<Profile, 'id' | 'birthday'>>

/** True when today is this birthday (YYYY-MM-DD, year ignored). */
export function isBirthday(day: string | null | undefined, now = new Date()): boolean {
  if (!day) return false
  const [, m, d] = day.split('-').map(Number)
  return now.getMonth() + 1 === m && now.getDate() === d
}

/** Round emoji avatar. `dot` shows a green dot while that friend has the app open. */
export function Avatar({ p, size = 44, dot = false }: { p: AvatarPerson | undefined; size?: number; dot?: boolean }) {
  const online = useOnlineIds()
  const on = dot && !!p?.id && online.has(p.id)
  const cake = size >= 28 && isBirthday(p?.birthday)
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: p?.color ?? 'var(--line)', fontSize: size * 0.52 }}
    >
      {p?.emoji ?? '🙂'}
      {on && <span className="online-dot" style={{ width: Math.max(10, size * 0.26), height: Math.max(10, size * 0.26) }} aria-label={t('online')} />}
      {cake && <span className="avatar-cake" style={{ fontSize: Math.max(12, size * 0.34) }} aria-label={t('birthday today')}>🎂</span>}
    </div>
  )
}

/** A labelled on/off switch row. */
export function Toggle({ id, label, help, checked, onChange, disabled }: { id: string; label: string; help?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle-row" htmlFor={id}>
      <span className="grow">
        <span className="toggle-label">{label}</span>
        {help && <span className="sub tiny block">{help}</span>}
      </span>
      <input id={id} type="checkbox" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** Section title + content box, the basic building block of every screen. */
export function Section({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={'section ' + className}>
      {(title || action) && (
        <div className="section-head">
          {title && <h2 className="label">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Splash() {
  return (
    <div className="center-screen">
      <div className="logo-mark">👋</div>
      <p className="muted">{t('Loading…')}</p>
    </div>
  )
}

export const EMOJIS = ['😀', '😎', '🤠', '🥳', '🤓', '😺', '🐶', '🦊', '🐼', '🐸', '🦄', '👽', '🤖', '👻', '🌞', '🔥']
export const COLORS = ['#ff7a1a', '#ff4d6d', '#c04cf2', '#5b6cff', '#1fa2ff', '#13c2a3', '#3ccf4e', '#f5b800']

export const Icons = {
  feed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.5-5.2A8.5 8.5 0 1 1 21 12z" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.6" />
    </svg>
  ),
  meetups: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9.5 15l2 2 3.5-3.5" />
    </svg>
  ),
  me: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
  group: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M17.5 14.6c2.3.3 3.7 2 4 4.4" />
    </svg>
  ),
}
