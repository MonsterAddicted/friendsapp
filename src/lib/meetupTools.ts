import { t } from './i18n'
import type { Meetup } from '../types'

/* ---------------- Weather (Open-Meteo: free, no key) ---------------- */

export interface Weather {
  emoji: string
  temp: number
  rain: number
  text: string
}

const cache = new Map<string, Promise<{ time: string[]; temp: number[]; rain: number[]; code: number[] } | null>>()

function codeInfo(code: number): [string, string] {
  if (code === 0) return ['☀️', 'Sunny']
  if (code <= 2) return ['🌤️', 'Partly cloudy']
  if (code === 3) return ['☁️', 'Cloudy']
  if (code <= 48) return ['🌫️', 'Foggy']
  if (code <= 57) return ['🌦️', 'Drizzle']
  if (code <= 67) return ['🌧️', 'Rain']
  if (code <= 77) return ['🌨️', 'Snow']
  if (code <= 82) return ['🌧️', 'Showers']
  if (code <= 86) return ['🌨️', 'Snow showers']
  return ['⛈️', 'Thunderstorm']
}

/** Forecast for one hour at a place, up to 16 days ahead. Null when too far away or offline. */
export async function weatherAt(lat: number, lng: number, iso: string): Promise<Weather | null> {
  const ms = Date.parse(iso)
  if (ms < Date.now() - 3600e3 || ms > Date.now() + 15 * 86400e3) return null
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&hourly=temperature_2m,precipitation_probability,weather_code&forecast_days=16&timezone=UTC`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j ? { time: j.hourly.time, temp: j.hourly.temperature_2m, rain: j.hourly.precipitation_probability, code: j.hourly.weather_code } : null))
        .catch(() => null),
    )
  }
  const d = await cache.get(key)!
  if (!d) return null
  const hour = new Date(ms).toISOString().slice(0, 13) + ':00'
  const i = d.time.indexOf(hour)
  if (i < 0) return null
  const [emoji, text] = codeInfo(d.code[i])
  return { emoji, temp: Math.round(d.temp[i]), rain: d.rain[i] ?? 0, text: t(text) }
}

/* ---------------- Calendar (.ics file) ---------------- */

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c)

/** Downloads a calendar file; phones open it straight in the calendar app. */
export function addToCalendar(m: Meetup) {
  if (!m.starts_at) return
  const start = new Date(m.starts_at)
  const end = new Date(start.getTime() + 2 * 3600e3)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//friendsapp//EN',
    'BEGIN:VEVENT',
    `UID:${m.id}@friendsapp`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(m.title)}`,
    m.place ? `LOCATION:${icsText(m.place)}` : '',
    m.lat != null && m.lng != null ? `GEO:${m.lat};${m.lng}` : '',
    m.details ? `DESCRIPTION:${icsText(m.details)}` : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(m.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = (m.title.replace(/[^\w\- ]+/g, '').trim() || 'meetup') + '.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/* ---------------- Directions ---------------- */

const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document

/** Link that opens the route in Apple Maps (iPhone) or Google Maps (everything else). */
export function directionsUrl(m: Pick<Meetup, 'lat' | 'lng' | 'place'>): string | null {
  const dest = m.lat != null && m.lng != null ? `${m.lat},${m.lng}` : m.place?.trim()
  if (!dest) return null
  return isApple() ? `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
}
