import type { ReactNode } from 'react'
import type { Profile } from '../types'

export function Avatar({ p, size = 44 }: { p: Pick<Profile, 'emoji' | 'color'> | undefined; size?: number }) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: p?.color ?? 'var(--line)', fontSize: size * 0.52 }}
    >
      {p?.emoji ?? '🙂'}
    </div>
  )
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
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
      <p className="muted">Loading…</p>
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
  group: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M17.5 14.6c2.3.3 3.7 2 4 4.4" />
    </svg>
  ),
}
