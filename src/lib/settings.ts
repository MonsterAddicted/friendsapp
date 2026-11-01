import { useSyncExternalStore } from 'react'
import { store } from './store'

/** Settings that only live on this device (look and feel). Privacy settings live in the profile. */
export interface DeviceSettings {
  theme: 'system' | 'light' | 'dark'
  lang: 'auto' | 'en' | 'de'
  showFree: boolean
  showCountdowns: boolean
  showMemories: boolean
  showBestDay: boolean
  showWeather: boolean
  showStats: boolean
  vibrate: boolean
  motion: boolean
}

const DEFAULTS: DeviceSettings = {
  theme: 'system',
  lang: 'auto',
  showFree: true,
  showCountdowns: true,
  showMemories: true,
  showBestDay: true,
  showWeather: true,
  showStats: true,
  vibrate: true,
  motion: true,
}

function read(): DeviceSettings {
  try {
    const theme = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('theme') : null
    return { ...DEFAULTS, ...JSON.parse(store.get('settings') ?? '{}'), ...(theme === 'dark' || theme === 'light' ? { theme } : {}) }
  } catch {
    return DEFAULTS
  }
}

let current = read()
const listeners = new Set<() => void>()

export function getSettings(): DeviceSettings {
  return current
}

export function setSetting<K extends keyof DeviceSettings>(key: K, value: DeviceSettings[K]) {
  current = { ...current, [key]: value }
  store.set('settings', JSON.stringify(current))
  applyLook()
  listeners.forEach((l) => l())
}

export function useSettings(): DeviceSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

/** Puts theme + motion on <html> so the CSS can follow them. */
export function applyLook() {
  const html = document.documentElement
  if (current.theme === 'system') html.removeAttribute('data-theme')
  else html.setAttribute('data-theme', current.theme)
  html.toggleAttribute('data-calm', !current.motion)
  const dark = current.theme === 'dark' || (current.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1117' : '#f6f6f9')
}

/** Privacy switches saved in the profile (so they work on every device). All on by default. */
export type PrivacyKey = 'online' | 'battery' | 'seen'
export const privacyOn = (privacy: Record<string, boolean> | undefined | null, key: PrivacyKey) => privacy?.[key] !== false
