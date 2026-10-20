import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

type SessionState = typeof globalThis & { __bbsUnifiedSessions?: Map<string, number> }
const globalState = globalThis as SessionState
const sessions = globalState.__bbsUnifiedSessions ??= new Map<string, number>()
const COOKIE = 'bbs_unified_session'
const SESSION_TTL = 8 * 60 * 60 * 1000

function loopback(host: string): boolean {
  const hostname = host.replace(/^\[|\]$/g, '').toLowerCase()
  return hostname === 'localhost' || hostname === '::1' || (isIP(hostname) === 4 && hostname.startsWith('127.'))
}

function requestHostIsLoopback(host: string): boolean {
  try {
    const parsed = new URL(`http://${host}`)
    return parsed.host.toLowerCase() === host.toLowerCase() && loopback(parsed.hostname)
  } catch { return false }
}

export function validateLocalRequest(request: Request, requireSession = true): Response | null {
  const host = request.headers.get('host') ?? new URL(request.url).host
  if (!requestHostIsLoopback(host)) return Response.json({ error: 'LOCAL_ONLY' }, { status: 403 })
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      const parsed = new URL(origin)
      if (!['http:', 'https:'].includes(parsed.protocol) || !loopback(parsed.hostname) || parsed.host.toLowerCase() !== host.toLowerCase()) return Response.json({ error: 'ORIGIN_REJECTED' }, { status: 403 })
    } catch { return Response.json({ error: 'ORIGIN_REJECTED' }, { status: 403 }) }
  } else if (requireSession && !['GET', 'HEAD'].includes(request.method)) {
    return Response.json({ error: 'ORIGIN_REQUIRED' }, { status: 403 })
  }
  if (!requireSession) return null
  const token = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1]
  const expiresAt = token ? sessions.get(token) : undefined
  if (!token || !expiresAt || expiresAt < Date.now()) {
    if (token) sessions.delete(token)
    return Response.json({ error: 'SESSION_REQUIRED' }, { status: 401 })
  }
  return null
}

export function issueLocalSession(request: Request): Response {
  const rejected = validateLocalRequest(request, false)
  if (rejected) return rejected
  const token = randomBytes(32).toString('hex')
  sessions.set(token, Date.now() + SESSION_TTL)
  for (const [key, expiry] of sessions) if (expiry < Date.now()) sessions.delete(key)
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/unified; Max-Age=${SESSION_TTL / 1000}${secure}`, 'Cache-Control': 'no-store' } })
}
