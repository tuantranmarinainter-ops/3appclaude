#!/usr/bin/env node
/**
 * App 1 Workbench: a loopback-only web UI over the headless normalize core.
 * Run from editor/packages/builder (so tsx resolves):
 *   node --import tsx ../retarget/workbench/server.ts [--port 3101]
 * Uploads live in os.tmpdir()/w01-workbench/<session>/; nothing is written into the repo or next to user files.
 */
import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadAsset, packGltf, stripGltfTextures } from '../cli/loadAsset.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import {
  buildPreset, DEFAULT_ARMATURE, describeSource, inspect, parseFamily, parseOptions, runPipeline, sha256, UserError,
  type RunFile, type SourceRecord, type TargetRecord,
} from './pipeline.ts'
import { previewClips, previewModel, skinnedPreviewModel, steveFiles } from './steve.ts'
import { importPack, listLibraryCharacters, registerLibraryCharacter, resolveLibraryPath } from '../../library/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, 'public')
const charactersDir = resolve(here, '../../../../builtin-assets/characters')
/** Bones every Mixamo65 target must have (canonical names, prefix stripped). */
const MIXAMO_CORE = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024
const JSON_LIMIT_BYTES = 8 * 1024 * 1024
const SOURCE_EXTENSIONS = new Set(['.glb', '.gltf', '.fbx', '.bobj'])
/** Only these subtrees of the `three` package are reachable from the browser. */
const VENDOR_PREFIXES = ['build/', 'examples/jsm/']
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bobj': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' }

export interface Workbench { server: Server; url: string; port: number; sessionDir: string; close(): Promise<void> }

/** `three` resolved the same way the retarget package does, so the browser and the CLI use one version. */
function threeRoot(): string {
  const require = createRequire(resolve(here, '../package.json'))
  return dirname(dirname(require.resolve('three'))) // .../three/build/three.cjs -> .../three (package.json is not an exported subpath)
}

type RunState = { id: string; state: 'running' | 'done' | 'error' | 'CANCELLED'; controller: AbortController; stage: string; done: number; total: number; startedAt: number; elapsedMs: number; dir: string
  result?: { runId: string; status: string; report: Record<string, any>; manifest: unknown; files: Array<RunFile & { url: string }> }; error?: string }

export async function startWorkbench(options: { port?: number } = {}): Promise<Workbench> {
  const root = threeRoot()
  const sessionId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
  const sessionDir = join(tmpdir(), 'w01-workbench', sessionId)
  mkdirSync(join(sessionDir, 'uploads'), { recursive: true }); mkdirSync(join(sessionDir, 'runs'), { recursive: true })

  const sources = new Map<string, SourceRecord>()
  const runs = new Map<string, RunState>()
  let active: RunState | null = null
  let port = 0

  // Targets: the four builtin Mixamo65 characters plus the user's own Mixamo65 characters registered in the App 5
  // library ("Thêm nhân vật đích"); hips height measured from the file itself.
  const targets = new Map<string, TargetRecord>()
  // Named Minecraft20 characters: App 5 library characters with rig minecraft20 and a 64×64 player skin (`skin.png`).
  const mc20 = new Map<string, { id: string; name: string; skin: string }>()
  async function measureTarget(path: string) {
    const bytes = readFileSync(path)
    const scene = await loadAsset(bytes, 'glb', { skeletonOnly: true })
    const adapter = createThreeRigAdapter(scene, { fingerprint: 'target' })
    const names = new Set(adapter.rig.bones.map((bone) => (bone.name ?? '').replace(/^mixamorig\d*:?/i, '').toLowerCase()))
    const hips = adapter.rig.bones.find((bone) => (bone.name ?? '').replace(/^mixamorig\d*:?/i, '').toLowerCase() === 'hips')
    adapter.dispose()
    const missing = MIXAMO_CORE.filter((name) => !names.has(name.toLowerCase()))
    return { bytes, hipsHeightMeters: hips?.restWorld[13] ?? 0, missing }
  }
  for (const file of readdirSync(charactersDir).filter((name) => name.endsWith('.glb')).sort()) {
    const path = join(charactersDir, file), measured = await measureTarget(path)
    const id = file.replace(/\.glb$/, '')
    targets.set(id, { id, file, path, sha256: sha256(measured.bytes), hipsHeightMeters: measured.hipsHeightMeters })
  }
  try {
    const root = resolveLibraryPath()
    for (const character of listLibraryCharacters()) {
      const skin = join(root, 'characters', character.charId, 'skin.png')
      if (character.rig === 'minecraft20' && existsSync(skin)) { mc20.set(character.charId, { id: character.charId, name: character.name, skin }); continue }
      if (character.rig !== 'mixamo65' || !character.model.endsWith('.glb')) continue
      const path = join(root, 'characters', character.charId, character.model)
      if (!existsSync(path)) continue
      const measured = await measureTarget(path)
      // `original/model.bbs.bobj`: the character keeps its own skeleton; `model.glb` is only the Mixamo65 view for the solver.
      const original = join(root, 'characters', character.charId, 'original')
      targets.set(`lib-${character.charId}`, { id: `lib-${character.charId}`, file: basename(path), path, sha256: sha256(measured.bytes), hipsHeightMeters: measured.hipsHeightMeters, name: character.name, library: true,
        ...(existsSync(join(original, 'model.bbs.bobj')) && existsSync(join(original, 'display.glb')) ? { original } : {}) })
    }
  } catch (error) { console.error('App 5 library characters were not loaded:', error instanceof Error ? error.message : error) }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) }).end(text)
  }
  const fail = (res: ServerResponse, status: number, message: string) => json(res, status, { error: message })

  const readBody = (req: IncomingMessage, limit: number) => new Promise<Buffer>((ok, bad) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) { bad(new UserError(`Request body is larger than ${Math.round(limit / 1048576)} MB`, 413)); req.destroy(); return }
      chunks.push(chunk)
    }).on('end', () => ok(Buffer.concat(chunks))).on('error', bad)
  })
  const readJson = async (req: IncomingMessage) => {
    const text = (await readBody(req, JSON_LIMIT_BYTES)).toString('utf8')
    try { return (text ? JSON.parse(text) : {}) as Record<string, any> } catch { throw new UserError('Request body is not valid JSON') }
  }

  const sendFile = (res: ServerResponse, path: string, type?: string, extra: Record<string, string> = {}) => {
    const stat = statSync(path)
    res.writeHead(200, { 'content-type': type ?? MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-store', ...extra })
    createReadStream(path).on('error', () => res.destroy()).pipe(res)
  }
  const sendBytes = (res: ServerResponse, bytes: Uint8Array, type: string) => {
    res.writeHead(200, { 'content-type': type, 'content-length': bytes.length, 'cache-control': 'no-store' }).end(Buffer.from(bytes))
  }

  /** Resolves `rel` under `base` or returns null; refuses `..`, absolute paths, NULs and anything that leaves `base` after normalization. */
  const inside = (base: string, rel: string): string | null => {
    let decoded: string
    try { decoded = decodeURIComponent(rel) } catch { return null }
    if (!decoded || decoded.includes('\0') || decoded.includes('\\') || isAbsolute(decoded) || decoded.split('/').some((part) => part === '..' || part === '.' || part === '')) return null
    const path = resolve(base, decoded), back = relative(base, path)
    return !back || back.startsWith('..') || isAbsolute(back) ? null : path
  }

  const getSource = (id: unknown) => {
    const record = typeof id === 'string' ? sources.get(id) : undefined
    if (!record) throw new UserError('Unknown sourceId; upload or select the source again', 404)
    return record
  }
  const getTarget = (id: unknown) => {
    const record = typeof id === 'string' ? targets.get(id) : undefined
    if (!record) throw new UserError('Unknown targetId', 404)
    return record
  }
  const targetView = (target: TargetRecord) => ({ id: target.id, file: target.file, name: target.name ?? target.file.replace(/^a3d_char_/, '').slice(0, 8), library: !!target.library, hipsHeightMeters: target.hipsHeightMeters, sha256: target.sha256, url: `/api/targets/${target.id}/file`,
    original: !!target.original, displayUrl: target.original ? `/api/targets/${target.id}/display.glb` : `/api/targets/${target.id}/file` })

  const registerSource = (path: string, name: string, uploaded: boolean, armaturePath?: string) => {
    const id = randomBytes(8).toString('hex')
    const record = describeSource(path, name, uploaded, id, armaturePath)
    sources.set(id, record)
    return { sourceId: id, name: record.name, format: record.format, bytes: record.bytes, sha256: record.sha256, uploaded, path: uploaded ? undefined : path }
  }

  async function handleSources(req: IncomingMessage, res: ServerResponse) {
    const type = String(req.headers['content-type'] ?? '')
    if (type.startsWith('application/json')) {
      const body = await readJson(req)
      if (typeof body.path !== 'string' || !body.path.trim()) throw new UserError('Provide { "path": "<local file>" } or upload the file as the raw body')
      const path = resolve(body.path.trim().replace(/^"(.*)"$/, '$1'))
      if (!existsSync(path) || !statSync(path).isFile()) throw new UserError(`File not found: ${path}`)
      if (!SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) throw new UserError(`Unsupported format ${extname(path) || '(none)'}; use .glb .gltf .fbx .bobj`)
      let armaturePath: string | undefined
      if (typeof body.armaturePath === 'string' && body.armaturePath.trim()) {
        armaturePath = resolve(body.armaturePath.trim().replace(/^"(.*)"$/, '$1'))
        if (!existsSync(armaturePath) || !statSync(armaturePath).isFile()) throw new UserError(`Armature file not found: ${armaturePath}`)
      }
      return json(res, 200, registerSource(path, basename(path), false, armaturePath ?? (extname(path).toLowerCase() === '.bobj' ? DEFAULT_ARMATURE : undefined)))
    }
    let name: string
    try { name = basename(decodeURIComponent(String(req.headers['x-file-name'] ?? ''))) } catch { throw new UserError('x-file-name is not valid') }
    if (!name || !SOURCE_EXTENSIONS.has(extname(name).toLowerCase())) throw new UserError('Send the file name in the x-file-name header (.glb .gltf .fbx .bobj)')
    if (extname(name).toLowerCase() === '.gltf') throw new UserError('A .gltf upload would lose its external .bin/texture files; give its local path instead, or upload a .glb')
    const length = Number(req.headers['content-length'] ?? 0)
    if (length > MAX_UPLOAD_BYTES) throw new UserError('File is larger than 512 MB', 413)
    const dir = join(sessionDir, 'uploads', randomBytes(6).toString('hex'))
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name.replace(/[^\w.\- ()]+/g, '_'))
    await new Promise<void>((ok, bad) => {
      const out = createWriteStream(path)
      let size = 0
      req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_UPLOAD_BYTES) { bad(new UserError('File is larger than 512 MB', 413)); req.destroy(); out.destroy() } })
      req.on('error', bad); out.on('error', bad); out.on('finish', () => ok())
      req.pipe(out)
    })
    if (!statSync(path).size) throw new UserError('Uploaded file is empty')
    json(res, 200, registerSource(path, name, true, extname(name).toLowerCase() === '.bobj' ? DEFAULT_ARMATURE : undefined))
  }

  /** Browser-loadable copy of a source: `.gltf` with external buffers becomes one GLB (textures dropped: they cannot be fetched from the folder). */
  function viewerGlb(record: SourceRecord): Uint8Array {
    return packGltf(stripGltfTextures(JSON.parse(readFileSync(record.path, 'utf8'))), dirname(record.path))
  }

  function startRun(source: SourceRecord, target: TargetRecord, body: Record<string, any>): RunState {
    const options = parseOptions(body.options)
    const family = parseFamily(body.presetFamily)
    const id = randomBytes(6).toString('hex')
    const dir = join(sessionDir, 'runs', id)
    mkdirSync(dir, { recursive: true })
    const state: RunState = { id, controller: new AbortController(), state: 'running', stage: 'queued', done: 0, total: 1, startedAt: Date.now(), elapsedMs: 0, dir }
    runs.set(id, state); active = state
    const onProgress = async (stage: string, done: number, total: number) => {
      state.controller.signal.throwIfAborted()
      state.stage = stage; state.done = done; state.total = total; state.elapsedMs = Date.now() - state.startedAt
      await new Promise<void>((ok) => setImmediate(ok)) // let HTTP polls through between Actions
    }
    void (async () => {
      try {
        const result = await runPipeline(source, target, options, body.mappingPreset ?? null, family, dir, onProgress, state.controller.signal)
        state.result = { runId: id, status: result.status, report: result.report, manifest: result.manifest,
          files: result.files.map((file) => ({ ...file, url: `/api/runs/${id}/files/${encodeURIComponent(file.name)}` })) }
        state.state = 'done'
      } catch (error) {
        if (state.controller.signal.aborted) {
          state.state = 'CANCELLED'; state.stage = 'CANCELLED'
          rmSync(dir, { recursive: true, force: true })
          return
        }
        state.state = 'error'; state.error = error instanceof Error ? error.message : String(error)
        console.error(`run ${id} failed:`, error)
      } finally { state.elapsedMs = Date.now() - state.startedAt; if (active === state) active = null }
    })()
    return state
  }
  const runView = (state: RunState) => ({ runId: state.id, state: state.state, stage: state.stage, done: state.done, total: state.total,
    elapsedMs: state.state === 'running' ? Date.now() - state.startedAt : state.elapsedMs, ...(state.error ? { error: state.error } : {}), ...(state.result ? { result: state.result } : {}) })

  async function handleApi(req: IncomingMessage, res: ServerResponse, path: string) {
    const method = req.method ?? 'GET'
    if (method === 'GET' && path === '/api/targets') return json(res, 200, { targets: [...targets.values()].map(targetView), mc20: [...mc20.values()].map(({ id, name }) => ({ id, name })) })
    if (method === 'POST' && path === '/api/targets') {
      // "Thêm nhân vật đích": a local Mixamo65 GLB (T-pose, metres) becomes a library character and a target here.
      const body = await readJson(req)
      if (typeof body.path !== 'string' || !body.path.trim()) throw new UserError('Provide { "path": "<local .glb>", "name": "<tên>" }')
      const file = resolve(body.path.trim().replace(/^"(.*)"$/, '$1'))
      if (!existsSync(file) || !statSync(file).isFile() || extname(file).toLowerCase() !== '.glb') throw new UserError(`Not a local .glb file: ${file}`)
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : basename(file, '.glb')
      const measured = await measureTarget(file)
      if (measured.missing.length) throw new UserError(`Not a Mixamo65 character: missing ${measured.missing.join(', ')}. Normalize it in App 1 with --mode model first.`)
      if (!(measured.hipsHeightMeters > 0.2 && measured.hipsHeightMeters < 5)) throw new UserError(`Hips height ${measured.hipsHeightMeters.toFixed(3)} m is not a metre-scale character`)
      const character = registerLibraryCharacter({ name, rig: 'mixamo65', modelFile: file })
      const stored = join(resolveLibraryPath(), 'characters', character.charId, character.model)
      const record: TargetRecord = { id: `lib-${character.charId}`, file: basename(file), path: stored, sha256: sha256(measured.bytes), hipsHeightMeters: measured.hipsHeightMeters, name, library: true }
      targets.set(record.id, record)
      return json(res, 200, targetView(record))
    }
    let match: RegExpMatchArray | null
    if (method === 'GET' && (match = path.match(/^\/api\/targets\/([\w-]+)\/file$/))) return sendFile(res, getTarget(match[1]).path, MIME['.glb'])
    if (method === 'GET' && (match = path.match(/^\/api\/targets\/([\w-]+)\/display\.glb$/))) {
      const target = getTarget(match[1])
      return sendFile(res, target.original ? join(target.original, 'display.glb') : target.path, MIME['.glb'])
    }
    if (method === 'POST' && path === '/api/sources') return handleSources(req, res)
    // Minecraft20 preview model: generated mannequin, or Steve from W01_STEVE_DIR (see steve.ts).
    if (method === 'GET' && path === '/api/steve') return json(res, 200, previewModel())
    if (method === 'GET' && (match = path.match(/^\/api\/mc20\/([\w-]+)(\/skin\.png)?$/))) {
      const character = mc20.get(match[1]!)
      if (!character) return fail(res, 404, 'Unknown Minecraft20 character')
      return match[2] ? sendFile(res, character.skin, MIME['.png']) : json(res, 200, skinnedPreviewModel(`/api/mc20/${character.id}/skin.png`))
    }
    if (method === 'GET' && path === '/api/steve/texture') {
      const files = steveFiles()
      if (!files) return fail(res, 404, 'Steve assets not configured (W01_STEVE_DIR)')
      return sendFile(res, files.texture, MIME['.png'])
    }
    if (method === 'GET' && (match = path.match(/^\/api\/sources\/(\w+)\/file$/))) {
      const record = getSource(match[1])
      if (record.format === 'gltf') return sendBytes(res, viewerGlb(record), MIME['.glb'])
      return sendFile(res, record.path, MIME[`.${record.format}`] ?? 'application/octet-stream')
    }
    if (method === 'POST' && path === '/api/inspect') {
      const body = await readJson(req)
      return json(res, 200, await inspect(getSource(body.sourceId), getTarget(body.targetId), parseOptions(body.options), body.mappingPreset ?? null, parseFamily(body.presetFamily)))
    }
    if (method === 'POST' && path === '/api/preset') {
      const body = await readJson(req)
      return json(res, 200, await buildPreset(getSource(body.sourceId), getTarget(body.targetId), body.assignments))
    }
    if (method === 'POST' && path === '/api/runs') {
      const body = await readJson(req)
      const source = getSource(body.sourceId), target = getTarget(body.targetId)
      parseOptions(body.options)
      if (active) return json(res, 409, { error: 'Another run is in progress; wait for it to finish', runId: active.id })
      const state = startRun(source, target, body)
      if (body.wait === false) return json(res, 202, runView(state))
      // Synchronous mode: resolve when the run finishes (same JSON the polling endpoint serves under `result`).
      while (state.state === 'running') await new Promise((ok) => setTimeout(ok, 20))
      if (state.state === 'CANCELLED') return json(res, 200, { runId: state.id, status: 'CANCELLED', files: [] })
      if (state.state === 'error') return fail(res, 500, `Run failed: ${state.error}`)
      return json(res, 200, { ...state.result!, elapsedMs: state.elapsedMs })
    }
    if (method === 'POST' && (match = path.match(/^\/api\/runs\/(\w+)\/cancel$/))) {
      const state = runs.get(match[1]!)
      if (!state) return fail(res, 404, 'Unknown runId')
      if (state.state === 'running') state.controller.abort()
      return json(res, 202, runView(state))
    }
    if (method === 'GET' && (match = path.match(/^\/api\/runs\/(\w+)$/))) {
      const state = runs.get(match[1]!)
      if (!state) return fail(res, 404, 'Unknown runId')
      return json(res, 200, runView(state))
    }
    if (method === 'POST' && (match = path.match(/^\/api\/runs\/(\w+)\/library$/))) {
      // "Gửi sang App 2": import the passing run into the shared App 5 library that App 2 places Actions from.
      const state = runs.get(match[1]!)
      if (!state || state.state !== 'done' || !state.result) return fail(res, 404, 'Unknown or unfinished runId')
      if (state.result.status !== 'PASS') return fail(res, 409, `Only a PASS run can go to the library (this run is ${state.result.status})`)
      const body = await readJson(req)
      const pack = importPack({ sourceDirectory: state.dir, createdBy: 'app1',
        ...(typeof body.category === 'string' ? { category: body.category } : {}),
        ...(Array.isArray(body.tags) ? { tags: body.tags.filter((tag: unknown): tag is string => typeof tag === 'string') } : {}) })
      return json(res, 200, { packId: pack.packId, rig: pack.rig, actions: pack.actions, created: pack.created,
        actionUuids: pack.metadata.actions.map((action) => action.uuid) })
    }
    if (method === 'GET' && (match = path.match(/^\/api\/runs\/(\w+)\/steve$/))) {
      const state = runs.get(match[1]!), file = state?.result?.files.find((item) => item.kind === 'bobj')
      if (!state || !file) return fail(res, 404, 'This run has no Minecraft20 .bobj')
      return json(res, 200, { clips: previewClips(readFileSync(join(state.dir, file.name), 'utf8')) })
    }
    if (method === 'GET' && (match = path.match(/^\/api\/runs\/(\w+)\/files\/([^/]+)$/))) {
      const state = runs.get(match[1]!)
      let name: string
      try { name = decodeURIComponent(match[2]!) } catch { return fail(res, 404, 'No such file') }
      const file = state?.result?.files.find((item) => item.name === name) // only names the run itself produced
      if (!state || !file) return fail(res, 404, 'No such file in this run')
      return sendFile(res, join(state.dir, file.name), undefined, { 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}` })
    }
    fail(res, 404, 'Unknown API route')
  }

  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    // DNS-rebinding / cross-site guard: only talk to pages loaded from this exact loopback origin.
    const host = String(req.headers.host ?? '')
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return fail(res, 403, 'Forbidden host')
    const origin = req.headers.origin
    if (origin && origin !== `http://${host}`) return fail(res, 403, 'Forbidden origin')
    const rawPath = (req.url ?? '/').split('?')[0]!
    if (rawPath.startsWith('/api/')) return handleApi(req, res, rawPath)
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed')
    if (rawPath.startsWith('/vendor/three/')) {
      const rel = rawPath.slice('/vendor/three/'.length)
      const path = inside(root, rel)
      let decoded = ''
      try { decoded = decodeURIComponent(rel) } catch { /* handled by inside() */ }
      if (!path || !VENDOR_PREFIXES.some((prefix) => decoded.startsWith(prefix))) return fail(res, 403, 'Forbidden')
      if (!existsSync(path) || !statSync(path).isFile()) return fail(res, 404, 'Not found')
      return sendFile(res, path)
    }
    const rel = rawPath === '/' ? 'index.html' : rawPath.slice(1)
    const path = inside(publicDir, rel)
    if (!path) return fail(res, 403, 'Forbidden')
    if (!existsSync(path) || !statSync(path).isFile()) return fail(res, 404, 'Not found')
    sendFile(res, path)
  }

  const server = createServer((req, res) => {
    serve(req, res).catch((error) => {
      if (res.headersSent) { res.destroy(); return }
      if (error instanceof UserError) return fail(res, error.status, error.message)
      // Never leak stacks to the client; the console keeps them.
      console.error(`${req.method} ${req.url} failed:`, error)
      fail(res, error instanceof TypeError || error instanceof RangeError ? 400 : 500, error instanceof Error ? error.message : 'Internal error')
    })
  })
  await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(options.port ?? 0, '127.0.0.1', () => ok()) })
  const address = server.address()
  port = typeof address === 'object' && address ? address.port : 0
  return {
    server, port, sessionDir, url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => { try { rmSync(sessionDir, { recursive: true, force: true }) } catch { /* temp dir */ } ok() }) }),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '3101' } } })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error('workbench: --port must be 0..65535'); process.exit(1) }
  startWorkbench({ port }).then((bench) => {
    console.log(`W01 App 1 Workbench: ${bench.url}`)
    console.log(`session folder (uploads + outputs): ${bench.sessionDir}`)
  }, (error) => { console.error(`workbench: ${error instanceof Error ? error.message : error}`); process.exit(1) })
}
