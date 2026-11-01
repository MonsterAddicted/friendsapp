import { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Group, Member, MeetupKind, Profile } from '../types'

export type Tab = 'feed' | 'map' | 'meetups' | 'group'
export interface MeetupDraft {
  kind?: MeetupKind
  title?: string
  /** datetime-local value, e.g. 2026-11-05T19:00 */
  startsAt?: string
}

export interface AppState {
  session: Session
  me: Profile
  setMe: (p: Profile) => void
  groups: Group[]
  group: Group
  selectGroup: (id: string) => void
  reloadGroups: () => Promise<Group[]>
  members: Member[]
  goTab: (t: Tab) => void
  openNewMeetup: (draft?: MeetupDraft) => void
}

export const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppContext')
  return ctx
}

/** Re-renders every `ms` so "5 min ago" labels stay fresh. */
export function useTick(ms = 30000) {
  const [, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage blocked: ignore */
    }
  },
}

/** Turns Supabase/Postgres errors into short sentences people understand. */
export function niceError(e: { message?: string; code?: string } | null | undefined): string {
  if (!e) return 'Something went wrong. Try again.'
  if (e.code === '23505') return 'That username is already taken.'
  if (e.code === '23514') return 'Please check what you typed.'
  return e.message || 'Something went wrong. Try again.'
}
