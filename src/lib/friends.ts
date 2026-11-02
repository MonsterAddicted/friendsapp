import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

/** The small public card of a person (no bio, birthday or location). */
export interface Card {
  id: string
  username: string
  display_name: string
  emoji: string
  color: string
}
export interface FriendRow extends Card {
  state: 'friend' | 'incoming' | 'outgoing'
  since: string
}
export interface Suggestion extends Card {
  /** Name of a group you share, if any */
  via: string | null
  mutual: number
}
export interface NearbyPerson extends Card {
  meters: number
}
export interface GroupInvite {
  group_id: string
  group_name: string
  invited_by: Card
  members: number
  created_at: string
}

export interface FriendsState {
  /** null while loading */
  rows: FriendRow[] | null
  invites: GroupInvite[]
  /** Requests + group invites waiting for an answer */
  waiting: number
  reload: () => Promise<void>
  open: () => void
  /** Fake data for the dev preview */
  demo?: { suggestions: Suggestion[]; nearby: NearbyPerson[] }
}

/** Friends, requests and group invites, kept live. */
export function useFriends(meId: string, open: () => void): FriendsState {
  const [rows, setRows] = useState<FriendRow[] | null>(null)
  const [invites, setInvites] = useState<GroupInvite[]>([])

  const reload = useCallback(async () => {
    const [f, i] = await Promise.all([supabase.rpc('my_friends'), supabase.rpc('my_group_invites')])
    // Before the database update these fail: just show an empty list
    setRows(((f.data as FriendRow[] | null) ?? []).filter(Boolean))
    setInvites((i.data as GroupInvite[] | null) ?? [])
  }, [])

  useEffect(() => {
    reload()
    const ch = supabase
      .channel('friends-' + meId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `a=eq.${meId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `b=eq.${meId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_invites', filter: `user_id=eq.${meId}` }, reload)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [meId, reload])

  const waiting = (rows ?? []).filter((r) => r.state === 'incoming').length + invites.length
  return { rows, invites, waiting, reload, open }
}

/** Send a request (or accept theirs). Resolves to 'pending' or 'friends'. */
export async function addFriend(id: string) {
  const { data, error } = await supabase.rpc('add_friend', { other: id })
  return { state: data as 'pending' | 'friends' | null, error }
}

/** Decline, cancel or remove: all the same row. */
export async function endFriendship(meId: string, other: string) {
  const [a, b] = meId < other ? [meId, other] : [other, meId]
  return supabase.from('friendships').delete().eq('a', a).eq('b', b)
}

/** The personal "add me" link that goes in the QR code. */
export function addLink(meId: string) {
  return `${window.location.origin}/?add=${meId}`
}
