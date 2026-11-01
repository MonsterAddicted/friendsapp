import { useEffect } from 'react'
import { supabase } from './supabase'
import { ARRIVED_KM, km } from './geo'

const MAX_AGE = 3 * 3600e3 // "On my way" stops by itself after 3 hours

interface Active {
  meetup_id: string
  goal: { lat: number; lng: number } | null
}

/**
 * While you're "on your way" to a meetup (and the app is open), keep sending your position.
 * Marks you as arrived when you're near the meetup pin, then stops.
 */
export function useOnTheWay(userId: string) {
  useEffect(() => {
    let alive = true
    let watch: number | null = null
    let active: Active[] = []
    let last = 0

    async function onPos(pos: GeolocationPosition) {
      if (Date.now() - last < 15000) return
      last = Date.now()
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      for (const a of active) {
        const arrived = !!a.goal && km(here, a.goal) < ARRIVED_KM
        await supabase
          .from('on_the_way')
          .update({ ...here, arrived, updated_at: new Date().toISOString() })
          .eq('meetup_id', a.meetup_id)
          .eq('user_id', userId)
      }
    }

    async function refresh() {
      const { data } = await supabase
        .from('on_the_way')
        .select('meetup_id, started_at, meetups(lat, lng, cancelled)')
        .eq('user_id', userId)
        .eq('arrived', false)
      if (!alive) return
      const rows = (data ?? []) as unknown as {
        meetup_id: string
        started_at: string
        meetups: { lat: number | null; lng: number | null; cancelled: boolean } | null
      }[]
      const expired = rows.filter((r) => Date.now() - Date.parse(r.started_at) > MAX_AGE || !r.meetups || r.meetups.cancelled)
      for (const r of expired) await supabase.from('on_the_way').delete().eq('meetup_id', r.meetup_id).eq('user_id', userId)
      active = rows
        .filter((r) => !expired.includes(r))
        .map((r) => ({
          meetup_id: r.meetup_id,
          goal: r.meetups?.lat != null && r.meetups?.lng != null ? { lat: r.meetups.lat, lng: r.meetups.lng } : null,
        }))
      if (active.length && watch === null && navigator.geolocation) {
        last = 0
        watch = navigator.geolocation.watchPosition(onPos, () => {}, { enableHighAccuracy: true, maximumAge: 10000 })
      } else if (!active.length && watch !== null) {
        navigator.geolocation.clearWatch(watch)
        watch = null
      }
    }

    refresh()
    const ch = supabase
      .channel('my-otw-' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'on_the_way', filter: `user_id=eq.${userId}` }, () => refresh())
      .subscribe()
    const timer = setInterval(refresh, 5 * 60e3)
    return () => {
      alive = false
      clearInterval(timer)
      if (watch !== null) navigator.geolocation.clearWatch(watch)
      supabase.removeChannel(ch)
    }
  }, [userId])
}
