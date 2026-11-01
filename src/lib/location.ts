import { useEffect } from 'react'
import { supabase } from './supabase'
import type { LocationMode } from '../types'
import { t } from './i18n'

// All device location code lives here, so the Capacitor version only needs to swap this file.

export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t('This device has no location support.')))
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    })
  })
}

export function locationErrorText(e: unknown): string {
  const code = (e as GeolocationPositionError | undefined)?.code
  if (code === 1) return t('Location is blocked. Allow it in your browser or phone settings.')
  if (code === 2) return t('Could not find your location. Try again outside or with Wi-Fi on.')
  if (code === 3) return t('Finding your location took too long. Try again.')
  return (e as Error)?.message || t('Could not get your location.')
}

let shareBattery = true
/** Turned off in Settings → Privacy. */
export function setBatterySharing(on: boolean) {
  shareBattery = on
}

interface BatteryManager {
  level: number
  charging: boolean
}

/** Battery level 0–100, or null where the browser doesn't tell (e.g. iPhone Safari). */
export async function readBattery(): Promise<{ battery: number; charging: boolean } | null> {
  try {
    const get = (navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }).getBattery
    if (!get) return null
    const b = await get.call(navigator)
    return { battery: Math.round(b.level * 100), charging: b.charging }
  } catch {
    return null
  }
}

export async function savePosition(userId: string, pos: GeolocationPosition) {
  const row = {
    user_id: userId,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    updated_at: new Date().toISOString(),
  }
  const bat = shareBattery ? await readBattery() : null
  let { error } = await supabase.from('locations').upsert({ ...row, battery: bat?.battery ?? null, charging: bat?.charging ?? null })
  // Database not updated yet (no battery column): save without it.
  if (error?.code === 'PGRST204') ({ error } = await supabase.from('locations').upsert(row))
  if (error) throw error
}

export async function shareOnce(userId: string) {
  const pos = await getPosition()
  await savePosition(userId, pos)
}

export async function clearPosition(userId: string) {
  await supabase.from('locations').delete().eq('user_id', userId)
}

/** While mode is "live" and the app is open, keep sending the position (at most every 20 s). */
export function useLiveLocation(userId: string, mode: LocationMode) {
  useEffect(() => {
    if (mode !== 'live' || !navigator.geolocation) return
    let last = 0
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last < 20000) return
        last = Date.now()
        savePosition(userId, pos).catch(() => {})
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [userId, mode])
}
