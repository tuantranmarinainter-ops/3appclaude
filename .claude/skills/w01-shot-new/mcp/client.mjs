// HTTP client for one App 2 server, bound to shot.api. One session cookie per base URL.
//   const c = client(shot); await c.project(); await c.command('scene.apply', {...}); await c.undo()
import { randomUUID } from 'node:crypto'

const cookies = new Map()

export function client(shot) {
  const base = String(shot?.api ?? '').replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('shot.json has no "api" URL')
  if (/:(3016|3002)(\/|$)/.test(base) && process.env.W01_ALLOW_REAL !== '1') throw new Error(`Refusing ${base}: real App 2 (set W01_ALLOW_REAL=1 only after the user approved)`)
  const id = shot.project
  if (!id) throw new Error('shot.json has no "project"')

  async function call(path, init = {}) {
    if (!cookies.get(base)) {
      const r = await fetch(base + '/api/unified/session', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' })
      const c = (r.headers.get('set-cookie') ?? '').split(';')[0]
      if (!c) throw new Error(`no session cookie from ${base} (${r.status})`)
      cookies.set(base, c)
    }
    const r = await fetch(base + path, { ...init, headers: { origin: base, cookie: cookies.get(base), ...(init.headers ?? {}) } })
    const text = await r.text()
    let json; try { json = JSON.parse(text) } catch { json = text }
    if (!r.ok) throw new Error(`${path} ${r.status}: ${(typeof json === 'string' ? json : JSON.stringify(json)).slice(0, 400)}`)
    return json
  }

  const project = async () => (await call(`/api/unified/projects/${id}`)).project
  /** Runs one command against the current revision. Returns { revision, result }. */
  const command = async (cmd, args = {}) => {
    const p = await project()
    return call('/api/unified/commands', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID(), projectId: id, expectedRevision: p.revision, command: cmd, args }),
    })
  }
  const undo = () => command('history.undo', {})
  return { project, command, undo }
}
