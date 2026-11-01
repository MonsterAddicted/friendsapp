import { getSettings } from './settings'
import { DE } from './de'

/** The app language: chosen in Settings, or the phone's language ("auto"). */
export type Lang = 'en' | 'de'

function pick(): Lang {
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (q === 'en' || q === 'de') return q
  }
  const s = getSettings().lang
  if (s === 'en' || s === 'de') return s
  const nav = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase()
  return nav.startsWith('de') ? 'de' : 'en'
}

export const LANG: Lang = pick()
/** Locale for dates and numbers. */
export const LOCALE = LANG === 'de' ? 'de-DE' : 'en-GB'

/**
 * Translate an English UI text. Placeholders like {name} are filled from `vars`.
 * English is the key, so a missing German text simply shows the English one.
 */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = LANG === 'de' ? (DE[en] ?? en) : en
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]))
  return s
}

/** Picks singular or plural: tn(1, '{n} friend', '{n} friends'). */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...vars })
}
