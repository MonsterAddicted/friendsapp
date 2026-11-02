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
1. SQL Editor → New query → paste all of `supabase/schema.sql` → Run. Then the updates in order: `002_…`, `003_…`, `004_round3.sql` (+ push address/secret), `005_round4.sql`, `006_friends.sql`.
2. Authentication → Sign In / Providers → Email: turn **off** "Confirm email" (so friends can sign up instantly).
3. Authentication → URL Configuration: add the Cloudflare URL (and `http://localhost:5173`) to Redirect URLs.

## Languages
English + German. Texts in the code are English and wrapped in `t('…')`; the German versions live in `src/lib/de.ts` (English text = key).
The app follows the phone language, or the choice in Settings → Look → Language.

## Look check without signing in (dev only)
`npm run dev`, then open `http://localhost:5173/?preview&tab=feed` (tabs: feed, map, meetups, group, me; add `&theme=dark`, `&lang=de`, `&sheet=person|wheel|sos`).
Fake people, no login. Never part of the live site.

## Sign in with Apple (later, for the App Store)
Needs an Apple Developer account. Set it up in Supabase (Authentication → Providers → Apple), then add `VITE_APPLE_LOGIN=1` to `.env.production` and the button appears.

## Deploy (Cloudflare Worker)
Connected to GitHub: every push to `main` builds (`npm run build`) and deploys (`npx wrangler deploy`).
Hosted on Cloudflare Pages (`friendsapp-2je.pages.dev`): static site from `dist/` + `functions/api/push.ts`. (`wrangler.worker.jsonc` = ready-made config if we ever move to a Worker.)
Public build values are in `.env.production`. Secrets `VAPID_PRIVATE_KEY` and `PUSH_SECRET` are set in the Cloudflare dashboard.
