import { randomUUID, createHash } from 'node:crypto'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

// Process generation is part of every lease/ticket: a restarted broker never replays a dispatched command.
export const APP3_READ_TOOLS = ['read_keyframes', 'analyze_motion', 'get_scene_context', 'get_animation_context'] as const
export const LOCAL_EDIT_TOOLS=['create_blocking','set_pose','insert_breakdown','set_marker','set_idea','preview_patch','apply_patch','cancel_patch','undo_animation'] as const;
export function validateApp3Edit(tool: unknown,value: unknown): asserts value is Record<string, unknown> {
 const args=value as any;
 if(!LOCAL_EDIT_TOOLS.includes(tool as any))throw new App3BridgeError('UNSUPPORTED_CAPABILITY','UNSUPPORTED_CAPABILITY',422);
 if(!args||typeof args!=='object'||Array.isArray(args))throw new App3BridgeError('VALIDATION_FAILED','VALIDATION_FAILED',400);
 const fields=({create_blocking:['markers','idea'],set_pose:['time','transforms','interpolation'],insert_breakdown:['time','boneIds','label','fraction','offsets'],set_marker:['markerId','label','locked','kind'],set_idea:['idea'],preview_patch:['patchId','original'],apply_patch:['patchId'],cancel_patch:['patchId'],undo_animation:[]} as Record<string,string[]>)[String(tool)];
 const fail=(): never=>{throw new App3BridgeError('VALIDATION_FAILED','VALIDATION_FAILED',400);},obj=(x:any)=>x&&typeof x==='object'&&!Array.isArray(x),text=(x:any,n:number)=>typeof x==='string'&&x.length<=n,number=(x:any,min:number,max:number)=>Number.isFinite(x)&&x>=min&&x<=max,vec=(x:any,n:number)=>Array.isArray(x)&&x.length===n&&x.every(Number.isFinite),bone=(x:any)=>text(x,200)&&x.length>0;
 if(Object.keys(args).some(k=>!fields.includes(k)))fail();
 if(tool==='create_blocking'){
  if(!Array.isArray(args.markers)||args.markers.length<2||args.markers.length>128)fail();
  for(const m of args.markers){if(!obj(m)||Object.keys(m).some(k=>!['id','time','label','kind','locked'].includes(k))||!number(m.time,0,300)||!text(m.label,160))fail();if(m.id!==undefined&&(!text(m.id,80)||!/^[\w-]{1,80}$/.test(m.id)))fail();if(m.kind!==undefined&&!['pose','contact','breakdown','hold'].includes(m.kind))fail();if(m.locked!==undefined&&typeof m.locked!=='boolean')fail();}
 }
 if(tool==='set_idea'&&!text(args.idea,4000)||args.idea!==undefined&&!text(args.idea,4000))fail();
 if(['set_pose','insert_breakdown'].includes(String(tool))&&!number(args.time,0,300))fail();
 if(tool==='set_pose'){
  if(!obj(args.transforms)||!Object.keys(args.transforms).length||Object.keys(args.transforms).length>256)fail();
  for(const[id,t]of Object.entries(args.transforms as Record<string,any>))if(!bone(id)||!obj(t)||Object.keys(t).some(k=>!['p','q','s'].includes(k))||!vec(t.p,3)||!vec(t.q,4)||!vec(t.s,3)||Math.hypot(...t.q)<1e-8)fail();
  if(args.interpolation!==undefined&&!['step','linear','auto','cubic','smooth'].includes(args.interpolation))fail();
 }
 if(tool==='insert_breakdown'){
  if(!Array.isArray(args.boneIds)||!args.boneIds.length||args.boneIds.length>256||args.boneIds.some((x:any)=>!bone(x)))fail();
  if(args.fraction!==undefined&&!number(args.fraction,0,1))fail();
  if(args.offsets!==undefined&&(!obj(args.offsets)||Object.entries(args.offsets).some(([id,v])=>!args.boneIds.includes(id)||!vec(v,3))))fail();
 }
 if(args.label!==undefined&&!text(args.label,160))fail();
 if(tool==='set_marker'&&(!text(args.markerId,80)||!args.markerId.length||Object.keys(args).length<2))fail();
 if(args.locked!==undefined&&typeof args.locked!=='boolean'||args.kind!==undefined&&!['pose','contact','breakdown','hold'].includes(args.kind))fail();
 if(['preview_patch','apply_patch','cancel_patch'].includes(String(tool))&&(!text(args.patchId,100)||!args.patchId.length))fail();
 if(args.original!==undefined&&typeof args.original!=='boolean')fail();
}

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
type Ticket = { commandId: string; requestId: string; fingerprint: string; tool: string; args: Record<string, unknown>; projectRevision?: number; expectedAnimationRevision?: string; status: 'queued' | 'dispatched' | 'done' | 'expired'; created: number; expiredError?: string; result?: Record<string, unknown> }
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
export function executeApp3Bridge(project: UnifiedProject, command: string, a: Record<string, unknown>, requestId: string, dryRun = false, expectedProjectRevision?: number): Record<string, unknown> {
  bounded(a)
  if (command === 'app3.session.list') {
    fields(a, [])
    return { sessions: [...state.sessions.values()].filter(s => s.projectId === project.projectId && Date.now() - s.heartbeat <= TTL).map(s => ({ ...identity(s), ready: s.ready, active: s.active, heartbeatAgeMs: Date.now() - s.heartbeat, capabilities: [...APP3_READ_TOOLS,...LOCAL_EDIT_TOOLS] })) }
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
  const receiver = ['app3.session.poll', 'app3.session.result', 'app3.session.close', 'app3.session.claim'].includes(command)
  const common = [...identityFields, ...(receiver ? ['receiverToken'] : [])]
  const extras: Record<string, string[]> = { 'app3.context.get': [], 'app3.command.submit': ['tool', 'parameters', 'expectedAnimationRevision'], 'app3.command.result': ['commandId'], 'app3.session.poll': ['ready', 'active', 'context'], 'app3.session.result': ['commandId', 'result', 'context'], 'app3.session.close': [], 'app3.session.claim': ['commandId'] }
  if (!(command in extras)) fail('UNSUPPORTED_CAPABILITY', 422)
  fields(a, [...common, ...extras[command]])
  const s = session(project, a, receiver)
  if (command === 'app3.context.get') return { ...identity(s), ready: s.ready, active: s.active, context: s.context, freshness: 'cached-heartbeat', heartbeatAgeMs: Date.now() - s.heartbeat }
  if (command === 'app3.command.submit') {
    const editing=LOCAL_EDIT_TOOLS.includes(a.tool as any)
    if(editing){
      validateApp3Edit(a.tool,a.parameters)
      if(!Number.isInteger(expectedProjectRevision))fail('VALIDATION_FAILED',400)
      if(expectedProjectRevision!==project.revision)fail('REVISION_CONFLICT')
      if(typeof a.expectedAnimationRevision!=='string'||!a.expectedAnimationRevision.length)fail('VALIDATION_FAILED',400)
      if(!s.active)fail('APP3_INACTIVE')
    }else {validateApp3Read(a.tool,a.parameters);if(a.expectedAnimationRevision!==undefined)fail('VALIDATION_FAILED',400)}
    if (!s.ready) fail('APP3_NOT_READY', 503)
    const fingerprint = createHash('sha256').update(JSON.stringify({ tool: a.tool, parameters: a.parameters,expectedAnimationRevision:a.expectedAnimationRevision,projectRevision:editing?expectedProjectRevision:undefined })).digest('hex')
    const existing = [...s.tickets.values()].find(t => t.requestId === requestId)
    if (existing) { if (existing.fingerprint !== fingerprint) fail('REQUEST_ID_CONFLICT'); return { ...identity(s), commandId: existing.commandId, status: existing.status } }
    if (s.tickets.size >= 256) fail('QUEUE_FULL', 429)
    if (dryRun) return { valid: true }
    const t: Ticket = { commandId: randomUUID(), requestId, fingerprint, tool: a.tool as string, args: a.parameters as Record<string,unknown>, ...(editing?{projectRevision:expectedProjectRevision,expectedAnimationRevision:a.expectedAnimationRevision as string}:{}), status: 'queued', created: Date.now() }
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
    if(next?.projectRevision!==undefined&&next.status==='queued'&&(next.projectRevision!==project.revision||!s.active)){
      next.status='done';next.result={ok:false,error:next.projectRevision!==project.revision?'REVISION_CONFLICT':'APP3_INACTIVE'};return {...identity(s),commands:[]}
    }
    if (next && s.ready) { next.status = 'dispatched'; return { ...identity(s), commands: [{ commandId: next.commandId, tool: next.tool, args: next.args, ...(next.expectedAnimationRevision?{expectedAnimationRevision:next.expectedAnimationRevision,projectRevision:next.projectRevision}:{}) }] } }
    return { ...identity(s), commands: [] }
  }
  const t = ticket(s, a.commandId)
  if(command==='app3.session.claim'){
    if(t.status!=='dispatched')fail('COMMAND_OUTCOME_UNKNOWN')
    if(t.projectRevision!==undefined){if(t.projectRevision!==project.revision)fail('REVISION_CONFLICT');if(!s.active)fail('APP3_INACTIVE')}
    return {valid:true}
  }
  if (!record(a.result) || typeof a.result.ok !== 'boolean' || !record(a.context)) fail('VALIDATION_FAILED', 400)
  if (t.status === 'done') {
    if (JSON.stringify(t.result) !== JSON.stringify(a.result)) fail('RESULT_CONFLICT')
    return { acknowledged: true, commandId: t.commandId }
  }
  if (t.status !== 'dispatched') fail('COMMAND_OUTCOME_UNKNOWN')
  t.result = a.result; t.status = 'done'; s.context = a.context; s.heartbeat = Date.now()
  return { acknowledged: true, commandId: t.commandId }
}
