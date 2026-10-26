import { validateFilmEffectsDestination } from './filmEffectsDestination'
import { collectFilmAaaAssets, writeFilmAaaAssets } from './filmAaaAssets'
import { filmSceneWorldMatrices } from './filmSceneWorld'
import { Matrix4 } from 'three'
import { applyFilmWorldAnchor, resolveFilmWorldAnchor } from './filmWorldAnchor'
import { stageSceneConversion, type SceneConversionArgs } from './sceneConversion'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { parseBobjActions, parseBobjArmature } from '@bbs/retarget'
import path from 'node:path'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { renderFrames } from '@topview/3d-director-cli/render.mjs'
import { resolveUnifiedAssetFile } from './unifiedAssetFiles'
import { FILM_MODEL_FACING_OFFSET, inspectFilmActorTransform, buildFilmExportManifest, type ConvertedFilmModelProfile } from './filmManifest'
import { preflightProjectFilm, sampleProjectFilm, type FilmSamplingArgs } from './unifiedFilmSampling'
import { stageProjectNormalization, type NormalizationPlanArgs } from './unifiedNormalizationPlan'
import { stageProjectAssignment, type AssignmentArgs } from './unifiedAssignment'
import { FILM_SERIES_ARCHIVE_SCRIPT, type FilmSeriesSegment } from './filmSeries'
import { resolveFilmEffectsPolicy, filmRequiredMods, filmEffectsForExport } from './filmEffectsPolicy'
import { buildVfxEffectsForFilm, readVfxCueExtension } from './vfxCues'
import { listVfxPreviews, readVfxSheetImage } from './vfxPreviews'
import { filmAudioPackage } from './audioMix'
import { getAction, resolveCharacter } from '../../../packages/library/index'
import { resolveLibraryPath } from '../../../packages/library/index'
import { bobjModelToGlb, buildBobjModel, parseBobjModel } from '../../../packages/retarget/src/bobjModel'
import { LIBRARY_GLB_OPTIONS } from './libraryModels'

export type UnifiedJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

interface StoredFile { id: string; name: string; mimeType: string; sizeBytes: number; sha256: string; path: string }
interface StoredJob {
  jobId: string
  projectId: string
  type: 'scene.export.blend-fbx' | 'scene.export.glb' | 'shot.export' | 'app3.export' | 'scene.render' | 'film.export' | 'film.series.export' | 'rig.normalization.run' | 'animation.assignment.run'
  state: UnifiedJobState
  sourceRevision: number
  sourceSha256: string
  progress: number
  createdAt: string
  updatedAt: string
  result?: { files: StoredFile[]; provenance: Record<string, unknown>; warnings: string[]; blockedRequests: string[] }
  error?: { code: string; message: string }
}

export interface UnifiedJobView extends Omit<StoredJob, 'result'> {
  result?: Omit<NonNullable<StoredJob['result']>, 'files'> & { files: Omit<StoredFile, 'path'>[] }
}

interface RenderArgs { frames: number[]; cameraNodeIds: string[]; width: number; height: number; silhouette?: boolean; bbsLook?: boolean }
interface FilmExportArgs extends FilmSamplingArgs { filmName: string }
/** Scene-level packaging on top of `film.export` (`scene.export.bbsFilm`): archive name and extra JSON files in the ZIP root. */
export interface FilmPackageOptions { archiveName?: string; extraFiles?: Record<string, unknown> }
interface Runtime { record: StoredJob; controller: AbortController; active: boolean; internal?: boolean; done?: Promise<void> }
type JobGlobal = typeof globalThis & { __bbsUnifiedJobs?: Map<string, Runtime> }
const runtimes = (globalThis as JobGlobal).__bbsUnifiedJobs ??= new Map()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_RETAINED_JOBS = 10
const MAX_COMMAND_OUTPUT = 8 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 15 * 60 * 1000
const ZIP_SCRIPT = 'import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]).resolve(strict=True); out=pathlib.Path(sys.argv[2]); files=list(root.rglob("*")); assert files and all(not p.is_symlink() for p in files); z=zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED); [z.write(p,p.relative_to(root).as_posix()) for p in files if p.is_file()]; z.close()'

type FilmManifest = ReturnType<typeof buildFilmExportManifest>

interface LibraryTextureRef { object: string; path: string; sha256: string }

export function selectOriginalBobj(base: Buffer, appended?: Buffer): Buffer {
  if (!appended) return base
  if (appended.length < base.length || !appended.subarray(0, base.length).equals(base)) throw new TypeError('Original action BOBJ changed its source prefix')
  return appended
}

export function mergeOriginalBobjActions(base: Buffer, sidecars: readonly Buffer[]): Buffer {
  const known = new Set(parseBobjActions(base.toString('utf8')).keys())
  const chunks = [base]
  const appended = new Map<string, string>()
  for (const sidecar of sidecars) {
    selectOriginalBobj(base, sidecar)
    const suffix = sidecar.subarray(base.length).toString('utf8')
    const starts = [...suffix.matchAll(/^an\s+(.+)$/gm)]
    for (const [index, match] of starts.entries()) {
      const name = match[1]!.replace(/\r$/, '')
      const start = match.index!, end = starts[index + 1]?.index ?? suffix.length
      const block = suffix.slice(start, end)
      if (known.has(name)) {
        if (appended.get(name) !== block) throw new TypeError(`Original Character actions conflict: ${name}`)
        continue
      }
      known.add(name); appended.set(name, block)
      if (chunks[chunks.length - 1]!.at(-1) !== 10) chunks.push(Buffer.from('\n'))
      chunks.push(Buffer.from(block, 'utf8'))
    }
  }
  return Buffer.concat(chunks)
}

/** Stage an original library BOBJ once per Character skin, without a Blender round trip. */
export async function stageOriginalLibraryBobjProfile(snapshot: UnifiedProject, model: FilmInputModel, folder: string): Promise<ConvertedFilmModelProfile | null> {
  const node = snapshot.scene.content.nodes.find((item) => item.id === model.nodeId)
  const metadata = node?.metadata as Record<string, unknown> | undefined
  if (!metadata || typeof metadata.libraryCharacterId !== 'string') return null
  const resolved = await resolveUnifiedAssetFile(snapshot, model.assetId, 'source')
  if (digest(resolved.bytes) !== model.source.sha256) throw new TypeError(`Character ${model.characterId} source hash changed during Film export`)
  const root = resolveLibraryPath()
  const character = resolveCharacter({ root, charId: metadata.libraryCharacterId })
  if (character.baseModel?.format !== 'bobj') return null
  const baseBytes = await readFile(character.modelPath)
  if (digest(baseBytes) !== character.baseModel.sha256) throw new TypeError(`Character ${model.characterId} original BOBJ hash changed`)
  let bobj = baseBytes.toString('utf8')
  try { parseBobjArmature(bobj) }
  catch { throw new TypeError(`Character ${model.characterId} has an invalid original BOBJ`) }
  const actionUuids = [...new Set(snapshot.scene.content.timeline.animation.motionClips
    .filter((clip) => clip.target.nodeId === model.nodeId && snapshot.motions[clip.motion.assetId])
    .map((clip) => snapshot.motions[clip.motion.assetId]!.id))]
  if (!actionUuids.length && typeof metadata.libraryDefaultAction === 'string') actionUuids.push(metadata.libraryDefaultAction)
  const sidecars: Buffer[] = []
  const nativeNames = [...parseBobjActions(bobj).keys()]
  let nativeGlbHashes: string[] | undefined
  for (const actionUuid of actionUuids) {
    const motion = snapshot.motions[actionUuid]
    if (motion?.assetId === model.assetId) {
      // L3 imports the complete authoritative base GLB, including its native clips.
      // UUIDs alone and matching names do not prove that a project motion is native.
      nativeGlbHashes ??= [LIBRARY_GLB_OPTIONS, { faceForward: false }].map((options) => digest(Buffer.from(bobjModelToGlb(parseBobjModel(bobj), options).bytes)))
      const motionMetadata = snapshot.extensions?.retargetMotionMetadata?.[actionUuid] as { name?: unknown; clipIndex?: unknown } | undefined
      const index = motionMetadata?.clipIndex
      const clips = snapshot.scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === model.nodeId && clip.motion.assetId === actionUuid)
      if (motion.edit !== null || motion.derivedFrom !== null || !nativeGlbHashes.includes(motion.sourceClip.sha256) || !nativeGlbHashes.includes(model.source.sha256) ||
          typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= nativeNames.length ||
          motionMetadata?.name !== nativeNames[index] || clips.some((clip) => clip.motion.clipIndex !== index)) {
        throw new TypeError(`Character ${model.characterId} native action identity does not match its original BOBJ: ${actionUuid}`)
      }
      continue
    }
    let selected
    try { selected = getAction({ root, actionUuid }) } catch { throw new TypeError(`Character ${model.characterId} action is missing from the library: ${actionUuid}`) }
    const sidecar = path.join(path.dirname(selected.glbPath), 'anim.original.bbs.bobj')
    try { sidecars.push(await readFile(sidecar)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (character.baseModel.rig === 'verity') throw new TypeError(`Character ${model.characterId} action lacks its original-rig BOBJ: ${actionUuid}`) }
  }
  if (sidecars.length) bobj = mergeOriginalBobjActions(baseBytes, sidecars).toString('utf8')
  const refs = Array.isArray(metadata.librarySkin) ? metadata.librarySkin as LibraryTextureRef[] : []
  const hidden = new Set(Array.isArray(metadata.libraryHiddenObjects) ? metadata.libraryHiddenObjects.filter((item): item is string => typeof item === 'string') : [])
  const parsedModel = parseBobjModel(bobj)
  const modelReport = buildBobjModel(parsedModel).report
  const objects = modelReport.objects
  const byObject = new Map(refs.map((item) => [item.object, item]))
  const helpers = new Set(modelReport.helperObjects)
  const missing = objects.filter((object) => !hidden.has(object) && !helpers.has(object) && !byObject.has(object))
  if (missing.length) throw new TypeError(`Character ${model.characterId} is missing visible textures: ${missing.join(', ')}`)
  await mkdir(folder, { recursive: true })
  const bobjBytes = Buffer.from(bobj, 'utf8'), bobjSha = digest(bobjBytes)
  const bobjPath = path.join(folder, 'model.bobj'); await writeFile(bobjPath, bobjBytes, { flag: 'wx' })
  const files: ConvertedFilmModelProfile['files'] = [{ sourcePath: bobjPath, targetPath: 'model.bobj', sha256: bobjSha }]
  for (const ref of refs) {
    if (hidden.has(ref.object)) continue
    if (!objects.includes(ref.object) || !/^[a-f0-9]{64}$/.test(ref.sha256) || !/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$)).+$/.test(ref.path)) throw new TypeError(`Character ${model.characterId} has an invalid texture reference: ${ref.object}`)
    const candidate = path.resolve(root, ...ref.path.split('/')), actualRoot = await realpath(root), actual = await realpath(candidate)
    if (!actual.startsWith(`${actualRoot}${path.sep}`)) throw new TypeError(`Character ${model.characterId} texture escaped the library root`)
    const bytes = await readFile(actual)
    if (digest(bytes) !== ref.sha256) throw new TypeError(`Character ${model.characterId} texture hash changed: ${ref.object}`)
    files.push({ sourcePath: actual, targetPath: `textures/${ref.object}/default.png`, sha256: ref.sha256 })
  }
  const armature = parseBobjArmature(bobj)
  const actionNames = [...parseBobjActions(bobj).keys()]
  const wingAction = typeof metadata.libraryWingAction === 'string' ? metadata.libraryWingAction : actionNames.includes('idle') ? 'idle' : actionNames[0]
  if (character.baseModel.rig === 'verity' && (!wingAction || !actionNames.includes(wingAction))) throw new TypeError(`Character ${model.characterId} has no valid native wing action`)
  const skinIdentity = digest(Buffer.from(refs.slice().sort((a, b) => a.object.localeCompare(b.object)).map((item) => `${item.object}:${item.sha256}`).join('\n'))).slice(0, 16)
  return { schemaVersion: 1, sourceSha256: model.source.sha256, modelId: `unified/${bobjSha.slice(0, 16)}-${skinIdentity}`,
    metersPerUnit: model.metersPerUnit,
    bones: armature.bones.map((bone) => ({ name: bone.name, parent: bone.parent,
      bobjRestMatrixRowMajor: new Matrix4().fromArray([...bone.restWorld]).transpose().toArray() })),
    actions: actionNames, textureRequired: files.length > 1, files,
    originalRig: { bobj, wingAction, ...(character.baseModel.rig !== 'verity' ? { nativeOnly: true } : {}) } }
}

/** Apply a library skin after the shared GLB conversion, keeping the converted BOBJ bytes shared. */
export async function stageConvertedLibrarySkinProfile(snapshot: UnifiedProject, model: FilmInputModel, profile: ConvertedFilmModelProfile): Promise<ConvertedFilmModelProfile> {
  const metadata = snapshot.scene.content.nodes.find((node) => node.id === model.nodeId)?.metadata as Record<string, unknown> | undefined
  if (typeof metadata?.libraryCharacterId !== 'string') return profile
  const root = resolveLibraryPath(), character = resolveCharacter({ root, charId: metadata.libraryCharacterId })
  const objects = character.baseModel?.objects ?? []
  const hidden = new Set(Array.isArray(metadata.libraryHiddenObjects) ? metadata.libraryHiddenObjects : [])
  const refs = Array.isArray(metadata.librarySkin) ? metadata.librarySkin as LibraryTextureRef[] : []
  const missing = objects.filter((object) => !hidden.has(object) && !refs.some((ref) => ref.object === object))
  if (missing.length) throw new TypeError(`Character ${model.characterId} is missing visible textures: ${missing.join(', ')}`)
  const files = profile.files.filter((file) => file.targetPath === 'model.bobj')
  const actualRoot = await realpath(root)
  for (const ref of refs) {
    if (hidden.has(ref.object)) continue
    if (!objects.includes(ref.object) || !/^[a-f0-9]{64}$/.test(ref.sha256) || !/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$)).+$/.test(ref.path)) throw new TypeError(`Character ${model.characterId} has an invalid texture reference: ${ref.object}`)
    const actual = await realpath(path.resolve(root, ...ref.path.split('/')))
    if (!actual.startsWith(`${actualRoot}${path.sep}`)) throw new TypeError(`Character ${model.characterId} texture escaped the library root`)
    if (digest(await readFile(actual)) !== ref.sha256) throw new TypeError(`Character ${model.characterId} texture hash changed: ${ref.object}`)
    files.push({ sourcePath: actual, targetPath: `textures/${ref.object}/default.png`, sha256: ref.sha256 })
  }
  const skinId = digest(Buffer.from(files.filter((file) => file.targetPath !== 'model.bobj').map((file) => `${file.targetPath}:${file.sha256}`).sort().join('\n'))).slice(0, 16)
  return { ...profile, modelId: `${profile.modelId}-${skinId}`, files, textureRequired: files.length > 1 }
}

type FilmInputModel = Awaited<ReturnType<typeof sampleProjectFilm>>['models'][number]

/** B15: Film-worker entries for AAA Particles replays; ticks clamp into the Film and empty intervals are dropped. */
export function filmAaaEffects(effects: ReadonlyArray<{ effect: string; x: number; y: number; z: number; yaw: number; scale: number; startTick: number; endTick: number; play?: 'manual' }>, durationTicks: number, effectPaths: ReadonlyMap<string, string>) {
  return effects.flatMap((item) => {
    const startTick = Math.max(0, Math.min(durationTicks - 1, Math.round(item.startTick)))
    const endTick = Math.max(startTick + 1, Math.min(durationTicks, Math.round(item.endTick)))
    const effectPath = effectPaths.get(item.effect)
    if (!effectPath) throw new TypeError(`AAA asset was not packaged: ${item.effect}`)
    return [{ label: item.effect, effect: effectPath, x: item.x, y: item.y, z: item.z, yaw: item.yaw, scale: item.scale, startTick, endTick,
      ...(item.play === 'manual' ? { manual: true } : {}) }]
  })
}

/** Add static backdrop actors after conversion; this pure step is shared by the job and manifest tests. */
export function appendFilmBackdropActors(manifest: FilmManifest, project: UnifiedProject, propIds: readonly string[], profiles: ReadonlyMap<string, ConvertedFilmModelProfile>, durationTicks: number, sourceFrame = project.scene.content.timeline.frameStart): void {
  if (!Number.isSafeInteger(durationTicks) || durationTicks < 1) throw new TypeError('Backdrop Film duration must be a positive whole number of ticks')
  const worldMatrix = filmSceneWorldMatrices(project, sourceFrame)
  for (const propId of propIds) {
    const node = project.scene.content.nodes.find((item) => item.id === propId && item.type === 'prop')
    const assetId = node?.metadata?.assetId
    if (!node || typeof assetId !== 'string') throw new TypeError(`Backdrop ${propId} is missing from the Film snapshot`)
    const profile = profiles.get(assetId)
    if (!profile) throw new TypeError(`Converted BOBJ profile is missing for backdrop ${node.name}`)
    const model = { id: profile.modelId, bones: profile.bones.map((bone) => bone.name), actions: profile.actions,
      textureRequired: profile.textureRequired, files: profile.files }
    const prior = manifest.models.find((item) => item.id === profile.modelId)
    if (prior && JSON.stringify(prior) !== JSON.stringify(model)) throw new TypeError(`Converted backdrop model ID ${profile.modelId} has conflicting profiles`)
    if (!prior) manifest.models.push(model)
    const inspected = inspectFilmActorTransform(worldMatrix(propId).toArray(), 0)
    if (!inspected.transform) throw new TypeError(`Backdrop ${node.name}: ${inspected.issues[0]?.message ?? 'invalid transform'}`)
    const pose = (tick: number) => ({ ...inspected.transform!, tick, yaw: inspected.transform!.yaw + FILM_MODEL_FACING_OFFSET })
    manifest.actors.push({ characterId: `prop:${propId}`, name: node.name.slice(0, 64) || 'Prop', modelId: profile.modelId,
      transformSamples: [pose(0), pose(durationTicks)], poseTracks: [] })
  }
}

function projectsRoot(): string {
  return path.resolve(process.env.BBS_UNIFIED_PROJECTS_DIR?.trim() || path.join(process.cwd(), 'unified-projects'))
}

function jobRoot(projectId: string, jobId: string): string {
  if (!UUID.test(projectId) || !UUID.test(jobId)) throw new TypeError('Invalid job identity')
  return path.join(projectsRoot(), projectId, '.jobs', jobId)
}

function recordPath(projectId: string, jobId: string): string { return path.join(jobRoot(projectId, jobId), 'job.json') }

async function persist(record: StoredJob): Promise<void> {
  const file = recordPath(record.projectId, record.jobId)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporary, file)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(temporary, { force: true })
    throw error
  }
}

function publicJob(record: StoredJob): UnifiedJobView {
  return {
    ...record,
    ...(record.result ? { result: { ...record.result, files: record.result.files.map(({ path: _path, ...file }) => file) } } : {}),
  }
}

function assetIds(project: UnifiedProject): string[] {
  const ids = new Set<string>()
  for (const node of project.scene.content.nodes) {
    if (!['character', 'prop', 'primitive'].includes(node.type)) continue
    const character = Object.values(project.characters).find((item) => item.nodeId === node.id)
    const metadata = node.metadata && typeof node.metadata === 'object' ? node.metadata as Record<string, unknown> : {}
    const url = typeof metadata.modelUrl === 'string' ? /\/assets\/([^/]+)\/source(?:[?#]|$)/.exec(metadata.modelUrl)?.[1] : undefined
    let routeAssetId: string | undefined
    try { if (url) routeAssetId = decodeURIComponent(url) } catch { /* Invalid references are reported by the asset resolver. */ }
    const id = [character?.assetId, typeof metadata.assetId === 'string' ? metadata.assetId : undefined, routeAssetId]
      .find((candidate) => candidate && Object.hasOwn(project.assets, candidate))
    if (id) ids.add(id)
  }
  for (const clip of project.scene.content.timeline.animation.motionClips) {
    const motion = project.motions[clip.motion.assetId]
    if (motion) ids.add(motion.assetId)
  }
  return [...ids]
}

async function stageAssets(project: UnifiedProject, folder: string): Promise<Record<string, string>> {
  const localAssets: Record<string, string> = {}
  await mkdir(folder, { recursive: true })
  for (const [index, assetId] of assetIds(project).entries()) {
    const asset = project.assets[assetId as keyof typeof project.assets]
    const source = await resolveUnifiedAssetFile(project, assetId, 'source')
    const ext = path.extname(asset.source.path)
    const file = path.join(folder, `${index}${/^\.[a-z0-9]{1,10}$/i.test(ext) ? ext : '.asset'}`)
    await writeFile(file, source.bytes, { flag: 'wx' })
    localAssets[`api/unified/projects/${project.projectId}/assets/${encodeURIComponent(assetId)}/source`] = file
  }
  return localAssets
}

function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex') }

async function saveArtifact(job: StoredJob, source: string, name: string, files: StoredFile[]): Promise<void> {
  const bytes = await readFile(source)
  const info = await stat(source)
  const target = path.join(jobRoot(job.projectId, job.jobId), 'files', name)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes, { flag: 'wx' })
  const mimeType = name.endsWith('.json') ? 'application/json' : name.endsWith('.zip') ? 'application/zip' : 'image/png'
  files.push({ id: String(files.length), name, mimeType, sizeBytes: info.size, sha256: digest(bytes), path: path.relative(jobRoot(job.projectId, job.jobId), target).replace(/\\/g, '/') })
}

function runLocalCommand(command: string, args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timedOut = false, outputExceeded = false, termination: Promise<void> | undefined
    const terminate = () => {
      if (termination || child.exitCode !== null || child.pid === undefined) return termination
      termination = process.platform === 'win32'
        ? new Promise<void>((done) => {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          killer.once('error', () => { child.kill(); done() }); killer.once('close', () => done())
        })
        : Promise.resolve().then(() => { try { process.kill(-child.pid!, 'SIGTERM') } catch { /* The process may have exited. */ } })
      if (process.platform !== 'win32') setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL') } catch { /* The process tree has exited. */ } }, 1500).unref()
      return termination
    }
    const onAbort = () => { void terminate() }
    const timer = setTimeout(() => { timedOut = true; void terminate() }, COMMAND_TIMEOUT_MS)
    const collect = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      if (target === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8')
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_COMMAND_OUTPUT) { outputExceeded = true; void terminate() }
    }
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'))
    signal.addEventListener('abort', onAbort, { once: true })
    child.once('error', (error) => {
      clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer); signal.removeEventListener('abort', onAbort)
      void (termination ?? Promise.resolve()).then(() => {
        if (signal.aborted) reject(new DOMException('Cancelled', 'AbortError'))
        else if (timedOut) reject(new Error('Local Film command timed out'))
        else if (outputExceeded) reject(new Error('Local Film command exceeded its output limit'))
        else if (code !== 0) reject(new Error(stderr.trim().split(/\r?\n/).at(-1) || `Local Film command failed (${code})`))
        else resolve(stdout)
      }, reject)
    })
  })
}

async function agentRoot(): Promise<string> {
  if (process.env.BBS_UNIFIED_AGENT_ROOT?.trim()) return path.resolve(process.env.BBS_UNIFIED_AGENT_ROOT)
  let current = path.resolve(process.cwd())
  for (let depth = 0; depth < 5; depth++, current = path.dirname(current)) {
    try { await stat(path.join(current, 'agent', 'unified_cli.py')); return current } catch { /* Continue through the local workspace ancestors. */ }
  }
  throw new Error('Local Film CLI is unavailable')
}

async function runFilmExport(runtime: Runtime, snapshot: UnifiedProject, args: FilmExportArgs, options: FilmPackageOptions = {}): Promise<void> {
  const { record, controller } = runtime, signal = controller.signal
  const base = jobRoot(record.projectId, record.jobId), work = path.join(base, 'film-work')
  const files: StoredFile[] = []
  try {
    signal.throwIfAborted()
    record.state = 'running'; record.progress = 0.03; record.updatedAt = new Date().toISOString(); await persist(record)
    const input = await sampleProjectFilm(snapshot, args, signal)
    await validateFilmEffectsDestination(args.effectsPolicy)
    const effectsPolicy = resolveFilmEffectsPolicy(args.effectsPolicy)
    const effects = await filmEffectsForExport(effectsPolicy, () => buildVfxEffectsForFilm(snapshot, args, signal))
    const aaaAssets = await collectFilmAaaAssets(record.projectId, effects, undefined, signal)
    await mkdir(work, { recursive: false })
    const agent = await agentRoot(), python = process.env.BBS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')
    const convertedRoot = path.join(work, 'converted'); await mkdir(convertedRoot)
    const profiles = new Map<string, ConvertedFilmModelProfile>(), bySource = new Map<string, ConvertedFilmModelProfile>()
    const unique = [...new Map(input.models.map((model) => [model.assetId, model])).values()]
    for (const [index, model] of input.models.entries()) {
      const original = await stageOriginalLibraryBobjProfile(snapshot, model, path.join(convertedRoot, `original-${index}`))
      if (original) profiles.set(model.characterId, original)
    }
    for (const [index, model] of unique.entries()) {
      signal.throwIfAborted()
      const characters = input.models.filter((candidate) => candidate.assetId === model.assetId)
      if (characters.every((candidate) => profiles.has(candidate.characterId))) continue
      const key = `${model.source.sha256}:${model.metersPerUnit}:${model.basisToScene.join(',')}`
      const cached = bySource.get(key)
      if (cached) { profiles.set(model.assetId, cached); continue }
      if ([...bySource.keys()].some((item) => item.startsWith(`${model.source.sha256}:`))) throw new TypeError('One source hash cannot be converted with multiple unit scales or scene bases in the same Film')
      const resolved = await resolveUnifiedAssetFile(snapshot, model.assetId, 'source')
      if (digest(resolved.bytes) !== model.source.sha256) throw new TypeError(`Character ${model.characterId} source hash changed during Film export`)
      const extension = resolved.mediaType === 'application/vnd.autodesk.fbx' ? '.fbx' : '.glb'
      const sourcePath = path.join(work, `source-${index}${extension}`)
      await writeFile(sourcePath, resolved.bytes, { flag: 'wx' })
      const output = path.join(convertedRoot, `model-${index}`); await mkdir(output)
      record.progress = 0.08 + 0.48 * (index / unique.length); record.updatedAt = new Date().toISOString(); await persist(record)
      const conversionText = await runLocalCommand(python, ['-m', 'agent.unified_cli', 'film', 'convert-model', sourcePath, '--output-dir', output, '--unit-meters', String(model.metersPerUnit), '--basis', ...model.basisToScene.map(String)], agent, signal)
      const conversion = JSON.parse(conversionText) as { profilePath?: unknown; files?: unknown }
      if (typeof conversion.profilePath !== 'string' || !Array.isArray(conversion.files)) throw new TypeError('Film converter returned an invalid profile reference')
      const convertedPath = await realpath(conversion.profilePath), rootPath = await realpath(output)
      if (!convertedPath.startsWith(`${rootPath}${path.sep}`)) throw new TypeError('Film converter profile escaped its staging folder')
      const profile = JSON.parse(await readFile(convertedPath, 'utf8')) as Omit<ConvertedFilmModelProfile, 'files'>
      const converted = { ...profile, files: conversion.files } as ConvertedFilmModelProfile
      profiles.set(model.assetId, converted); bySource.set(key, converted)
    }
    for (const model of input.models) if (!profiles.has(model.characterId)) {
      const profile = profiles.get(model.assetId)!
      profiles.set(model.characterId, await stageConvertedLibrarySkinProfile(snapshot, model, profile))
    }
    signal.throwIfAborted()
    const manifest = buildFilmExportManifest(input, profiles, args.filmName)
    // Props are converted to BOBJ profiles, then the pure manifest helper adds one static actor per scene node.
    const propProfiles = new Map<string, ConvertedFilmModelProfile>()
    for (const [index, propId] of (args.propIds ?? []).entries()) {
      signal.throwIfAborted()
      const node = snapshot.scene.content.nodes.find((item) => item.id === propId && item.type === 'prop')
      const assetId = node?.metadata?.assetId
      if (!node || typeof assetId !== 'string') throw new TypeError(`Prop ${propId} is missing from the Film snapshot`)
      let converted = propProfiles.get(assetId)
      if (!converted) {
        const resolved = await resolveUnifiedAssetFile(snapshot, assetId, 'source')
        if (digest(resolved.bytes) !== snapshot.assets[assetId as keyof typeof snapshot.assets]!.source.sha256) throw new TypeError(`Backdrop ${node.name} source hash changed during Film export`)
        const extension = resolved.mediaType === 'application/vnd.autodesk.fbx' ? '.fbx' : '.glb'
        const sourcePath = path.join(work, `prop-${index}${extension}`)
        await writeFile(sourcePath, resolved.bytes, { flag: 'wx' })
        const output = path.join(convertedRoot, `prop-${index}`); await mkdir(output)
        const unit = typeof node.metadata?.modelUnitMeters === 'number' ? node.metadata.modelUnitMeters : 1
        const basis = Array.isArray(node.metadata?.modelBasisToScene) ? node.metadata.modelBasisToScene as number[] : [1, 0, 0, 0, 1, 0, 0, 0, 1]
        const conversion = JSON.parse(await runLocalCommand(python, ['-m', 'agent.unified_cli', 'film', 'convert-model', sourcePath, '--output-dir', output,
          '--unit-meters', String(unit), '--basis', ...basis.map(String)], agent, signal)) as { profilePath?: unknown; files?: unknown }
        if (typeof conversion.profilePath !== 'string' || !Array.isArray(conversion.files)) throw new TypeError('Film converter returned an invalid prop profile reference')
        const convertedPath = await realpath(conversion.profilePath), rootPath = await realpath(output)
        if (!convertedPath.startsWith(`${rootPath}${path.sep}`)) throw new TypeError('Film converter profile escaped its staging folder')
        const profile = JSON.parse(await readFile(convertedPath, 'utf8')) as Omit<ConvertedFilmModelProfile, 'files'>
        converted = { ...profile, files: conversion.files as ConvertedFilmModelProfile['files'] }
        propProfiles.set(assetId, converted)
      }
    }
    appendFilmBackdropActors(manifest, snapshot, args.propIds ?? [], propProfiles, input.durationTicks, args.range.startFrame)
    const source = manifest.actors[0]?.transformSamples[0] ?? manifest.cameras[0]!.keyframes[0]!
    const worldAnchor = resolveFilmWorldAnchor(args.worldAnchor, [source.x, source.y, source.z])
    applyFilmWorldAnchor(manifest, worldAnchor, effects)
    // V4: Replay paths refer to the exact project-namespaced assets included in this archive.
    if (effects.length) Object.assign(manifest, { aaaEffects: filmAaaEffects(effects, input.durationTicks, aaaAssets.effectPaths) })
    const manifestPath = path.join(work, 'manifest.json')
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    const outputRoot = path.join(work, 'package'); await mkdir(outputRoot)
    record.progress = 0.62; record.updatedAt = new Date().toISOString(); await persist(record)
    const exportText = await runLocalCommand(python, ['-m', 'agent.unified_cli', 'film', 'export', manifestPath, '--output-dir', outputRoot], agent, signal)
    const exported = JSON.parse(exportText) as { packageDirectory?: unknown }
    if (typeof exported.packageDirectory !== 'string') throw new TypeError('Film worker returned an invalid package reference')
    const packagePath = await realpath(exported.packageDirectory), outputPath = await realpath(outputRoot)
    if (!packagePath.startsWith(`${outputPath}${path.sep}`)) throw new TypeError('Film worker package escaped its staging folder')
    signal.throwIfAborted()
    await writeFilmAaaAssets(packagePath, aaaAssets)
    for (const [name, value] of Object.entries(options.extraFiles ?? {})) await writeFile(path.join(packagePath, name), `${JSON.stringify(value, null, 2)}
`, { flag: 'wx' })
    await writeFile(path.join(packagePath, 'required-mods.json'), `${JSON.stringify(filmRequiredMods(effects.length), null, 2)}\n`, { flag: 'wx' })
    if (effects.length) await writeFile(path.join(packagePath, 'effects.json'), `${JSON.stringify(effects, null, 2)}\n`, { flag: 'w' })
    await writeFile(path.join(packagePath, 'world-anchor.json'), `${JSON.stringify(worldAnchor, null, 2)}\n`, { flag: 'wx' })
    // B16: voices/SFX/music heard in this Film, their 20 Hz schedule and a ducked mix for video editing.
    const audio = await filmAudioPackage(snapshot, args.range.startFrame, args.range.endFrame, signal)
    if (audio) {
      await mkdir(path.join(packagePath, 'audio'), { recursive: true })
      for (const [name, bytes] of audio.files) await writeFile(path.join(packagePath, ...name.split('/')), bytes, { flag: 'wx' })
      await writeFile(path.join(packagePath, 'audio.json'), `${JSON.stringify(audio.schedule, null, 2)}\n`, { flag: 'wx' })
      await writeFile(path.join(packagePath, 'audio', 'mix.wav'), audio.mix, { flag: 'wx' })
    }
    await writeFile(path.join(packagePath, 'README.txt'), [
      'BBS FS 2.7 Film package. Copy films/*.dat into saves/<world>/bbs/films/ and assets/** into config/bbs/assets/, keeping the included directory layout.',
      'world-anchor.json records the explicit world anchor applied equally to actors, backdrops, cameras and effects. The local-origin default places the first actor pivot at (0,64,0); this is not a live player position. Set destination XYZ for the intended world location.',
      effects.length ? 'Effects are UNVERIFIED in game. The target AAA renderer/addon was explicitly confirmed. effects.json is a project-side schedule with one transform per cue interval; startTick and endTick are relative to this Film at 20 Hz.' : 'Effects omitted: no AAA/VFX forms or replay actors are included. See required-mods.json.',
      'Attached VFX cues follow evaluated scene nodes or Character bones in App 2. Export currently accepts only attachments whose world transform stays constant for the exported interval; moving attachments are rejected because the available sidecar consumer cannot be verified to replay transform keys.',
      'Film structure was exported by the local worker. Playback in a BBS FS game was not tested by this package export.',
      '',
    ].join('\n'), { flag: 'w' })
    await writeFile(path.join(packagePath, 'REPORT.txt'), [
      'VFX export report',
      `Effects policy: ${effectsPolicy.mode}; included cue intervals: ${effects.length}; in-game effect playback: ${effects.length ? 'UNVERIFIED' : 'OMITTED'}.`,
      effectsPolicy.mode === 'include' ? 'Moving attachments are rejected: the sidecar stores one transform per interval and moving transform replay has not been established.' : 'Project VFX cues were not evaluated or changed; no effect replay, form, sidecar or asset was exported.',
      'Static cues and stationary attachments can be represented. BBS in-game playback was not tested.',
      '',
    ].join('\n'), { flag: 'w' })
    const archiveName = options.archiveName ?? `${args.filmName}.zip`
    const archive = path.join(work, archiveName)
    await runLocalCommand(python, ['-c', ZIP_SCRIPT, packagePath, archive], agent, signal)
    await saveArtifact(record, archive, archiveName, files)
    signal.throwIfAborted()
    record.result = { files, provenance: { sourceRevision: record.sourceRevision, sourceSha256: record.sourceSha256,
      targetVersion: '2.4', durationTicks: input.durationTicks, characterIds: args.characterIds, sourceHashes: input.sourceHashes, worldAnchor }, warnings: [], blockedRequests: [] }
    record.state = 'succeeded'; record.progress = 1
  } catch (error) {
    if (signal.aborted || error instanceof DOMException && error.name === 'AbortError') record.state = 'cancelled'
    else {
      record.state = 'failed'
      // Keep the first line of the real cause (no paths beyond the message itself) so failures can be diagnosed.
      const cause = error instanceof Error ? error.message.split(/\r?\n/)[0]!.slice(0, 300) : ''
      record.error = { code: 'FILM_EXPORT_FAILED', message: `Film export failed; check the local Blender 4.2+ and Java 17 setup, model profile, and project samples.${cause ? ` Cause: ${cause}` : ''}` }
    }
    await rm(path.join(base, 'files'), { recursive: true, force: true })
  } finally {
    try {
      await rm(work, { recursive: true, force: true })
      record.updatedAt = new Date().toISOString()
      await persist(record)
    } finally {
      runtime.active = false
      if (!runtime.internal) await pruneOldJobs(record.projectId)
    }
  }
}

interface FilmSeriesJobArgs {
  name: string
  segments: FilmSeriesSegment[]
}

export type FilmSeriesSegmentRunner = (project: UnifiedProject, args: FilmExportArgs, signal: AbortSignal) => Promise<Buffer>

async function runFilmSeriesExport(runtime: Runtime, snapshot: UnifiedProject, args: FilmSeriesJobArgs, segmentRunner?: FilmSeriesSegmentRunner): Promise<void> {
  const { record, controller } = runtime, signal = controller.signal
  const base = jobRoot(record.projectId, record.jobId), work = path.join(base, 'film-series-work')
  const files: StoredFile[] = []
  try {
    signal.throwIfAborted()
    record.state = 'running'; record.progress = 0.02; record.updatedAt = new Date().toISOString(); await persist(record)
    await mkdir(work, { recursive: false })
    const agent = await agentRoot()
    const python = process.env.BBS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')
    const specs: Array<{ zip: string; film: string }> = []
    for (const [index, segment] of args.segments.entries()) {
      signal.throwIfAborted()
      const order = String(index + 1).padStart(2, '0')
      const filmName = `${args.name}-${order}`
      const stagedZip = path.join(work, `segment-${order}.zip`)
      if (segmentRunner) {
        const bytes = await segmentRunner(segment.project, { ...segment.exportArgs, filmName }, signal)
        signal.throwIfAborted()
        await writeFile(stagedZip, bytes, { flag: 'wx' })
      } else {
        const childId = randomUUID(), childRoot = jobRoot(record.projectId, childId)
        await mkdir(childRoot, { recursive: false })
        const childRecord: StoredJob = {
          jobId: childId, projectId: record.projectId, type: 'film.export', state: 'queued', sourceRevision: record.sourceRevision,
          sourceSha256: record.sourceSha256, progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }
        const child: Runtime = { record: childRecord, controller, active: true, internal: true }
        try {
          await persist(childRecord)
          await runFilmExport(child, segment.project, { ...segment.exportArgs, filmName })
          signal.throwIfAborted()
          if (childRecord.state !== 'succeeded' || !childRecord.result?.files[0]) {
            throw new Error(childRecord.error?.message ?? `Film segment ${index + 1} did not finish successfully`)
          }
          const file = childRecord.result.files[0]!
          await writeFile(stagedZip, await readFile(path.join(childRoot, ...file.path.split('/'))), { flag: 'wx' })
        } finally {
          await rm(childRoot, { recursive: true, force: true })
        }
      }
      specs.push({ zip: stagedZip, film: `${filmName}.dat` })
      record.progress = 0.08 + 0.72 * ((index + 1) / args.segments.length)
      record.updatedAt = new Date().toISOString(); await persist(record)
    }
    signal.throwIfAborted()
    const readme = path.join(work, 'README.txt')
    await writeFile(readme, 'BBS FS 2.7 episode package. Copy films/*.dat into the selected world at saves/<world>/bbs/films/. Copy assets/** into config/bbs/assets/ and keep the included directory layout. required-mods.json lists runtime requirements. When included, effects.json maps each film path to its cue array; cue ticks start at zero for that film. This package has not been installed into a game.\n', { flag: 'wx' })
    let timelineTick = 0
    const series = args.segments.map((segment, index) => { const startTick = timelineTick; timelineTick += segment.ticks; return ({ projectId: segment.project.projectId, sourceRevision: segment.project.revision, startTick, endTick: timelineTick, order: index + 1, film: `films/${args.name}-${String(index + 1).padStart(2, '0')}.dat`,
      shots: segment.shots.map((shot) => shot.id), startFrame: segment.range.startFrame, endFrame: segment.range.endFrame, ticks: segment.ticks }) })
    const specPath = path.join(work, 'series-input.json')
    await writeFile(specPath, JSON.stringify({ series, segments: specs }, null, 2), { flag: 'wx' })
    const outputRoot = path.join(work, 'package'), archiveName = `${args.name}.bbs-film-series.zip`, archive = path.join(work, archiveName)
    await runLocalCommand(python, ['-c', FILM_SERIES_ARCHIVE_SCRIPT, specPath, outputRoot, readme, archive], agent, signal)
    signal.throwIfAborted()
    await saveArtifact(record, archive, archiveName, files)
    signal.throwIfAborted()
    record.result = { files, provenance: { sourceRevision: record.sourceRevision, sourceSha256: record.sourceSha256,
      targetVersion: '2.7', sequenceId: args.segments[0]?.exportArgs.sequenceId, segmentCount: args.segments.length,
      sourceFrameRanges: args.segments.map(({ range }) => range) }, warnings: [], blockedRequests: [] }
    record.state = 'succeeded'; record.progress = 1
  } catch (error) {
    if (signal.aborted || error instanceof DOMException && error.name === 'AbortError') record.state = 'cancelled'
    else {
      record.state = 'failed'
      const cause = error instanceof Error ? error.message.split(/\r?\n/)[0]!.slice(0, 300) : ''
      record.error = { code: 'FILM_SERIES_EXPORT_FAILED', message: cause || 'Film series export failed before publishing its package.' }
    }
    await rm(path.join(base, 'files'), { recursive: true, force: true })
  } finally {
    try { await rm(work, { recursive: true, force: true }); record.updatedAt = new Date().toISOString(); await persist(record) }
    finally { runtime.active = false; await pruneOldJobs(record.projectId) }
  }
}

async function runSceneRender(runtime: Runtime, snapshot: UnifiedProject, args: RenderArgs): Promise<void> {
  const { record, controller } = runtime
  const signal = controller.signal
  const base = jobRoot(record.projectId, record.jobId)
  const renders = path.join(base, 'renders')
  const assetsDir = path.join(base, 'assets')
  const files: StoredFile[] = []
  const warnings: string[] = []
  const blockedRequests = new Set<string>()
  const cameraManifests: Array<{ cameraNodeId: string; files: string[] }> = []
  const renderDevices: Array<{ kind: 'gpu' | 'cpu'; name: string; raw: string }> = []
  const sourceHash = record.sourceSha256
  try {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    record.state = 'running'
    record.progress = 0.02
    record.updatedAt = new Date().toISOString()
    await persist(record)
    const localAssets = await stageAssets(snapshot, assetsDir)
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const fcurves = snapshot.extensions.topview && typeof snapshot.extensions.topview === 'object'
      ? (snapshot.extensions.topview as Record<string, unknown>).fcurves ?? null
      : null
    // VFX cues render as App 4 sprite sheets; the headless page has no session cookie, so sheets travel as data URLs.
    const cues = readVfxCueExtension(snapshot).cues
    let vfx: { cues: typeof cues; sheets: Record<string, { url: string; meta: unknown }> } | null = null
    if (cues.length) {
      const metas = await listVfxPreviews()
      const sheets: Record<string, { url: string; meta: unknown }> = {}
      for (const effect of new Set(cues.map((cue) => cue.effect))) {
        const bytes = metas[effect] ? await readVfxSheetImage(effect) : null
        if (bytes) sheets[effect] = { url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, meta: metas[effect] }
      }
      vfx = { cues, sheets }
    }
    for (const [cameraIndex, cameraNodeId] of args.cameraNodeIds.entries()) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      const result = await renderFrames({
        document: snapshot.scene, fcurves, frames: args.frames, width: args.width, height: args.height, ...(vfx ? { vfx } : {}),
        cameraNodeId, sceneSequence: snapshot.scene.content.editorial?.sequences?.[0]?.id,
        outputDir: path.join(renders, `camera_${cameraIndex}`), localAssets, ...(args.silhouette ? { silhouette: true } : {}), ...(args.bbsLook ? { bbsLook: true } : {}),
      }, { signal, onProgress: async (completed, total) => {
        record.progress = 0.1 + 0.75 * ((cameraIndex + completed / total) / args.cameraNodeIds.length)
        record.updatedAt = new Date().toISOString()
        await persist(record)
      } })
      warnings.push(...result.warnings)
      const renderer = (result as typeof result & { renderer?: unknown }).renderer
      if (renderer && typeof renderer === 'object') {
        const value = renderer as Record<string, unknown>
        if ((value.kind === 'gpu' || value.kind === 'cpu') && typeof value.name === 'string' && typeof value.raw === 'string' &&
            !renderDevices.some((item) => item.kind === value.kind && item.raw === value.raw)) {
          renderDevices.push({ kind: value.kind, name: value.name, raw: value.raw })
        }
      }
      for (const request of result.blockedRequests) blockedRequests.add(request)
      const cameraFiles: string[] = []
      for (const frame of result.frames) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
        const name = `camera-${cameraIndex}-frame-${frame.frame}.png`
        await saveArtifact(record, frame.path, name, files)
        cameraFiles.push(name)
      }
      const sheetName = `camera-${cameraIndex}-contact-sheet.png`
      await saveArtifact(record, result.contactSheet.path, sheetName, files)
      cameraFiles.push(sheetName)
      cameraManifests.push({ cameraNodeId, files: cameraFiles })
      record.progress = 0.1 + 0.75 * ((cameraIndex + 1) / args.cameraNodeIds.length)
      record.updatedAt = new Date().toISOString()
      await persist(record)
    }
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const provenance = {
      sourceRevision: record.sourceRevision, sourceSha256: sourceHash,
      renderer: '@topview/3d-director-cli', ...(renderDevices.length ? { renderDevices } : {}), createdAt: new Date().toISOString(),
    }
    const manifest = path.join(base, 'render.json')
    await writeFile(manifest, `${JSON.stringify({ version: 1, ...provenance, width: args.width, height: args.height, frames: args.frames, cameras: cameraManifests,
      files: files.map(({ path: _path, ...file }) => file), warnings, blockedRequests: [...blockedRequests] }, null, 2)}\n`, { flag: 'wx' })
    await saveArtifact(record, manifest, 'render.json', files)
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    record.result = { files, provenance, warnings: [...new Set(warnings)], blockedRequests: [...blockedRequests] }
    record.state = 'succeeded'
    record.progress = 1
  } catch (error) {
    if (signal.aborted || error instanceof DOMException && error.name === 'AbortError') {
      record.state = 'cancelled'
    } else {
      record.state = 'failed'
      const native = error && typeof error === 'object' ? error as { code?: unknown; name?: unknown; message?: unknown } : {}
      const detail = typeof native.message === 'string' ? native.message.split('\n')[0] : ''
      const safeDetail = detail.length <= 160 && !/[A-Za-z]:[\\/]|(?:^|\s)\/(?:[^\s]+\/)*[^\s]*/.test(detail) ? detail : ''
      record.error = {
        code: typeof native.code === 'string' && /^[A-Z0-9_:-]{1,40}$/i.test(native.code) ? native.code : 'RENDER_FAILED',
        message: safeDetail || 'Scene render failed; verify the scene assets and local renderer.',
      }
    }
  } finally {
    try {
      await rm(assetsDir, { recursive: true, force: true })
      await rm(renders, { recursive: true, force: true })
      await rm(path.join(base, 'render.json'), { force: true })
      if (record.state !== 'succeeded') await rm(path.join(base, 'files'), { recursive: true, force: true })
      record.updatedAt = new Date().toISOString()
      await persist(record)
    } finally {
      runtime.active = false
      await pruneOldJobs(record.projectId)
    }
  }
}

async function pruneOldJobs(projectId: string): Promise<void> {
  const folder = path.join(projectsRoot(), projectId, '.jobs')
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  const terminal: StoredJob[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue
    const record = await readRecord(projectId, entry.name)
    if (record && !runtimes.get(record.jobId)?.active && ['succeeded', 'failed', 'cancelled'].includes(record.state)) terminal.push(record)
  }
  terminal.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  for (const record of terminal.slice(MAX_RETAINED_JOBS)) {
    await rm(jobRoot(projectId, record.jobId), { recursive: true, force: true })
    runtimes.delete(record.jobId)
  }
}

export async function startUnifiedSceneRender(project: UnifiedProject, args: RenderArgs): Promise<UnifiedJobView> {
  const active = [...runtimes.values()].some((runtime) => runtime.active)
  if (active) throw Object.assign(new Error('A local render job is already active'), { code: 'JOB_BUSY', status: 423 })
  const snapshot = structuredClone(project)
  const renderArgs = structuredClone(args)
  const jobId = randomUUID()
  const record: StoredJob = {
    jobId, projectId: project.projectId, type: 'scene.render', state: 'queued', sourceRevision: project.revision,
    sourceSha256: digest(Buffer.from(JSON.stringify(project))), progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  const runtime: Runtime = { record, controller: new AbortController(), active: true }
  // Reserve before any I/O so concurrent requests cannot both start a renderer.
  runtimes.set(jobId, runtime)
  try {
    await pruneOldJobs(project.projectId)
    await mkdir(path.dirname(jobRoot(project.projectId, jobId)), { recursive: true })
    await mkdir(jobRoot(project.projectId, jobId), { recursive: false })
    await persist(record)
  } catch (error) {
    runtimes.delete(jobId)
    throw error
  }
  runtime.done = new Promise<void>((resolve) => setTimeout(resolve, 0))
    .then(() => runSceneRender(runtime, snapshot, renderArgs))
  // A failed final disk write remains observable to job.cancel without an unhandled rejection.
  void runtime.done.catch(() => undefined)
  return publicJob(record)
}

export async function startUnifiedFilmExport(project: UnifiedProject, args: FilmExportArgs, options: FilmPackageOptions = {}): Promise<UnifiedJobView> {
  if ([...runtimes.values()].some((runtime) => runtime.active)) throw Object.assign(new Error('A local conversion job is already active'), { code: 'JOB_BUSY', status: 423 })
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(args.filmName) || args.filmName.endsWith('.')) throw Object.assign(new TypeError('Film name must use 1-64 safe ASCII characters'), { code: 'VALIDATION_FAILED', status: 400 })
  if (options.archiveName !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.zip$/.test(options.archiveName) ||
      Object.keys(options.extraFiles ?? {}).some((name) => !/^[a-z0-9-]{1,40}\.json$/.test(name) || ['export-manifest.json', 'export-report.json'].includes(name))) {
    throw Object.assign(new TypeError('Film package names must be safe and must not replace worker files'), { code: 'VALIDATION_FAILED', status: 400 })
  }
  await validateFilmEffectsDestination(args.effectsPolicy)
  const preflight = preflightProjectFilm(project, args)
  const snapshot = structuredClone(project), exportArgs = structuredClone({ ...args,
    content: preflight.content, characterIds: preflight.characterIds, propIds: preflight.propIds }), jobId = randomUUID()
  const record: StoredJob = { jobId, projectId: project.projectId, type: 'film.export', state: 'queued', sourceRevision: project.revision,
    sourceSha256: digest(Buffer.from(JSON.stringify(project))), progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const runtime: Runtime = { record, controller: new AbortController(), active: true }
  runtimes.set(jobId, runtime)
  try {
    await pruneOldJobs(project.projectId)
    await mkdir(path.dirname(jobRoot(project.projectId, jobId)), { recursive: true })
    await mkdir(jobRoot(project.projectId, jobId), { recursive: false })
    await persist(record)
  } catch (error) { runtimes.delete(jobId); throw error }
  runtime.done = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => runFilmExport(runtime, snapshot, exportArgs, structuredClone(options)))
  void runtime.done.catch(() => undefined)
  return publicJob(record)
}

export async function startUnifiedFilmSeriesExport(project: UnifiedProject, args: FilmSeriesJobArgs, segmentRunner?: FilmSeriesSegmentRunner): Promise<UnifiedJobView> {
  if ([...runtimes.values()].some((runtime) => runtime.active)) throw Object.assign(new Error('A local conversion job is already active'), { code: 'JOB_BUSY', status: 423 })
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,55}$/.test(args.name) || args.name.endsWith('.') || !args.segments.length) {
    throw Object.assign(new TypeError('Film series name must use 1-56 safe ASCII characters and include at least one segment'), { code: 'VALIDATION_FAILED', status: 400 })
  }
  for (const segment of args.segments) await validateFilmEffectsDestination(segment.exportArgs.effectsPolicy)
  const snapshot = structuredClone(project), inputs = structuredClone(args), jobId = randomUUID()
  const record: StoredJob = { jobId, projectId: project.projectId, type: 'film.series.export', state: 'queued', sourceRevision: project.revision,
    sourceSha256: digest(Buffer.from(JSON.stringify(project))), progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const runtime: Runtime = { record, controller: new AbortController(), active: true }
  runtimes.set(jobId, runtime)
  try {
    await pruneOldJobs(project.projectId)
    await mkdir(path.dirname(jobRoot(project.projectId, jobId)), { recursive: true })
    await mkdir(jobRoot(project.projectId, jobId), { recursive: false })
    await persist(record)
  } catch (error) { runtimes.delete(jobId); throw error }
  runtime.done = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => runFilmSeriesExport(runtime, snapshot, inputs, segmentRunner))
  void runtime.done.catch(() => undefined)
  return publicJob(record)
}

export async function startUnifiedNormalization(project: UnifiedProject, args: NormalizationPlanArgs, planSha256: string): Promise<UnifiedJobView> {
  if ([...runtimes.values()].some((runtime) => runtime.active)) throw Object.assign(new Error('A local job is already active'), { code: 'JOB_BUSY', status: 423 })
  const snapshot = structuredClone(project), inputs = structuredClone(args), jobId = randomUUID()
  const record: StoredJob = { jobId, projectId: project.projectId, type: 'rig.normalization.run', state: 'queued', sourceRevision: project.revision,
    sourceSha256: digest(Buffer.from(JSON.stringify(snapshot))), progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const runtime: Runtime = { record, controller: new AbortController(), active: true }
  runtimes.set(jobId, runtime)
  try { await pruneOldJobs(project.projectId); await persist(record) }
  catch (error) { runtimes.delete(jobId); throw error }
  runtime.done = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(async () => {
    try {
      runtime.controller.signal.throwIfAborted()
      record.state = 'running'; record.progress = 0.1; await persist(record)
      const output = await stageProjectNormalization(snapshot, inputs, planSha256, runtime.controller.signal)
      runtime.controller.signal.throwIfAborted()
      const reportBytes = Buffer.from(JSON.stringify({ ...output.report, provenance: output.provenance }, null, 2))
      const files: StoredFile[] = []
      for (const [name, mimeType, bytes] of [['normalized.glb', 'model/gltf-binary', Buffer.from(output.bytes)], ['report.json', 'application/json', reportBytes]] as const) {
        await writeFile(path.join(jobRoot(project.projectId, jobId), name), bytes, { flag: 'wx' })
        files.push({ id: String(files.length), name, mimeType, sizeBytes: bytes.length, sha256: digest(bytes), path: name })
      }
      runtime.controller.signal.throwIfAborted()
      record.result = { files, provenance: { ...output.provenance, committedToProject: false }, warnings: [], blockedRequests: [] }
      record.state = 'succeeded'; record.progress = 1
    } catch (error) {
      record.state = runtime.controller.signal.aborted ? 'cancelled' : 'failed'
      record.error = { code: runtime.controller.signal.aborted ? 'CANCELLED' : 'NORMALIZATION_FAILED', message: error instanceof TypeError || error instanceof RangeError ? error.message : 'Normalization failed before publishing outputs' }
    } finally {
      record.updatedAt = new Date().toISOString()
      try { await persist(record) } finally { runtime.active = false }
    }
  })
  void runtime.done.catch(() => undefined)
  return publicJob(record)
}

export async function startUnifiedAssignment(project: UnifiedProject, args: AssignmentArgs, planSha256: string): Promise<UnifiedJobView> {
  if ([...runtimes.values()].some((runtime) => runtime.active)) throw Object.assign(new Error('A local job is already active'), { code: 'JOB_BUSY', status: 423 })
  const snapshot = structuredClone(project), inputs = structuredClone(args), jobId = randomUUID()
  const record: StoredJob = { jobId, projectId: project.projectId, type: 'animation.assignment.run', state: 'queued', sourceRevision: project.revision,
    sourceSha256: digest(Buffer.from(JSON.stringify(snapshot))), progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const runtime: Runtime = { record, controller: new AbortController(), active: true }
  runtimes.set(jobId, runtime)
  try { await pruneOldJobs(project.projectId); await persist(record) }
  catch (error) { runtimes.delete(jobId); throw error }
  runtime.done = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(async () => {
    try {
      runtime.controller.signal.throwIfAborted()
      record.state = 'running'; record.progress = 0.1; await persist(record)
      const output = await stageProjectAssignment(snapshot, inputs, planSha256, runtime.controller.signal)
      runtime.controller.signal.throwIfAborted()
      const reportBytes = Buffer.from(JSON.stringify({ ...output.report, assignment: output.assignment, provenance: output.provenance }, null, 2))
      const files: StoredFile[] = []
      for (const [name, mimeType, bytes] of [['assigned.glb', 'model/gltf-binary', Buffer.from(output.bytes)], ['report.json', 'application/json', reportBytes]] as const) {
        await writeFile(path.join(jobRoot(project.projectId, jobId), name), bytes, { flag: 'wx' })
        files.push({ id: String(files.length), name, mimeType, sizeBytes: bytes.length, sha256: digest(bytes), path: name })
      }
      runtime.controller.signal.throwIfAborted()
      record.result = { files, provenance: { ...output.provenance, actionDurationSeconds: output.report.durationSeconds, committedToProject: false }, warnings: [], blockedRequests: [] }
      record.state = 'succeeded'; record.progress = 1
    } catch (error) {
      record.state = runtime.controller.signal.aborted ? 'cancelled' : 'failed'
      record.error = { code: runtime.controller.signal.aborted ? 'CANCELLED' : 'ASSIGNMENT_FAILED', message: error instanceof TypeError || error instanceof RangeError ? error.message : 'Assignment failed before publishing outputs' }
    } finally {
      record.updatedAt = new Date().toISOString()
      try { await persist(record) } finally { runtime.active = false }
    }
  })
  void runtime.done.catch(() => undefined)
  return publicJob(record)
}

/** Blender conversion is an immutable artifact job, with the existing cancellation/process-tree lifecycle. */
export async function startUnifiedSceneConversion(project: UnifiedProject, args: SceneConversionArgs): Promise<UnifiedJobView> {
  if ([...runtimes.values()].some(runtime => runtime.active)) throw Object.assign(new Error('A local job is already active'), { code: 'JOB_BUSY', status: 423 })
  const snapshot = structuredClone(project), inputs = structuredClone(args), jobId = randomUUID(), now = new Date().toISOString()
  const record: StoredJob = { jobId, projectId: project.projectId, type: 'scene.export.blend-fbx', state: 'queued', sourceRevision: project.revision,
    sourceSha256: digest(Buffer.from(JSON.stringify(snapshot))), progress: 0, createdAt: now, updatedAt: now }
  const runtime: Runtime = { record, controller: new AbortController(), active: true }
  runtimes.set(jobId, runtime)
  try { await pruneOldJobs(project.projectId); await persist(record) }
  catch(error) { runtimes.delete(jobId); throw error }
  const work = path.join(jobRoot(project.projectId, jobId), 'scene-work')
  runtime.done = new Promise<void>(resolve => setTimeout(resolve, 0)).then(async () => {
    try {
      runtime.controller.signal.throwIfAborted()
      record.state = 'running'; record.progress = 0.1; await persist(record)
      const built = await stageSceneConversion(snapshot, inputs, work, runtime.controller.signal, runLocalCommand, agentRoot)
      runtime.controller.signal.throwIfAborted()
      const name = 'scene-export.zip'
      await writeFile(path.join(jobRoot(project.projectId, jobId), name), built.bytes, { flag: 'wx' })
      runtime.controller.signal.throwIfAborted()
      record.result = { files: [{ id: '0', name, mimeType: 'application/zip', sizeBytes: built.bytes.length, sha256: digest(built.bytes), path: name }], provenance: built.provenance, warnings: [], blockedRequests: [] }
      record.state = 'succeeded'; record.progress = 1
    } catch(error) {
      record.state = runtime.controller.signal.aborted ? 'cancelled' : 'failed'
      const message = error instanceof Error ? error.message : 'Scene conversion failed'
      record.error = { code: runtime.controller.signal.aborted ? 'CANCELLED' : message.includes('NOT_RUN:') ? 'BLENDER_UNAVAILABLE' : 'SCENE_CONVERSION_FAILED', message }
      await rm(path.join(jobRoot(project.projectId, jobId), 'scene-export.zip'), { force: true })
    } finally {
      await rm(work, { recursive: true, force: true })
      record.updatedAt = new Date().toISOString()
      try { await persist(record) } finally { runtime.active = false }
    }
  })
  void runtime.done.catch(() => undefined)
  return publicJob(record)
}

async function readRecord(projectId: string, jobId: string): Promise<StoredJob | null> {
  if (!UUID.test(jobId) || !UUID.test(projectId)) return null
  const runtime = runtimes.get(jobId)
  if (runtime?.record.projectId === projectId) return runtime.record
  try {
    const parsed = JSON.parse(await readFile(recordPath(projectId, jobId), 'utf8')) as StoredJob
    if (parsed.jobId !== jobId || parsed.projectId !== projectId || !['scene.export.blend-fbx', 'scene.export.glb', 'shot.export', 'app3.export', 'scene.render', 'film.export', 'film.series.export', 'rig.normalization.run', 'animation.assignment.run'].includes(parsed.type) || !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(parsed.state)) return null
    if (parsed.state === 'queued' || parsed.state === 'running') {
      parsed.state = 'failed'
      parsed.error = { code: 'HOST_RESTARTED', message: 'The local host restarted before the job completed.' }
      parsed.updatedAt = new Date().toISOString()
      await persist(parsed)
    }
    return parsed
  } catch { return null }
}

export async function getUnifiedJob(jobId: string, projectId: string): Promise<UnifiedJobView> {
  const record = await readRecord(projectId, jobId)
  if (!record) throw Object.assign(new Error('Render job not found'), { code: 'NOT_FOUND', status: 404 })
  const runtime = runtimes.get(jobId)
  if (runtime?.active && ['succeeded', 'failed', 'cancelled'].includes(record.state)) await runtime.done
  return publicJob(record)
}

export async function cancelUnifiedJob(jobId: string, projectId: string): Promise<{ state: UnifiedJobState; committed: boolean }> {
  const record = await readRecord(projectId, jobId)
  if (!record) throw Object.assign(new Error('Render job not found'), { code: 'NOT_FOUND', status: 404 })
  const pending = runtimes.get(jobId)
  if (pending?.active && ['succeeded', 'failed', 'cancelled'].includes(record.state)) await pending.done
  if (record.state === 'succeeded') return { state: record.state, committed: !['scene.export.blend-fbx', 'scene.export.glb', 'shot.export', 'app3.export', 'rig.normalization.run', 'animation.assignment.run'].includes(record.type) }
  if (record.state === 'failed' || record.state === 'cancelled') return { state: record.state, committed: false }
  const runtime = runtimes.get(jobId)
  if (!runtime) return { state: record.state, committed: false }
  runtime.controller.abort()
  await runtime.done
  return { state: record.state, committed: false }
}

export async function readUnifiedJobFile(jobId: string, projectId: string, fileId: string): Promise<{ bytes: Buffer; name: string; mimeType: string } | null> {
  const record = await readRecord(projectId, jobId)
  const file = record?.state === 'succeeded' ? record.result?.files.find((item) => item.id === fileId) : undefined
  if (!record || !file || !/^\d{1,2}$/.test(fileId) || !/^[A-Za-z0-9._-]{1,128}$/.test(file.name) ||
      !['image/png', 'application/json', 'application/zip', 'model/gltf-binary', 'text/plain', 'application/octet-stream'].includes(file.mimeType) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || !/^[a-f0-9]{64}$/.test(file.sha256) ||
      file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '.' || part === '..')) return null
  const base = await realpath(jobRoot(projectId, jobId))
  const target = path.resolve(base, ...file.path.split('/'))
  if (!target.startsWith(`${base}${path.sep}`)) return null
  const resolvedTarget = await realpath(target)
  if (!resolvedTarget.startsWith(`${base}${path.sep}`)) return null
  const bytes = await readFile(resolvedTarget)
  if (bytes.byteLength !== file.sizeBytes || digest(bytes) !== file.sha256) return null
  return { bytes, name: file.name, mimeType: file.mimeType }
}

/** Store an already validated local package using the existing authenticated job-file API. */
export async function storeShotArtifact(project: UnifiedProject, bytes: Buffer, shotId: string): Promise<UnifiedJobView> {
  const jobId = randomUUID(), dir = jobRoot(project.projectId, jobId), now = new Date().toISOString()
  await mkdir(path.join(dir, 'output'), { recursive: true })
  const name = `shot-${shotId}.zip`
  await writeFile(path.join(dir, 'output', name), bytes, { flag: 'wx' })
  const record: StoredJob = { jobId, projectId: project.projectId, type: 'shot.export', state: 'succeeded', sourceRevision: project.revision,
    sourceSha256: digest(Buffer.from(JSON.stringify(project))), progress: 1, createdAt: now, updatedAt: now,
    result: { files: [{ id: '0', name, mimeType: 'application/zip', sizeBytes: bytes.length, sha256: digest(bytes), path: `output/${name}` }], provenance: { shotId }, warnings: [], blockedRequests: [] } }
  await persist(record)
  return publicJob(record)
}

/** App 3 output is immutable, broker owned and served by the authenticated job-file route. */
export async function storeApp3Artifact(project: UnifiedProject, bytes: Buffer, name: string, mimeType: string, provenance: Record<string,unknown>): Promise<UnifiedJobView> {
 if(!/^[A-Za-z0-9._-]{1,128}$/.test(name)||!bytes.length||!['application/zip','text/plain','application/octet-stream'].includes(mimeType))throw new TypeError('Invalid App 3 artifact')
 const jobId=randomUUID(),dir=jobRoot(project.projectId,jobId),now=new Date().toISOString()
 await mkdir(path.join(dir,'output'),{recursive:true})
 try {
  await writeFile(path.join(dir,'output',name),bytes,{flag:'wx'})
  const record:StoredJob={jobId,projectId:project.projectId,type:'app3.export',state:'succeeded',sourceRevision:project.revision,sourceSha256:digest(Buffer.from(JSON.stringify(project))),progress:1,createdAt:now,updatedAt:now,result:{files:[{id:'0',name,mimeType,sizeBytes:bytes.length,sha256:digest(bytes),path:`output/${name}`}],provenance,warnings:[],blockedRequests:[]}}
  await persist(record);return publicJob(record)
 }catch(error){await rm(dir,{recursive:true,force:true});throw error}
}
export async function discardApp3Artifact(projectId:string,jobId:string){await rm(jobRoot(projectId,jobId),{recursive:true,force:true})}
