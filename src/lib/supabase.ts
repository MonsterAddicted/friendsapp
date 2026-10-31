import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** False until the Supabase keys are filled in (.env.local or Cloudflare settings). */
export const configured = Boolean(url && key)

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key')
