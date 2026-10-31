# friendsapp

Your friend group in one app: see what everyone is doing, where they are, and open meetup requests (party, eat, sport…).
Website first (Cloudflare Pages), then Android/iOS with Capacitor — same code, same look.

## Stack
- React + Vite + TypeScript (`src/`)
- Supabase: login, database, live updates (`supabase/schema.sql`)
- Leaflet + OpenStreetMap for the friends map

## Run locally
1. Copy `.env.example` to `.env.local` and fill in the Supabase URL + public (anon) key.
2. `npm install`
3. `npm run dev` → open the shown link (also works on your phone in the same Wi-Fi).

## Supabase setup (once)
1. SQL Editor → New query → paste all of `supabase/schema.sql` → Run.
2. Authentication → Sign In / Providers → Email: turn **off** "Confirm email" (so friends can sign up instantly).
3. Authentication → URL Configuration: add the Cloudflare URL (and `http://localhost:5173`) to Redirect URLs.

## Deploy (Cloudflare Pages)
Build command `npm run build`, output folder `dist`, env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
