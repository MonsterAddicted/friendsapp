import { t } from './i18n'

/** Distance in km between two points. */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** "1.4 km away · ~17 min walk" style text. Rough guess: walking under 2.5 km, otherwise by car in town. */
export function distanceText(d: number): string {
  const dist = d < 1 ? `${Math.round(d * 1000 / 10) * 10} m` : `${d.toFixed(1)} km`
  const walk = d < 2.5
  const mins = Math.max(1, Math.round((d / (walk ? 5 : 30)) * 60))
  return t(walk ? '{dist} away · ~{n} min walk' : '{dist} away · ~{n} min drive', { dist, n: mins })
}

/** Counts as "arrived" within 120 m. */
export const ARRIVED_KM = 0.12
