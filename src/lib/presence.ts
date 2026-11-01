import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

/** Who in the open group has the app open right now. */
export const OnlineContext = createContext<Set<string>>(new Set())
export const useOnlineIds = () => useContext(OnlineContext)

/**
 * Joins the group's presence channel. Everyone listens; you only show up as
 * "online" when `share` is on and the app is in the foreground.
 */
export function useOnline(groupId: string, meId: string, share: boolean): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const ch = supabase.channel('online-' + groupId, { config: { presence: { key: meId } } })
    const sync = () => setIds(new Set(Object.keys(ch.presenceState())))
    const update = () => {
      if (share && document.visibilityState === 'visible') ch.track({ at: Date.now() }).catch(() => {})
      else ch.untrack().catch(() => {})
    }
    ch.on('presence', { event: 'sync' }, sync)
    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED') update()
    })
    document.addEventListener('visibilitychange', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      supabase.removeChannel(ch)
      setIds(new Set())
    }
  }, [groupId, meId, share])

  return ids
}
