// Cloudflare Worker: serves the website (from dist/) and the push endpoint.
import { handlePush, type Env } from './push'

interface Fetcher {
  fetch(request: Request): Promise<Response>
}

export default {
  async fetch(request: Request, env: Env & { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/push') {
      return request.method === 'POST' ? handlePush(request, env) : new Response('Method not allowed', { status: 405 })
    }
    return env.ASSETS.fetch(request)
  },
}
