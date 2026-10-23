#!/usr/bin/env node
/**
 * App 1 Workbench: a loopback-only web UI over the headless normalize core.
 * Run from editor/packages/builder (so tsx resolves):
 *   node --import tsx ../retarget/workbench/server.ts [--port 3101]
 * Uploads live in os.tmpdir()/w01-workbench/<session>/; nothing is written into the repo or next to user files.
 */
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadAsset, packGltf, stripGltfTextures } from '../cli/loadAsset.ts'
import { loadBobj } from '../cli/loadBobj.ts'
import { actionsGlb } from '../cli/minecraftBlockCharacters.ts'
import { decodeGlb, encodeGlb } from '../cli/glb.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { AnimationMixer, LoopOnce, Vector3 } from 'three'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'
import {
  buildPreset, DEFAULT_ARMATURE, describeSource, inspect, parseFamily, parseOptions, runPipeline, sha256, UserError,
  type RunFile, type RunOptions, type SourceRecord, type TargetRecord,
} from './pipeline.ts'
import { previewClips, previewModel, skinnedPreviewModel, steveFiles } from './steve.ts'
import {
  addDraftToCharacter, getAction, importPack, listCharacterActions, listLibraryCharacters, registerLibraryCharacter,
  resolveCharacter, resolveLibraryPath, setActionMetadata, translateActionName, formatBilingual,
} from '../../library/index.ts'
import { loadVerityModel, type VerityModel } from './verity.ts'

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

function bilingualActionName(name: string): { nameVi: string; displayName: string } {
  const nameVi = translateActionName(name).vi
  return { nameVi, displayName: formatBilingual(name, nameVi) }
}

/** `actionsGlb` normally emits the 17-bone playable anchor tree; library rig validation keeps all 20 BOBJ bones. */
function minecraft20LibraryGlb(root: ReturnType<typeof loadBobj> & { animations: any[] }): Uint8Array {
  let anchor: any
  root.traverse((object: any) => { if (object.isBone && object.name === 'anchor') anchor = object })
  if (!anchor) throw new Error('Minecraft20 armature has no anchor bone')
  anchor.name = '__library_anchor__'
  const changed: Array<{ track: any; name: string }> = []
  for (const clip of root.animations) for (const track of clip.tracks) if (track.name.startsWith('anchor.')) {
    changed.push({ track, name: track.name }); track.name = `__library_anchor__.${track.name.slice('anchor.'.length)}`
  }
  try {
    const decoded = decodeGlb(actionsGlb(root))
    for (const node of decoded.json.nodes ?? []) if (node.name === '__library_anchor__') node.name = 'anchor'
    return encodeGlb(decoded.json, decoded.bin)
  } finally {
    anchor.name = 'anchor'
    for (const item of changed) item.track.name = item.name
  }
}

async function measureMinecraft20Glb(glb: Uint8Array, reference: ReturnType<typeof loadBobj> & { animations: any[] }, bobjText: string) {
  const loaded = await loadAsset(glb, 'glb', { skeletonOnly: true })
  const sourceBones = new Map<string, any>(), loadedBones = new Map<string, any>()
  reference.traverse((object: any) => { if (object.isBone) sourceBones.set(object.name, object) })
  loaded.traverse((object: any) => { if (object.isBone) loadedBones.set(object.name, object) })
  if (loadedBones.size !== 20 || sourceBones.size !== 20) throw new Error(`Minecraft20 library GLB must have 20 joints (source ${sourceBones.size}, reload ${loadedBones.size})`)
  if (loaded.animations.length !== reference.animations.length) throw new Error('Minecraft20 library GLB lost animations on reload')
  const armature = parseBobjArmature(readFileSync(DEFAULT_ARMATURE, 'utf8')), actions = parseBobjActions(bobjText)
  let maxTrackError = 0, maxEndpointPositionError = 0, sampledEndpoints = 0
  for (let index = 0; index < reference.animations.length; index++) {
    const expected = reference.animations[index]!, actual = loaded.animations[index]!
    if (actual.name !== expected.name || actual.tracks.length !== expected.tracks.length) throw new Error(`Minecraft20 animation ${index} changed tracks on reload`)
    const actualTracks = new Map(actual.tracks.map((track: any) => [track.name, track]))
    for (const track of expected.tracks) {
      const other: any = actualTracks.get(track.name)
      if (!other || other.times.length !== track.times.length || other.values.length !== track.values.length) throw new Error(`Minecraft20 track changed shape: ${track.name}`)
      for (let i = 0; i < track.times.length; i++) maxTrackError = Math.max(maxTrackError, Math.abs(track.times[i]! - other.times[i]!))
      for (let i = 0; i < track.values.length; i++) maxTrackError = Math.max(maxTrackError, Math.abs(track.values[i]! - other.values[i]!))
    }
    const sourceMixer = new AnimationMixer(reference), loadedMixer = new AnimationMixer(loaded)
    const sourceAction = sourceMixer.clipAction(expected), loadedAction = loadedMixer.clipAction(actual)
    sourceAction.clampWhenFinished = true; loadedAction.clampWhenFinished = true
    sourceAction.setLoop(LoopOnce, 1).play(); loadedAction.setLoop(LoopOnce, 1).play()
    for (const time of [0, expected.duration / 2, expected.duration]) {
      sourceMixer.setTime(time); loadedMixer.setTime(time); reference.updateMatrixWorld(true); loaded.updateMatrixWorld(true); sampledEndpoints++
      const evaluated = new Map(evaluateBobjAction(armature, actions.get(expected.name)!, time * 20).map((bone) => [bone.name.replace(/\./g, '_'), bone.worldMatrix]))
      for (const [name] of sourceBones) {
        const target = loadedBones.get(name)
        if (!target) throw new Error(`Minecraft20 reload is missing joint ${name}`)
        maxEndpointPositionError = Math.max(maxEndpointPositionError,
          new Vector3().fromArray(evaluated.get(name)!.slice(12, 15)).distanceTo(new Vector3().setFromMatrixPosition(target.matrixWorld)))
      }
    }
    sourceMixer.uncacheRoot(reference); loadedMixer.uncacheRoot(loaded)
  }
  const status = maxTrackError <= 1e-6 && maxEndpointPositionError <= 1e-4 ? 'PASS' : 'FAIL'
  return { status, joints: loadedBones.size, animations: loaded.animations.length, sampledEndpoints, maxTrackError, maxEndpointPositionError }
}

function selectGlbAnimation(glb: Uint8Array, index: number): Uint8Array {
  const decoded = decodeGlb(glb), animations = decoded.json.animations as unknown[] | undefined
  if (!animations?.[index]) throw new UserError(`Normalized GLB has no animation ${index}`)
  decoded.json.animations = [animations[index]]
  return encodeGlb(decoded.json, decoded.bin)
}

function selectBobjActions(text: string, names: Set<string>): string {
  const lines = text.split(/(?=^an\s+)/m), prefix = lines.shift() ?? ''
  const selected = lines.filter((block) => names.has(block.match(/^an\s+([^\r\n]+)/)?.[1]?.trim() ?? ''))
  if (selected.length !== names.size) throw new Error('Minecraft20 BOBJ does not contain every selected Action')
  return prefix + selected.join('')
}

export interface Workbench { server: Server; url: string; port: number; sessionDir: string; close(): Promise<void> }

/** `three` resolved the same way the retarget package does, so the browser and the CLI use one version. */
function threeRoot(): string {
  const require = createRequire(resolve(here, '../package.json'))
  return dirname(dirname(require.resolve('three'))) // .../three/build/three.cjs -> .../three (package.json is not an exported subpath)
}

type RunState = { id: string; state: 'running' | 'done' | 'error' | 'CANCELLED'; controller: AbortController; stage: string; done: number; total: number; startedAt: number; elapsedMs: number; dir: string
  result?: { runId: string; status: string; report: Record<string, any>; manifest: unknown; files: Array<RunFile & { url: string }> }; error?: string }
type BatchEntry = { sourceId: string | null; name: string; path?: string; sha256?: string; bytes?: number; status: 'queued' | 'inspecting' | 'ready' | 'duplicate' | 'error'; duplicateOf?: string; inLibrary?: boolean; inspect?: Record<string, any>; error?: string }
type BatchState = { id: string; state: 'running' | 'done' | 'cancelled'; stage: string; done: number; total: number; entries: BatchEntry[]; controller: AbortController }

export async function startWorkbench(options: { port?: number } = {}): Promise<Workbench> {
  const root = threeRoot()
  const sessionId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
  const sessionDir = join(tmpdir(), 'w01-workbench', sessionId)
  mkdirSync(join(sessionDir, 'uploads'), { recursive: true }); mkdirSync(join(sessionDir, 'runs'), { recursive: true })

  const sources = new Map<string, SourceRecord>()
  const runs = new Map<string, RunState>()
  const batches = new Map<string, BatchState>()
  const batchUploads = new Map<string, string>()
  const sourceByHash = new Map<string, string>()
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
      if (!(character.rig === 'mixamo65' || character.rig === 'verity') || !character.model.endsWith('.glb')) continue
      const path = join(root, 'characters', character.charId, character.model)
      if (!existsSync(path)) continue
      const measured = await measureTarget(path)
      // `original/model.bbs.bobj`: the character keeps its own skeleton; `model.glb` is only the Mixamo65 view for the solver.
      const original = join(root, 'characters', character.charId, 'original')
      targets.set(`lib-${character.charId}`, { id: `lib-${character.charId}`, file: basename(path), path, sha256: sha256(measured.bytes), hipsHeightMeters: measured.hipsHeightMeters, name: character.name, library: true,
        ...(existsSync(join(original, 'model.bbs.bobj')) ? { original } : {}) })
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
    if (!sourceByHash.has(record.sha256)) sourceByHash.set(record.sha256, id)
    return { sourceId: id, name: record.name, format: record.format, bytes: record.bytes, sha256: record.sha256, uploaded, path: uploaded ? undefined : path }
  }

  const collectSources = (input: unknown): string[] => {
    if (!Array.isArray(input) || !input.length) throw new UserError('Choose one or more files or a folder path')
    const paths: string[] = []
    const visit = (path: string) => {
      if (!existsSync(path)) throw new UserError(`File or folder not found: ${path}`)
      const stat = statSync(path)
      if (stat.isFile()) {
        if (SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) paths.push(path)
      } else if (stat.isDirectory()) {
        for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const child = join(path, item.name)
          if (item.isDirectory()) visit(child)
          else if (item.isFile() && SOURCE_EXTENSIONS.has(extname(item.name).toLowerCase())) paths.push(child)
        }
      }
      if (paths.length > 2000) throw new UserError('A batch can contain at most 2000 supported files', 413)
    }
    for (const value of input) {
      if (typeof value !== 'string' || !value.trim()) throw new UserError('Batch paths must be non-empty strings')
      visit(resolve(value.trim().replace(/^"(.*)"$/, '$1')))
    }
    if (!paths.length) throw new UserError('No .glb, .gltf, .fbx, or .bobj files were found')
    if (paths.length > 2000) throw new UserError('A batch can contain at most 2000 supported files', 413)
    return paths
  }

  const batchView = (batch: BatchState) => ({ batchId: batch.id, state: batch.state, stage: batch.stage, done: batch.done, total: batch.total,
    entries: batch.entries.map((entry) => ({ ...entry })) })
  const libraryHasSourceHash = (hash: string) => {
    try {
      const packs = join(resolveLibraryPath(), 'packs')
      if (!existsSync(packs)) return false
      return readdirSync(packs, { withFileTypes: true }).some((item) => {
        if (!item.isDirectory()) return false
        try { return JSON.parse(readFileSync(join(packs, item.name, 'meta.json'), 'utf8')).source?.sha256 === hash } catch { return false }
      })
    } catch { return false }
  }
  function startBatch(inputs: Array<{ path?: string; sourceId?: string; uploaded?: boolean }>, target: TargetRecord, options: RunOptions, preset: unknown, presetFamily?: import('../cli/autoMapping.ts').SourceFamily): BatchState {
    if (inputs.length > 2000) throw new UserError('A batch can contain at most 2000 files', 413)
    const id = randomBytes(6).toString('hex')
    const state: BatchState = { id, state: 'running', stage: 'queued', done: 0, total: inputs.length, entries: inputs.map((item) => ({ sourceId: item.sourceId ?? null, name: item.path ? basename(item.path) : 'Source', ...(item.path ? { path: item.path } : {}), status: 'queued' })), controller: new AbortController() }
    batches.set(id, state)
    void (async () => {
      for (const [index, input] of inputs.entries()) {
        if (state.controller.signal.aborted) { state.state = 'cancelled'; state.stage = 'cancelled'; break }
        const entry = state.entries[index]!
        try {
          state.stage = `inspect ${index + 1}/${inputs.length}`; entry.status = 'inspecting'
          const existingId = input.sourceId ? sourceByHash.get(getSource(input.sourceId).sha256) : sourceByHash.get(sha256(readFileSync(input.path!)))
          const sourceId = input.sourceId ?? registerSource(input.path!, basename(input.path!), input.uploaded === true, extname(input.path!).toLowerCase() === '.bobj' ? DEFAULT_ARMATURE : undefined).sourceId
          const source = getSource(sourceId)
          entry.sourceId = sourceId; entry.name = source.name; entry.path = source.uploaded ? undefined : source.path; entry.sha256 = source.sha256; entry.bytes = source.bytes
          entry.inLibrary = libraryHasSourceHash(source.sha256)
          entry.inspect = await inspect(source, target, options, preset, presetFamily)
          const mixamo = entry.inspect.mapping?.family === 'mixamo'
          const fileName = mixamo ? basename(source.name, extname(source.name)).replace(/[_-]+/g, ' ').trim() : ''
          entry.inspect.actions = entry.inspect.actions.flatMap((action: any) => {
            const sourceName = action.name
            // Mixamo's downloaded FBX often names its sole animation `mixamo.com`.
            // Keep that source name for provenance while using the file name for the library/output name.
            const displayName = mixamo && /^mixamo\.com$/i.test(sourceName) && fileName ? fileName : sourceName
            const names = bilingualActionName(displayName)
            return Number.isFinite(action.durationSeconds) && action.durationSeconds > 0
              ? [{ ...action, name: displayName, sourceName, ...names }]
              : []
          })
          if (entry.inspect.blocker) { entry.status = 'error'; entry.error = entry.inspect.blocker.message }
          else if (!entry.inspect.actions.length) { entry.status = 'error'; entry.error = 'File không có animation có thời lượng lớn hơn 0' }
          else if (entry.inLibrary || (existingId && existingId !== sourceId)) { entry.status = 'duplicate'; entry.duplicateOf = existingId }
          else entry.status = 'ready'
        } catch (error) { entry.status = 'error'; entry.error = error instanceof Error ? error.message : String(error) }
        state.done = index + 1
        await new Promise<void>((ok) => setImmediate(ok))
      }
      if (state.state === 'running') state.state = 'done'
      state.stage = state.state
    })()
    return state
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

  async function handleBatchFile(req: IncomingMessage, res: ServerResponse, uploadId: string) {
    const base = batchUploads.get(uploadId)
    if (!base) return fail(res, 404, 'Unknown batch upload')
    const relativePath = String(req.headers['x-file-path'] ?? '')
    const destination = inside(base, relativePath)
    if (!destination) throw new UserError('Batch file path must stay inside the selected folder')
    const length = Number(req.headers['content-length'] ?? 0)
    if (length > MAX_UPLOAD_BYTES) throw new UserError('File is larger than 512 MB', 413)
    mkdirSync(dirname(destination), { recursive: true })
    if (existsSync(destination)) throw new UserError(`Duplicate path in selected folder: ${relativePath}`)
    await new Promise<void>((ok, bad) => {
      const out = createWriteStream(destination)
      let size = 0
      req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_UPLOAD_BYTES) { bad(new UserError('File is larger than 512 MB', 413)); req.destroy(); out.destroy() } })
      req.on('error', bad); out.on('error', bad); out.on('finish', () => ok()); req.pipe(out)
    })
    if (!statSync(destination).size) throw new UserError('Uploaded file is empty')
    return json(res, 201, { path: relative(base, destination).split(sep).join('/') })
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
    let match: RegExpMatchArray | null
    if (method === 'GET' && path === '/api/workspace-navigation') return json(res, 200, {
      studioUrl: process.env.W01_STUDIO_URL ?? null,
      animationUrl: process.env.W01_ANIMATION_STUDIO_URL ?? null,
      vfxUrl: process.env.W01_VFX_URL ?? null,
    })
    if (method === 'GET' && path === '/api/targets') return json(res, 200, { targets: [...targets.values()].map(targetView), mc20: [...mc20.values()].map(({ id, name }) => ({ id, name })) })
    if (method === 'GET' && path === '/api/library/characters') {
      const characters = listLibraryCharacters().map((character) => {
        const actions = listCharacterActions({ charId: character.charId, latestOnly: true })
        const counts = { draft: 0, edited: 0, approved: 0 }
        for (const action of actions) if (action.status) counts[action.status]++
        return { charId: character.charId, name: character.name, rig: character.rig, requiredActions: character.requiredActions ?? [], counts }
      })
      return json(res, 200, { characters })
    }
    if (method === 'POST' && path === '/api/batch-uploads') {
      const uploadId = randomBytes(8).toString('hex'), base = join(sessionDir, 'uploads', `batch-${uploadId}`)
      mkdirSync(base, { recursive: true }); batchUploads.set(uploadId, base)
      return json(res, 201, { uploadId })
    }
    if (method === 'POST' && (match = path.match(/^\/api\/batch-uploads\/(\w+)$/))) return handleBatchFile(req, res, match[1]!)
    if (method === 'POST' && path === '/api/batches') {
      const body = await readJson(req)
      const target = getTarget(body.targetId)
      const inputs: Array<{ path?: string; sourceId?: string }> = []
      if (Array.isArray(body.paths)) inputs.push(...collectSources(body.paths).map((path) => ({ path })))
      if (Array.isArray(body.sourceIds)) {
        if (body.sourceIds.some((id: unknown) => typeof id !== 'string')) throw new UserError('sourceIds must contain source IDs')
        inputs.push(...body.sourceIds.map((sourceId: string) => ({ sourceId })))
      }
      if (typeof body.uploadId === 'string') {
        const base = batchUploads.get(body.uploadId)
        if (!base) throw new UserError('Unknown batch upload', 404)
        inputs.push(...collectSources([base]).map((path) => ({ path, uploaded: true })))
      }
      if (!inputs.length) throw new UserError('Choose one or more files or a folder path')
      if (inputs.length > 2000) throw new UserError('A batch can contain at most 2000 supported files', 413)
      const state = startBatch(inputs, target, parseOptions(body.options), body.mappingPreset ?? null, parseFamily(body.presetFamily))
      return json(res, 202, batchView(state))
    }
    if (method === 'GET' && (match = path.match(/^\/api\/batches\/(\w+)$/))) {
      const batch = batches.get(match[1]!)
      if (!batch) return fail(res, 404, 'Unknown batchId')
      return json(res, 200, batchView(batch))
    }
    if (method === 'POST' && (match = path.match(/^\/api\/batches\/(\w+)\/cancel$/))) {
      const batch = batches.get(match[1]!)
      if (!batch) return fail(res, 404, 'Unknown batchId')
      if (batch.state === 'running') batch.controller.abort()
      return json(res, 202, batchView(batch))
    }
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
      const result = await inspect(getSource(body.sourceId), getTarget(body.targetId), parseOptions(body.options), body.mappingPreset ?? null, parseFamily(body.presetFamily))
      return json(res, 200, { ...result, actions: result.actions.map((action) => ({ ...action, ...bilingualActionName(action.name) })) })
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
      const categories = ['other', 'idle', 'locomotion', 'combat', 'emote', 'dance', 'gesture', 'interaction', 'hurt-fall', 'sit-lie', 'pose'] as const
      if (typeof body.category === 'string' && !categories.includes(body.category as typeof categories[number])) throw new UserError('Unknown library category')
      const selectedActions = Array.isArray(body.actions) ? body.actions : []
      const manifestUuids = new Set(((state.result.manifest as any)?.actions ?? []).map((action: any) => action.uuid))
      const seen = new Set<string>()
      for (const selection of selectedActions) {
        if (!selection || typeof selection.uuid !== 'string' || !manifestUuids.has(selection.uuid) || typeof selection.key !== 'string' || !selection.key.trim()) throw new UserError('Each shared Action tag requires a run UUID and a non-empty key')
        if (selection.name !== undefined && (typeof selection.name !== 'string' || !selection.name.trim())) throw new UserError('A shared Action name must be non-empty text')
        if (selection.nameVi !== undefined && typeof selection.nameVi !== 'string') throw new UserError('A shared Action Vietnamese name must be text')
        if (selection.sourceName !== undefined && typeof selection.sourceName !== 'string') throw new UserError('A shared Action source name must be text')
        if (seen.has(selection.uuid)) throw new UserError('A shared Action can only be tagged once')
        seen.add(selection.uuid)
      }
      const pack = importPack({ sourceDirectory: state.dir, createdBy: 'app1',
        ...(typeof body.category === 'string' ? { category: body.category as typeof categories[number] } : {}),
        ...(Array.isArray(body.tags) ? { tags: body.tags.filter((tag: unknown): tag is string => typeof tag === 'string') } : {}),
        ...(body.license && typeof body.license === 'object' && typeof body.license.id === 'string' && typeof body.license.commitable === 'boolean' ? { license: body.license } : {}) })
      for (const selection of selectedActions) {
        if (!pack.metadata.actions.some((action) => action.uuid === selection.uuid)) throw new UserError(`Shared pack is missing Action ${selection.uuid}`, 409)
        const existing = getAction({ actionUuid: selection.uuid })
        setActionMetadata({ actionUuid: selection.uuid, ...(typeof selection.name === 'string' ? { name: selection.name.trim() } : {}), ...(typeof selection.nameVi === 'string' ? { nameVi: selection.nameVi.trim() } : {}), ...(typeof selection.sourceName === 'string' ? { sourceName: selection.sourceName.trim() } : {}), tags: [...new Set([...existing.tags, selection.key.trim()])] })
      }
      return json(res, 200, { packId: pack.packId, rig: pack.rig, actions: pack.actions, created: pack.created,
        actionUuids: pack.metadata.actions.map((action) => action.uuid) })
    }
    if (method === 'POST' && (match = path.match(/^\/api\/runs\/(\w+)\/character-library$/))) {
      const state = runs.get(match[1]!)
      if (!state || state.state !== 'done' || !state.result) return fail(res, 404, 'Unknown or unfinished runId')
      if (state.result.status !== 'PASS') return fail(res, 409, `Only a PASS run can go to the library (this run is ${state.result.status})`)
      const body = await readJson(req)
      const charIds = Array.isArray(body.charIds) ? [...new Set(body.charIds.filter((value: unknown): value is string => typeof value === 'string' && !!value))] : []
      const selections = Array.isArray(body.actions) ? body.actions : []
      if (!charIds.length) throw new UserError('Choose at least one destination character')
      if (!selections.length) throw new UserError('Choose at least one Action')
      const byUuid = new Map((state.result.manifest as any)?.actions?.map((action: any) => [action.uuid, action]) ?? [])
      const selected = selections.map((selection: any) => {
        if (!selection || typeof selection.uuid !== 'string' || !byUuid.has(selection.uuid) || typeof selection.key !== 'string' || !selection.key.trim()) {
          throw new UserError('Each selected Action requires a run UUID and a requiredActions.key tag')
        }
        return { uuid: selection.uuid, key: selection.key.trim(), ...(typeof selection.name === 'string' ? { name: selection.name.trim() } : {}), ...(typeof selection.nameVi === 'string' ? { nameVi: selection.nameVi.trim() } : {}), ...(typeof selection.sourceName === 'string' ? { sourceName: selection.sourceName.trim() } : {}) }
      })
      if (new Set(selected.map((item) => item.uuid)).size !== selected.length) throw new UserError('An Action can only be selected once')
      const characters = new Map(listLibraryCharacters().map((character) => [character.charId, character]))
      for (const charId of charIds) {
        const character = characters.get(charId)
        if (!character) throw new UserError(`Unknown library character: ${charId}`, 404)
        const allowed = new Set((character.requiredActions ?? []).map((action) => action.key))
        const invalid = selected.find((action) => !allowed.has(action.key))
        if (invalid) throw new UserError(`Character ${character.name} does not require Action key: ${invalid.key}`)
      }
      const selectedCharacters = charIds.map((charId) => characters.get(charId)!)
      const isOriginalCharacter = (character: any) => character.rig === 'verity' || existsSync(join(resolveLibraryPath(), 'characters', character.charId, 'original', 'model.bbs.bobj'))
      const supportedRigs = new Set(['mixamo65', 'verity', 'minecraft20'])
      const unsupported = selectedCharacters.find((character) => !supportedRigs.has(character.rig))
      if (unsupported) throw new UserError(`Character ${unsupported.name} has unsupported rig ${unsupported.rig}`, 409)
      const needsMixamo = selectedCharacters.some((character) => character.rig !== 'minecraft20')
      const needsMinecraft = selectedCharacters.some((character) => character.rig === 'minecraft20')
      const normalizedFile = state.result.files.find((file) => file.kind === 'glb')
      if (!normalizedFile) throw new UserError('Run has no normalized GLB', 409)
      const normalizedGlb = readFileSync(join(state.dir, normalizedFile.name))
      // Resolve and parse every destination before importing or creating any draft. A bad mixed selection leaves no partial drafts.
      const verityModels = new Map<string, { resolved: ReturnType<typeof resolveCharacter>; model: VerityModel }>()
      for (const character of selectedCharacters) if (isOriginalCharacter(character)) {
        const resolved = resolveCharacter(character.charId)
        const originalBobj = join(resolveLibraryPath(), 'characters', character.charId, 'original', 'model.bbs.bobj')
        const modelPath = resolved.modelPath.endsWith('.bobj') ? resolved.modelPath : originalBobj
        if (!existsSync(modelPath)) throw new UserError(`Verity character ${character.name} has no original .bobj model`, 409)
        try { verityModels.set(character.charId, { resolved: { ...resolved, modelPath }, model: loadVerityModel(modelPath) }) }
        catch (error) { throw new UserError(`Cannot load original Verity model for ${character.name}: ${error instanceof Error ? error.message : error}`, 409) }
      }
      const verityArtifacts = new Map<string, { bobj: string; glb: Uint8Array }>()
      for (const action of selected) for (const character of selectedCharacters) if (isOriginalCharacter(character)) {
        const sourceIndex = ((state.result.manifest as any).actions ?? []).findIndex((candidate: any) => candidate.uuid === action.uuid)
        const entry = byUuid.get(action.uuid) as any, selectedGlb = selectGlbAnimation(normalizedGlb, entry.glbAnimationIndex ?? sourceIndex)
        const destination = verityModels.get(character.charId)!, added = await destination.model.convertNormalized(selectedGlb)
        const bobj = destination.model.appendBobj(added), error = destination.model.roundTripError(bobj, added)
        if (added.length !== 1 || error > 1e-4) throw new UserError(`Verity conversion failed for ${character.name}`, 409)
        verityArtifacts.set(`${character.charId}:${action.uuid}`, { bobj, glb: destination.model.buildGlb(added, dirname(destination.resolved.modelPath)) })
      }
      let mixamoPack: ReturnType<typeof importPack> | null = null
      let minecraftPack: ReturnType<typeof importPack> | null = null
      let minecraftBobj = ''
      if (needsMinecraft) {
        const bobj = state.result.files.find((file) => file.kind === 'bobj')
        if (!bobj) throw new UserError('Minecraft20 destinations require a run with .bobj output enabled', 409)
        const directory = join(state.dir, 'library-minecraft20'), stem = 'minecraft20'
        mkdirSync(directory, { recursive: true })
        const bobjText = readFileSync(join(state.dir, bobj.name), 'utf8'); minecraftBobj = bobjText
        const root = loadBobj(bobjText, readFileSync(DEFAULT_ARMATURE, 'utf8')) as ReturnType<typeof loadBobj> & { animations: any[] }
        root.updateMatrixWorld(true)
        const glb = minecraft20LibraryGlb(root), manifestActions = (state.result.manifest as any).actions ?? []
        const measurement = await measureMinecraft20Glb(glb, root, bobjText)
        if (measurement.status !== 'PASS' || state.result.report.minecraft20?.status !== 'PASS') throw new UserError('Minecraft20 library artifact failed round-trip validation', 409)
        writeFileSync(join(directory, `${stem}.glb`), glb)
        writeFileSync(join(directory, `${stem}.minecraft20.bobj`), bobjText)
        const stableUuid = (uuid: string) => {
          const hex = createHash('sha256').update(`minecraft20:${uuid}`).digest('hex').slice(0, 32).split('')
          hex[12] = '4'; hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16)
          return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
        }
        writeFileSync(join(directory, `${stem}.manifest.json`), JSON.stringify({
          ...(state.result.manifest as any), version: '1.0.0', rig: 'minecraft20', glbSha256: sha256(glb),
          actions: manifestActions.map((action: any, index: number) => ({ ...action, uuid: stableUuid(action.uuid), glbAnimationIndex: index })),
        }, null, 2))
        writeFileSync(join(directory, `${stem}.report.json`), JSON.stringify({ status: 'PASS', sourceRunId: state.id, artifact: 'minecraft20', sourceBobjStatus: state.result.report.minecraft20.status, serializerRoundTrip: measurement }, null, 2))
        minecraftPack = importPack({ sourceDirectory: directory, createdBy: 'app1' })
      }
      mixamoPack = needsMixamo ? importPack({ sourceDirectory: state.dir, createdBy: 'app1' }) : null
      const minecraftNames = new Map<string, string>()
      if (needsMinecraft) for (const action of selected) {
        const manifestAction = byUuid.get(action.uuid) as any
        const bobjName = state.result.report.minecraft20.actions.find((item: any) => item.glbName === manifestAction.name)?.name
        if (!bobjName) throw new UserError(`Minecraft20 output has no Action for ${manifestAction.name}`, 409)
        minecraftNames.set(action.uuid, bobjName)
      }
      const drafts: Array<{ charId: string; actionUuid: string; packId: string; key: string }> = []
      for (const action of selected) {
        for (const charId of charIds) {
          const character = characters.get(charId)!
          const pack = character.rig === 'minecraft20' ? minecraftPack! : mixamoPack!
          const sourceIndex = ((state.result.manifest as any).actions ?? []).findIndex((candidate: any) => candidate.uuid === action.uuid)
          const source = pack.metadata.actions.find((candidate) => candidate.glbAnimationIndex === sourceIndex)
          if (!source) throw new UserError(`Selected Action is not in the ${character.rig} pack: ${action.uuid}`)
          const existing = getAction({ actionUuid: source.uuid })
          const normalizedTags = mixamoPack ? getAction({ actionUuid: action.uuid }).tags : []
          setActionMetadata({ actionUuid: source.uuid, ...(action.name ? { name: action.name } : {}), ...(action.nameVi ? { nameVi: action.nameVi } : {}), ...(action.sourceName ? { sourceName: action.sourceName } : {}), tags: [...new Set([...existing.tags, ...normalizedTags, action.key])] })
          const draft = addDraftToCharacter({ charId, actionUuid: source.uuid })
          const draftPath = join(resolveLibraryPath(), 'packs', draft.packId)
          if (character.rig === 'minecraft20') {
            writeFileSync(join(draftPath, 'anim.bobj'), selectBobjActions(minecraftBobj, new Set([minecraftNames.get(action.uuid)!])))
          }
          if (isOriginalCharacter(character)) {
            const artifact = verityArtifacts.get(`${charId}:${action.uuid}`)!
            writeFileSync(join(draftPath, 'anim.original.bbs.bobj'), artifact.bobj)
            writeFileSync(join(draftPath, 'anim.original.glb'), artifact.glb)
          }
          drafts.push({ charId, actionUuid: draft.uuid, packId: draft.packId, key: action.key })
        }
      }
      return json(res, 200, { packId: mixamoPack?.packId ?? minecraftPack?.packId, drafts })
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
