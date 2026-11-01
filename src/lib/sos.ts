import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { getPosition } from './location'
import type { Sos } from '../types'

const MAX_AGE = 3 * 3600e3
const active = (s: Sos) => !s.resolved_at && Date.now() - Date.parse(s.updated_at) < MAX_AGE

/**
 * Active SOS alerts in the group. While your own alert is on, your position
 * is sent every ~15 s (even if location sharing is off) until you tap "I'm OK".
 */
export function useSos(groupId: string, meId: string) {
  const [alerts, setAlerts] = useState<Sos[]>([])

  useEffect(() => {
    let alive = true
    const since = new Date(Date.now() - MAX_AGE).toISOString()
    supabase
      .from('sos_alerts')
      .select('*')
      .eq('group_id', groupId)
      .is('resolved_at', null)
      .gte('updated_at', since)
      .then(({ data }) => alive && setAlerts(((data as Sos[]) ?? []).filter(active)))
    const ch = supabase
      .channel('sos-' + groupId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts', filter: `group_id=eq.${groupId}` }, (p) => {
        const row = p.new as Sos
        if (!row?.id) return
        setAlerts((prev) => [...prev.filter((a) => a.id !== row.id), row].filter(active))
      })
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [groupId])

  const mine = alerts.find((a) => a.user_id === meId)
  const mineId = mine?.id

  // Keep my position fresh while my alert is on
  useEffect(() => {
    if (!mineId || !navigator.geolocation) return
    let last = 0
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last < 15000) return
        last = Date.now()
        supabase
          .from('sos_alerts')
          .update({ lat: pos.coords.latitude, lng: pos.coords.longitude, updated_at: new Date().toISOString() })
          .eq('id', mineId)
          .then(() => {})
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [mineId])

  const send = useCallback(async () => {
    let lat: number | null = null
    let lng: number | null = null
    try {
      const pos = await getPosition()
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch {
      /* send it anyway, without a position */
    }
    const { data, error } = await supabase.from('sos_alerts').insert({ group_id: groupId, user_id: meId, lat, lng }).select().single()
    if (error) throw error
    setAlerts((prev) => [...prev, data as Sos])
  }, [groupId, meId])

  const end = useCallback(async () => {
    if (!mineId) return
    setAlerts((prev) => prev.filter((a) => a.id !== mineId))
    await supabase.from('sos_alerts').update({ resolved_at: new Date().toISOString() }).eq('id', mineId)
  }, [mineId])

  return { alerts, mine, send, end }
}

export type SosState = ReturnType<typeof useSos>
