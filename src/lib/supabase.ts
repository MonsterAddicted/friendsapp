import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** False until the Supabase keys are filled in (.env.local or Cloudflare settings). */
export const configured = Boolean(url && key)

/** Which sign-in buttons to show: whatever is switched on in Supabase (Authentication → Providers). */
export async function loginProviders(): Promise<{ google: boolean; apple: boolean }> {
  // Dev only: ?providers shows both buttons for checking the look
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('providers')) return { google: true, apple: true }
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key ?? '' } })
    const s = (await r.json()) as { external?: Record<string, boolean> }
    return { google: !!s.external?.google, apple: !!s.external?.apple }
  } catch {
    return { google: false, apple: false }
  }
}

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key')
