// Cloudflare Pages Function: POST /api/push
// Supabase calls this (with a shared secret) to send web push notifications.
// It only encrypts + delivers; who gets what is decided in the database.
import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push'

interface Env {
  PUSH_SECRET: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
}

interface Body {
  subscriptions: PushSubscription[]
  title: string
  body: string
  url?: string
  tag?: string
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.PUSH_SECRET || request.headers.get('x-push-secret') !== env.PUSH_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  const msg = (await request.json()) as Body
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  const data = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? '/', tag: msg.tag })
  const gone: string[] = []
  let sent = 0

  await Promise.all(
    (msg.subscriptions ?? []).slice(0, 500).map(async (sub) => {
      try {
        const payload = await buildPushPayload({ data, options: { ttl: 3600, urgency: 'high' } }, { ...sub, expirationTime: null }, vapid)
        const res = await fetch(sub.endpoint, payload)
        if (res.status === 404 || res.status === 410) gone.push(sub.endpoint)
        else if (res.ok) sent++
      } catch {
        /* one bad device should not stop the others */
      }
    }),
  )
  // Supabase reads "gone" later and forgets those devices.
  return Response.json({ gone, sent })
}
