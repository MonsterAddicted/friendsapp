import { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { t } from './i18n'
import type { SosState } from './sos'
import type { Group, Member, MeetupKind, Profile } from '../types'

export type Tab = 'feed' | 'map' | 'meetups' | 'group' | 'me'
export interface MeetupDraft {
  kind?: MeetupKind
  title?: string
  place?: string
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
  /** Open the person sheet (profile, wave, mute) for a group member. */
  openPerson: (id: string) => void
  /** People whose posts you muted. */
  muted: Set<string>
  toggleMute: (id: string) => void
  isAdmin: boolean
  sos: SosState
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

export { store } from './store'

/** Turns Supabase/Postgres errors into short sentences people understand. */
export function niceError(e: { message?: string; code?: string } | null | undefined): string {
  if (!e) return t('Something went wrong. Try again.')
  if (e.code === '23505') return t('That username is already taken.')
  if (e.code === '23514') return t('Please check what you typed.')
  if (e.code === 'PGRST205' || e.code === 'PGRST204' || e.code === '42P01') return t('This needs the latest database update. Ask the app owner to run it.')
  if (e.message === 'No group with that code') return t('No group with that code')
  if (e.message === 'Only admins can do that') return t('Only admins can do that')
  return e.message || t('Something went wrong. Try again.')
}
