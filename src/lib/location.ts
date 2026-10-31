import { useEffect } from 'react'
import { supabase } from './supabase'
import type { LocationMode } from '../types'

// All device location code lives here, so the Capacitor version only needs to swap this file.

export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device has no location support.'))
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    })
  })
}

export function locationErrorText(e: unknown): string {
  const code = (e as GeolocationPositionError | undefined)?.code
  if (code === 1) return 'Location is blocked. Allow it in your browser or phone settings.'
  if (code === 2) return 'Could not find your location. Try again outside or with Wi-Fi on.'
  if (code === 3) return 'Finding your location took too long. Try again.'
  return (e as Error)?.message || 'Could not get your location.'
}

export async function savePosition(userId: string, pos: GeolocationPosition) {
  const { error } = await supabase.from('locations').upsert({
    user_id: userId,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    updated_at: new Date().toISOString(),
  })
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
