/**
 * Workbench pipeline: the CLI's `normalize.ts` flow (load → runNormalize → model mode → .bobj) as functions, plus the
 * non-baking `inspectNormalize` view the UI needs. Same cores as the CLI; no retarget logic lives here.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMixamo65MappingPreset } from '../src/mappingPreset.ts'
import type { MappingSkeleton } from '../src/mapping.ts'
import { formatFromPath, loadAsset, type AssetFormat } from '../cli/loadAsset.ts'
import { applyModelMode, ModelBlockedError, readModelSourceFiles, type PipelineResult } from '../cli/modelExport.ts'
import { inspectNormalize, runNormalize, type NormalizeProgress, type NormalizeRequest } from '../cli/normalizeCore.ts'
import type { SourceFamily } from '../cli/autoMapping.ts'
import { renderContactSheet } from '../cli/previewPng.ts'
import { exportMinecraft20 } from '../cli/toMinecraft20.ts'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'

const here = dirname(fileURLToPath(import.meta.url))
/** The V9.12 Minecraft20 armature shipped with Studio is the default rig for `.bobj` sources and `.bobj` output. */
export const DEFAULT_ARMATURE = resolve(here, '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj')
const FAMILIES: readonly SourceFamily[] = ['mixamo', 'ue', 'cc', 'lol', 'wc3r', 'wow', 'minecraft20', 'unknown']

/** A mistake the user can fix (bad option, unknown id); the server maps it to a 4xx with this message. */
export class UserError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export interface SourceRecord { id: string; name: string; format: AssetFormat; path: string; bytes: number; sha256: string; uploaded: boolean; armaturePath?: string }
export interface TargetRecord { id: string; file: string; path: string; sha256: string; hipsHeightMeters: number }

export interface RunOptions {
  actionRanges?: Record<number, [number, number]>; actions?: number[]; previewAction?: number; unitMeters?: number; upAxis: 'y' | 'z'; rootPolicy: 'preserve' | 'in-place'; rootScale?: number; ground: 'off' | 'lift' | 'level' | 'frame'
  calibrate: 'limbs' | 'none'; facingDegrees?: number; swapSides: 'auto' | 'on' | 'off'; mode: 'animation' | 'model'; bobj: boolean; bobjRoot: 'inPlace' | 'follow'; preview: boolean
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Validates the JSON `options` object field by field, naming the offending field (the UI shows the message verbatim). */
export function parseOptions(value: unknown): RunOptions {
  const raw = (value ?? {}) as Record<string, unknown>
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new UserError('options must be an object')
  const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const item = raw[key]
    if (item === undefined || item === null || item === '') return fallback
    if (!allowed.includes(item as T)) throw new UserError(`options.${key} must be one of ${allowed.join(', ')}`)
    return item as T
  }
  const number = (key: string, check: (n: number) => boolean, hint: string): number | undefined => {
    const item = raw[key]
    if (item === undefined || item === null || item === '') return undefined
    if (typeof item !== 'number' || !Number.isFinite(item) || !check(item)) throw new UserError(`options.${key} must be ${hint}`)
    return item
  }
  let actions: number[] | undefined
  if (raw.actions !== undefined && raw.actions !== null && raw.actions !== 'all') {
    if (!Array.isArray(raw.actions) || raw.actions.some((index) => !Number.isInteger(index) || index < 0)) throw new UserError('options.actions must be "all" or a list of Action indices')
    actions = raw.actions as number[]
  }
  let actionRanges: Record<number, [number, number]> | undefined
  if (raw.actionRanges !== undefined) {
    if (!raw.actionRanges || typeof raw.actionRanges !== 'object' || Array.isArray(raw.actionRanges)) throw new UserError('options.actionRanges must be an object')
    actionRanges = {}
    for (const [key, range] of Object.entries(raw.actionRanges)) {
      if (!/^\d+$/.test(key) || !Array.isArray(range) || range.length !== 2 || range.some((n) => typeof n !== 'number' || !Number.isFinite(n)) || range[0] < 0 || range[1] <= range[0]) throw new UserError('options.actionRanges must contain [start, end] seconds')
      actionRanges[Number(key)] = range as [number, number]
    }
  }
  return {
    actionRanges,
    ...(actions ? { actions } : {}),
    previewAction: number('previewAction', (n) => Number.isInteger(n) && n >= 0, 'a non-negative Action index'),
    unitMeters: number('unitMeters', (n) => n > 0, 'a positive number'),
    upAxis: oneOf('upAxis', ['y', 'z'], 'y'), rootPolicy: oneOf('rootPolicy', ['preserve', 'in-place'], 'preserve'),
    rootScale: number('rootScale', (n) => n > 0, 'a positive number'), ground: oneOf('ground', ['off', 'lift', 'level', 'frame'], 'lift'),
    calibrate: oneOf('calibrate', ['limbs', 'none'], 'limbs'), facingDegrees: number('facingDegrees', () => true, 'a number of degrees'),
    swapSides: oneOf('swapSides', ['auto', 'on', 'off'], 'auto'),
    mode: oneOf('mode', ['animation', 'model'], 'animation'), bobj: raw.bobj === true, bobjRoot: oneOf('bobjRoot', ['inPlace', 'follow'], 'inPlace'),
    preview: raw.preview === true,
  }
}

export function parseFamily(value: unknown): SourceFamily | undefined {
  if (value === undefined || value === null) return undefined
  if (!FAMILIES.includes(value as SourceFamily)) throw new UserError('presetFamily is not a known source family')
  return value as SourceFamily
}

export function describeSource(path: string, name: string, uploaded: boolean, id: string, armaturePath?: string): SourceRecord {
  const format = formatFromPath(name)
  const bytes = readFileSync(path)
  return { id, name, format, path, bytes: bytes.length, sha256: sha256(bytes), uploaded, ...(armaturePath ? { armaturePath } : {}) }
}

const resourceDir = (record: { path: string }) => dirname(record.path)
const unitMetersFor = (record: SourceRecord, options: RunOptions) => options.unitMeters ?? (record.format === 'fbx' ? 0.01 : 1)

async function loadScenes(source: SourceRecord, target: TargetRecord) {
  const armature = source.format === 'bobj' ? readFileSync(source.armaturePath ?? DEFAULT_ARMATURE) : undefined
  const srcBytes = readFileSync(source.path), targetBytes = readFileSync(target.path)
  return {
    srcBytes,
    source: await loadAsset(srcBytes, source.format, { skeletonOnly: true, resourceDir: resourceDir(source), ...(armature ? { bobjArmature: armature } : {}) }),
    target: await loadAsset(targetBytes, 'glb', { skeletonOnly: true, resourceDir: resourceDir(target) }),
  }
}

function toRequest(source: SourceRecord, target: TargetRecord, options: RunOptions, scenes: Awaited<ReturnType<typeof loadScenes>>, preset: unknown, presetFamily: SourceFamily | undefined): NormalizeRequest {
  return { source: scenes.source, sourceLabel: source.name, sourceSha256: source.sha256, target: scenes.target, targetLabel: target.file, targetSha256: target.sha256,
    actionRanges: options.actionRanges, actions: options.actions, previewAction: options.previewAction, unitMeters: unitMetersFor(source, options), upAxis: options.upAxis, rootPolicy: options.rootPolicy,
    rootScale: options.rootScale, ground: options.ground, mappingPreset: preset ?? undefined, ...(preset && presetFamily ? { presetFamily } : {}), preview: options.preview,
    calibrate: options.calibrate, facingDegrees: options.facingDegrees, swapSides: options.swapSides }
}

/** The inspection payload the UI renders: mapping rows, bone list, Actions, proportions, facing. No bake happens. */
export async function inspect(source: SourceRecord, target: TargetRecord, options: RunOptions, preset: unknown, presetFamily?: SourceFamily) {
  const scenes = await loadScenes(source, target)
  const result = await inspectNormalize(toRequest(source, target, options, scenes, preset, presetFamily))
  const calibration = result.ready?.calibration
  const children = new Map<string, number>()
  for (const bone of result.rigs.source.bones) if (bone.parentId) children.set(bone.parentId, (children.get(bone.parentId) ?? 0) + 1)
  const names = new Map(result.rigs.source.bones.map((bone) => [bone.id, bone.name]))
  return {
    sourceId: source.id, format: source.format, blocker: result.blocker ? { code: result.blocker.code, message: result.blocker.message } : null,
    mapping: result.mappingReport,
    sides: result.sides,
    sourceBones: result.rigs.source.bones.map((bone) => ({ name: bone.name, parent: bone.parentId ? names.get(bone.parentId) ?? null : null, children: children.get(bone.id) ?? 0 })),
    actions: result.ready ? result.ready.actionsReport : result.actions.map(({ issues, ...rest }) => ({ ...rest, issueCount: issues.length, issues: issues.slice(0, 5) })),
    proportions: { sourceHipsHeightMeters: result.sourceHipsHeight, targetHipsHeightMeters: result.targetHipsHeight, suggestedRootScale: result.suggestedRootScale },
    facing: calibration ? { yawDegrees: calibration.facingYawDegrees, measuredDegrees: calibration.measuredFacingYawDegrees, ambiguous: calibration.facingAmbiguous, source: calibration.facingSource,
      maxCalibrationDegrees: Math.max(0, ...calibration.corrections.map((item) => item.degrees)) } : null,
    loss: result.ready ? { prunedTracks: result.ready.prune.report.count, droppedScaleTracks: result.ready.prune.scale.dropped, normalizedQuaternions: result.ready.prune.quaternions.normalized } : null,
    defaults: { unitMeters: unitMetersFor(source, options) },
  }
}

/** Builds a `bbs.mixamo65-mapping-preset` from user-chosen source bone names (null/'' = unmapped). */
export async function buildPreset(source: SourceRecord, target: TargetRecord, assignments: unknown) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) throw new UserError('assignments must be an object { MixamoJoint: sourceBoneName | null }')
  const scenes = await loadScenes(source, target)
  const result = await inspectNormalize({ ...toRequest(source, target, parseOptions({}), scenes, undefined, undefined), actions: [] })
  const skeleton = (rig: { fingerprint: string; bones: Array<{ id: string; name: string; parentId: string | null }> }, id: string): MappingSkeleton => ({ id, family: 'custom-preserved', fingerprint: rig.fingerprint, bones: rig.bones })
  const sourceSkeleton = skeleton(result.rigs.source, 'source'), targetSkeleton = skeleton(result.rigs.target, 'target')
  const known = new Set(MIXAMO65_BONE_PARENTS.map(([name]) => name))
  const chosen: Record<string, string> = {}
  for (const [joint, value] of Object.entries(assignments as Record<string, unknown>)) {
    if (!known.has(joint)) throw new UserError(`${joint} is not a Mixamo65 joint`)
    if (value === null || value === '') continue
    if (typeof value !== 'string') throw new UserError(`Source bone for ${joint} must be a name or null`)
    const matches = result.rigs.source.bones.filter((bone) => bone.name === value)
    if (matches.length === 0) throw new UserError(`Source bone "${value}" (for ${joint}) does not exist in ${source.name}`)
    if (matches.length > 1) throw new UserError(`Source bone name "${value}" (for ${joint}) is ambiguous in ${source.name}; presets address bones by name`)
    chosen[joint] = matches[0]!.id
  }
  const used = new Map<string, string>()
  for (const [joint, id] of Object.entries(chosen)) {
    if (used.has(id)) throw new UserError(`Source bone is assigned to both ${used.get(id)} and ${joint}`)
    used.set(id, joint)
  }
  return { preset: createMixamo65MappingPreset(sourceSkeleton, targetSkeleton, chosen), family: result.mapping.family }
}

export interface RunFile { name: string; kind: 'glb' | 'manifest' | 'report' | 'preview' | 'bobj' | 'bobjPreview'; bytes: number }

/** CLI-equivalent run. Files are written into `outDir` (a session temp folder); the user's source is never touched. */
export async function runPipeline(source: SourceRecord, target: TargetRecord, options: RunOptions, preset: unknown, presetFamily: SourceFamily | undefined, outDir: string, onProgress: NormalizeProgress, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const stem = basename(source.name, extname(source.name)).replace(/[^\w.\- ]+/g, '_') || 'source'
  const files: RunFile[] = []
  const pending = new Map<string, string | Uint8Array>()
  const write = (suffix: string, kind: RunFile['kind'], data: string | Uint8Array) => {
    const name = `${stem}${suffix}`
    pending.set(name, data)
    files.push({ name, kind, bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.length })
  }
  const unitMeters = unitMetersFor(source, options)
  const scenes = await loadScenes(source, target)
  let modelFiles: ReturnType<typeof readModelSourceFiles> | undefined
  let early: PipelineResult | undefined
  if (options.mode === 'model') {
    try { modelFiles = readModelSourceFiles(scenes.srcBytes, source.format, resourceDir(source)) } catch (error) {
      if (!(error instanceof ModelBlockedError)) throw error
      early = { status: 'BLOCKED', report: { status: 'BLOCKED', blocker: { code: error.code, message: error.message } } }
    }
  }
  let result: PipelineResult = early ?? await runNormalize({ ...toRequest(source, target, options, scenes, preset, presetFamily), onProgress, signal })
  if (options.mode === 'model') {
    await onProgress('model', 0, 1)
    result = await applyModelMode(result, { loadSource: () => loadAsset(scenes.srcBytes, source.format, { keepMeshes: true, resourceDir: resourceDir(source) }), files: modelFiles ?? null, unitMeters, upAxis: options.upAxis })
  }
  const report = result.report as Record<string, any>
  let status: string = result.status
  let manifest: unknown
  if ('glb' in result) {
    manifest = result.manifest
    write('.glb', 'glb', result.glb); write('.manifest.json', 'manifest', JSON.stringify(result.manifest, null, 2))
    if (result.preview) write('.preview.png', 'preview', result.preview)
    if (options.bobj) {
      await onProgress('bobj', 0, 1)
      const armatureText = readFileSync(DEFAULT_ARMATURE, 'utf8')
      const previewAnimation = result.manifest.actions.find((action) => action.sourceActionIndex === report.roundtrip.primaryAction)?.glbAnimationIndex ?? 0
      const minecraft = await exportMinecraft20(result.glb, armatureText, { rootTravelMode: options.bobjRoot }, previewAnimation)
      report.minecraft20 = { ...minecraft.report, armature: basename(DEFAULT_ARMATURE) }
      write('.minecraft20.bobj', 'bobj', minecraft.bobj)
      if (options.preview) write('.minecraft20.preview.png', 'bobjPreview', renderContactSheet(minecraft.previewFrames, minecraft.previewParents))
      if (minecraft.report.status !== 'PASS' && status === 'PASS') status = 'FAIL'
    }
  }
  report.status = status
  write('.report.json', 'report', JSON.stringify(report, null, 2))
  await onProgress('commit', 0, 1)
  signal?.throwIfAborted()
  for (const [name, data] of pending) writeFileSync(join(outDir, name), data)
  return { status, report, manifest, files }
}
