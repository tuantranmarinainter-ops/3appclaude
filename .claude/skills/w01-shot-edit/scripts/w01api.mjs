// App 2 HTTP API client (session cookie, upload, command, project). Import from your own edit scripts:
//   import { project, command, upload } from 'file:///S:/Claude/w01/.claude/skills/w01-shot-edit/scripts/w01api.mjs'
// W01_API picks the server (default the sandbox http://127.0.0.1:3131). The user's real App 2 (3016) and 3002 are refused
// unless W01_ALLOW_REAL=1 (only after the user approved writing the real project).
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export const BASE = process.env.W01_API ?? 'http://127.0.0.1:3131'
if (/:(3016|3002)\b/.test(BASE) && process.env.W01_ALLOW_REAL !== '1') throw new Error(`Refusing ${BASE}: set W01_ALLOW_REAL=1 only after the user approved writing the real project`)
let cookie = ''

async function call(path, init = {}) {
  if (!cookie) {
    const r = await fetch(BASE + '/api/unified/session', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: '{}' })
    cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
    if (!cookie) throw new Error(`no session cookie from ${BASE} (${r.status})`)
  }
  const r = await fetch(BASE + path, { ...init, headers: { origin: BASE, cookie, ...(init.headers ?? {}) } })
  const text = await r.text()
  let json; try { json = JSON.parse(text) } catch { json = text }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${typeof json === 'string' ? json.slice(0, 400) : JSON.stringify(json).slice(0, 800)}`)
  return json
}

/** { project, history } */
export const project = (id) => call(`/api/unified/projects/${id}`)

export const upload = (file, name) => call('/api/unified/uploads', {
  method: 'POST', body: readFileSync(file), headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
})

/** Runs one command against the current revision (fetched first). Returns the command response ({ revision, result }). */
export async function command(projectId, cmd, args) {
  const { project: p } = await project(projectId)
  return call('/api/unified/commands', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), projectId, expectedRevision: p.revision, command: cmd, args }),
  })
}

/** Review stills (BBS look, through the shot camera): up to 8 frames per call, returns data URLs. Ignores user keys! */
export async function stills(projectId, sequenceId, clipId, frames) {
  return call(`/api/unified/projects/${projectId}/review-capture`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sequenceId, clipId, frames }),
  })
}
