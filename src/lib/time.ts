import { LOCALE, t, tn } from './i18n'

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return t('just now')
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) })
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) })
  const d = Math.floor(s / 86400)
  return d === 1 ? t('yesterday') : t('{n} days ago', { n: d })
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** "18:00" in the app's language. */
export function clock(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

/** "Sat 2 Nov" */
export function day(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "Today 19:00", "Tomorrow 12:30", "Sat 2 Nov, 20:00" */
export function when(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const time = clock(d)
  if (sameDay(d, now)) return t('Today {time}', { time })
  if (sameDay(d, tomorrow)) return t('Tomorrow {time}', { time })
  return `${day(d)}, ${time}`
}

/** "until 18:00" or "until tomorrow 08:00" */
export function until(iso: string): string {
  const d = new Date(iso)
  return sameDay(d, new Date()) ? t('until {time}', { time: clock(d) }) : t('until {when}', { when: when(iso) })
}

/** "1 year ago", "3 years ago" */
export function yearsAgo(n: number): string {
  return tn(n, '{n} year ago', '{n} years ago')
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
