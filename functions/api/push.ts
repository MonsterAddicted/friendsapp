// Cloudflare Pages version of POST /api/push (the Worker version uses worker/index.ts).
import { handlePush, type Env } from '../../worker/push'

export const onRequestPost = ({ request, env }: { request: Request; env: Env }) => handlePush(request, env)
