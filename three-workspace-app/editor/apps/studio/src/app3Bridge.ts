import { randomUUID, createHash } from 'node:crypto'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

// Process generation is part of every lease/ticket: a restarted broker never replays a dispatched command.
export const APP3_READ_TOOLS = ['read_keyframes', 'analyze_motion', 'get_scene_context', 'get_animation_context'] as const
const TTL = 120_000
const COMMAND_TTL = 60_000
const MAX_BYTES = 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
export class App3BridgeError extends Error {
  constructor(readonly code: string, message = code, readonly status = 409) { super(message) }
}
function fail(code: string, status = 409): never { throw new App3BridgeError(code, code, status) }
function fields(a: Record<string, unknown>, keys: string[]) {
  if (Object.keys(a).some(k => !keys.includes(k))) fail('VALIDATION_FAILED', 400)
}
function identifier(x: unknown): asserts x is string { if (typeof x !== 'string' || !uuid.test(x)) fail('VALIDATION_FAILED', 400) }
function bounded(x: unknown) {
  let size: number
  try { size = Buffer.byteLength(JSON.stringify(x)) } catch { return fail('VALIDATION_FAILED', 400) }
  if (size > MAX_BYTES) fail('PAYLOAD_TOO_LARGE', 413)
  const finite = (v: unknown): boolean => typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finite) : record(v) ? Object.values(v).every(finite) : true
  if (!finite(x)) fail('VALIDATION_FAILED', 400)
}
export function validateApp3Read(tool: unknown, value: unknown): asserts value is Record<string, unknown> {
  if (!APP3_READ_TOOLS.includes(tool as typeof APP3_READ_TOOLS[number])) fail('UNSUPPORTED_CAPABILITY', 422)
  if (!record(value)) fail('VALIDATION_FAILED', 400)
  fields(value, tool === 'read_keyframes' ? ['boneIds', 'start', 'end'] : tool === 'analyze_motion' ? ['boneIds', 'start', 'end', 'samples'] : [])
  bounded(value)
  if (value.boneIds !== undefined && (!Array.isArray(value.boneIds) || !value.boneIds.length || value.boneIds.length > 256 || value.boneIds.some(id => typeof id !== 'string' || !id.length || id.length > 200))) fail('VALIDATION_FAILED', 400)
  for (const key of ['start', 'end']) if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || (value[key] as number) < 0)) fail('VALIDATION_FAILED', 400)
  if (typeof value.start === 'number' && typeof value.end === 'number' && value.end < value.start) fail('VALIDATION_FAILED', 400)
  if (value.samples !== undefined && (!Number.isInteger(value.samples) || (value.samples as number) < 4 || (value.samples as number) > 600)) fail('VALIDATION_FAILED', 400)
}
export function app3BindingCandidates(project: UnifiedProject, sourceSha256: string) {
  const found: Array<{ characterId: string; sourceMotionId?: string }> = []
  for (const character of Object.values(project.characters)) {
    if (project.assets[character.assetId]?.source.sha256 === sourceSha256) found.push({ characterId: character.id })
    for (const motion of Object.values(project.motions)) {
      if (project.assets[motion.assetId]?.source.sha256 === sourceSha256 && Object.values(project.bindings).some(b => b.characterId === character.id && b.motionId === motion.id)) found.push({ characterId: character.id, sourceMotionId: motion.id })
    }
  }
  return found
}
type Ticket = { commandId: string; requestId: string; fingerprint: string; tool: string; args: Record<string, unknown>; status: 'queued' | 'dispatched' | 'done' | 'expired'; created: number; expiredError?: string; result?: Record<string, unknown> }
type Session = { projectId: string; sessionId: string; epoch: string; characterId: string; sourceSha256: string; sourceMotionId?: string; receiverToken: string; heartbeat: number; ready: boolean; active: boolean; context: Record<string, unknown>; tickets: Map<string, Ticket> }
type State = { instance: string; sessions: Map<string, Session> }
const globalState = globalThis as typeof globalThis & { __bbsApp3Bridge?: State }
const state = globalState.__bbsApp3Bridge ??= { instance: randomUUID(), sessions: new Map() }
const identityFields = ['sessionId', 'epoch', 'characterId', 'serverInstance']
function identity(s: Session) { return { projectId: s.projectId, sessionId: s.sessionId, epoch: s.epoch, characterId: s.characterId, serverInstance: state.instance } }
function session(project: UnifiedProject, a: Record<string, unknown>, receiver = false): Session {
  for (const key of identityFields) identifier(a[key])
  if (a.serverInstance !== state.instance) fail('SESSION_REPLACED')
  const s = state.sessions.get(a.sessionId as string)
  if (!s || s.projectId !== project.projectId) fail('APP3_NOT_OPEN', 404)
  if (s.epoch !== a.epoch || s.characterId !== a.characterId) fail('SESSION_REPLACED')
  if (Date.now() - s.heartbeat > TTL) fail('APP3_OFFLINE', 503)
  if (!app3BindingCandidates(project, s.sourceSha256).some(c => c.characterId === s.characterId && c.sourceMotionId === s.sourceMotionId)) fail('SESSION_REPLACED')
  if (receiver && a.receiverToken !== s.receiverToken) fail('RECEIVER_REJECTED', 403)
  return s
}
function ticket(s: Session, id: unknown) {
  identifier(id)
  const t = s.tickets.get(id)
  if (!t) fail('COMMAND_NOT_FOUND', 404)
  if (t.status !== 'done' && t.status !== 'expired' && Date.now() - t.created > COMMAND_TTL) { t.expiredError = t.status === 'queued' ? 'APP3_OFFLINE' : 'COMMAND_OUTCOME_UNKNOWN'; t.status = 'expired' }
  return t
}
export function executeApp3Bridge(project: UnifiedProject, command: string, a: Record<string, unknown>, requestId: string, dryRun = false): Record<string, unknown> {
  bounded(a)
  if (command === 'app3.session.list') {
    fields(a, [])
    return { sessions: [...state.sessions.values()].filter(s => s.projectId === project.projectId && Date.now() - s.heartbeat <= TTL).map(s => ({ ...identity(s), ready: s.ready, active: s.active, heartbeatAgeMs: Date.now() - s.heartbeat, capabilities: APP3_READ_TOOLS })) }
  }
  if (command === 'app3.session.register') {
    fields(a, ['sessionId', 'epoch', 'characterId', 'sourceSha256', 'sourceMotionId', 'ready', 'active', 'context'])
    identifier(a.sessionId); identifier(a.epoch); identifier(a.characterId)
    if (typeof a.sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sourceSha256) || typeof a.ready !== 'boolean' || typeof a.active !== 'boolean' || !record(a.context)) fail('VALIDATION_FAILED', 400)
    if (a.sourceMotionId !== undefined) identifier(a.sourceMotionId)
    if (!app3BindingCandidates(project, a.sourceSha256).some(c => c.characterId === a.characterId && c.sourceMotionId === a.sourceMotionId)) fail('IDENTITY_MISMATCH', 403)
    const previous = state.sessions.get(a.sessionId)
    if (previous) fail('SESSION_ALREADY_REGISTERED')
    if (dryRun) return { valid: true }
    const s: Session = { projectId: project.projectId, sessionId: a.sessionId, epoch: a.epoch, characterId: a.characterId, sourceSha256: a.sourceSha256, ...(typeof a.sourceMotionId === 'string' ? { sourceMotionId: a.sourceMotionId } : {}), receiverToken: randomUUID(), heartbeat: Date.now(), ready: a.ready, active: a.active, context: a.context, tickets: new Map() }
    state.sessions.set(s.sessionId, s)
    // Bound dead leases; never evict a live session to make room.
    for (const [id, old] of state.sessions) if (Date.now() - old.heartbeat > TTL * 2) state.sessions.delete(id)
    return { ...identity(s), receiverToken: s.receiverToken }
  }
  const receiver = ['app3.session.poll', 'app3.session.result', 'app3.session.close'].includes(command)
  const common = [...identityFields, ...(receiver ? ['receiverToken'] : [])]
  const extras: Record<string, string[]> = { 'app3.context.get': [], 'app3.command.submit': ['tool', 'parameters'], 'app3.command.result': ['commandId'], 'app3.session.poll': ['ready', 'active', 'context'], 'app3.session.result': ['commandId', 'result', 'context'], 'app3.session.close': [] }
  if (!(command in extras)) fail('UNSUPPORTED_CAPABILITY', 422)
  fields(a, [...common, ...extras[command]])
  const s = session(project, a, receiver)
  if (command === 'app3.context.get') return { ...identity(s), ready: s.ready, active: s.active, context: s.context, freshness: 'cached-heartbeat', heartbeatAgeMs: Date.now() - s.heartbeat }
  if (command === 'app3.command.submit') {
    validateApp3Read(a.tool, a.parameters)
    if (!s.ready) fail('APP3_NOT_READY', 503)
    const fingerprint = createHash('sha256').update(JSON.stringify({ tool: a.tool, parameters: a.parameters })).digest('hex')
    const existing = [...s.tickets.values()].find(t => t.requestId === requestId)
    if (existing) { if (existing.fingerprint !== fingerprint) fail('REQUEST_ID_CONFLICT'); return { ...identity(s), commandId: existing.commandId, status: existing.status } }
    if (s.tickets.size >= 256) fail('QUEUE_FULL', 429)
    if (dryRun) return { valid: true }
    const t: Ticket = { commandId: randomUUID(), requestId, fingerprint, tool: a.tool as string, args: a.parameters, status: 'queued', created: Date.now() }
    s.tickets.set(t.commandId, t)
    return { ...identity(s), commandId: t.commandId, status: t.status }
  }
  if (command === 'app3.command.result') { const t = ticket(s, a.commandId); return { ...identity(s), commandId: t.commandId, status: t.status, ...(t.result ? { result: t.result } : {}), ...(t.status === 'expired' ? { error: t.expiredError } : {}) } }
  if (dryRun) return { valid: true }
  if (command === 'app3.session.close') { state.sessions.delete(s.sessionId); return { closed: true } }
  if (command === 'app3.session.poll') {
    if (typeof a.ready !== 'boolean' || typeof a.active !== 'boolean' || !record(a.context)) fail('VALIDATION_FAILED', 400)
    s.heartbeat = Date.now(); s.ready = a.ready; s.active = a.active; s.context = a.context
    // A lost reply is retried with the same command ID; the receiver caches the in-flight promise.
    for (const [id, t] of s.tickets) { ticket(s, id); if (Date.now() - t.created > TTL * 5) s.tickets.delete(id) }
    const next = [...s.tickets.values()].find(t => t.status === 'dispatched') ?? [...s.tickets.values()].find(t => t.status === 'queued')
    if (next && s.ready) { next.status = 'dispatched'; return { ...identity(s), commands: [{ commandId: next.commandId, tool: next.tool, args: next.args }] } }
    return { ...identity(s), commands: [] }
  }
  const t = ticket(s, a.commandId)
  if (!record(a.result) || typeof a.result.ok !== 'boolean' || !record(a.context)) fail('VALIDATION_FAILED', 400)
  if (t.status === 'done') {
    if (JSON.stringify(t.result) !== JSON.stringify(a.result)) fail('RESULT_CONFLICT')
    return { acknowledged: true, commandId: t.commandId }
  }
  if (t.status !== 'dispatched') fail('COMMAND_OUTCOME_UNKNOWN')
  t.result = a.result; t.status = 'done'; s.context = a.context; s.heartbeat = Date.now()
  return { acknowledged: true, commandId: t.commandId }
}
