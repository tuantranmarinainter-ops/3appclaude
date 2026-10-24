/**
 * Workbench pipeline: the CLI's `normalize.ts` flow (load → runNormalize → model mode → .bobj) as functions, plus the
 * non-baking `inspectNormalize` view the UI needs. Same cores as the CLI; no retarget logic lives here.
 */
import { createHash } from 'node:crypto'
import { AnimationClip } from 'three'
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
import { DEFAULT_ADJUSTMENTS, resolveAdjustments, type AdjustmentSettings } from '../src/adjustments.ts'
import { loadVerityModel, type VerityModel } from './verity.ts'
import { ParsedAssetCache } from './parsedAssetCache.ts'

const here = dirname(fileURLToPath(import.meta.url))
/** The V9.12 Minecraft20 armature shipped with Studio is the default rig for `.bobj` sources and `.bobj` output. */
export const DEFAULT_ARMATURE = resolve(here, '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj')
const FAMILIES: readonly SourceFamily[] = ['mixamo', 'ue', 'cc', 'lol', 'wc3r', 'wow', 'minecraft20', 'unknown']

/** A mistake the user can fix (bad option, unknown id); the server maps it to a 4xx with this message. */
export class UserError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export interface SourceRecord { id: string; name: string; format: AssetFormat; path: string; bytes: number; sha256: string; uploaded: boolean; armaturePath?: string }
/** `original`: folder holding the character's original `model.bbs.bobj` + textures (Verity rig); results are carried back onto it. */
export interface TargetRecord { id: string; file: string; path: string; sha256: string; hipsHeightMeters: number; name?: string; library?: boolean; original?: string }

export interface RunOptions {
  actionRanges?: Record<number, [number, number]>; actions?: number[]; actionNames?: Record<number, { name: string; nameVi?: string }>; previewAction?: number; unitMeters?: number; upAxis: 'y' | 'z'; rootPolicy: 'preserve' | 'in-place'; rootScale?: number; ground: 'off' | 'lift' | 'level' | 'frame'
  calibrate: 'limbs' | 'none'; facingDegrees?: number; swapSides: 'auto' | 'on' | 'off'; mode: 'animation' | 'model'; bobj: boolean; bobjRoot: 'inPlace' | 'follow'; preview: boolean
  adjustments: AdjustmentSettings
  review: boolean
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
  let actionNames: RunOptions['actionNames']
  if (raw.actionNames !== undefined) {
    if (!raw.actionNames || typeof raw.actionNames !== 'object' || Array.isArray(raw.actionNames)) throw new UserError('options.actionNames must map Action indices to names')
    actionNames = {}
    for (const [key, value] of Object.entries(raw.actionNames as Record<string, any>)) {
      if (!/^\d+$/.test(key) || !value || typeof value.name !== 'string' || !value.name.trim() || (value.nameVi !== undefined && typeof value.nameVi !== 'string')) throw new UserError('options.actionNames contains an invalid name')
      actionNames[Number(key)] = { name: value.name.trim(), ...(typeof value.nameVi === 'string' && value.nameVi.trim() ? { nameVi: value.nameVi.trim() } : {}) }
    }
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
    ...(actionNames ? { actionNames } : {}),
    ...(actions ? { actions } : {}),
    previewAction: number('previewAction', (n) => Number.isInteger(n) && n >= 0, 'a non-negative Action index'),
    unitMeters: number('unitMeters', (n) => n > 0, 'a positive number'),
    upAxis: oneOf('upAxis', ['y', 'z'], 'y'), rootPolicy: oneOf('rootPolicy', ['preserve', 'in-place'], 'preserve'),
    rootScale: number('rootScale', (n) => n > 0, 'a positive number'), ground: oneOf('ground', ['off', 'lift', 'level', 'frame'], 'lift'),
    calibrate: oneOf('calibrate', ['limbs', 'none'], 'limbs'), facingDegrees: number('facingDegrees', () => true, 'a number of degrees'),
    swapSides: oneOf('swapSides', ['auto', 'on', 'off'], 'auto'),
    mode: oneOf('mode', ['animation', 'model'], 'animation'), bobj: raw.bobj === true, bobjRoot: oneOf('bobjRoot', ['inPlace', 'follow'], 'inPlace'),
    preview: raw.preview === true,
    adjustments: parseAdjustments(raw.adjustments),
    review: raw.review === true,
  }
}

function parseAdjustments(value: unknown): AdjustmentSettings {
  if (value === undefined || value === null) return { ...DEFAULT_ADJUSTMENTS }
  if (typeof value !== 'object' || Array.isArray(value)) throw new UserError('options.adjustments must be an object')
  const unknown = Object.keys(value).find((key) => !(key in DEFAULT_ADJUSTMENTS))
  if (unknown) throw new UserError(`options.adjustments.${unknown} is not a known adjustment`)
  try { return resolveAdjustments(value as Partial<AdjustmentSettings>) } catch (error) { throw new UserError(`options.${(error as Error).message}`) }
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

const parsedAssets = new ParsedAssetCache(8, 256 * 1024 * 1024)

async function loadScenes(source: SourceRecord, target: TargetRecord) {
  const [src, dst] = await Promise.all([
    parsedAssets.load(source.path, source.format, source.format === 'bobj' ? source.armaturePath ?? DEFAULT_ARMATURE : undefined),
    parsedAssets.load(target.path, 'glb'),
  ])
  return { srcBytes: src.bytes, source: src.scene, target: dst.scene }
}

function toRequest(source: SourceRecord, target: TargetRecord, options: RunOptions, scenes: Awaited<ReturnType<typeof loadScenes>>, preset: unknown, presetFamily: SourceFamily | undefined): NormalizeRequest {
  return { source: scenes.source, sourceLabel: source.name, sourceSha256: source.sha256, target: scenes.target, targetLabel: target.file, targetSha256: target.sha256,
    actionRanges: options.actionRanges, actions: options.actions, previewAction: options.previewAction, unitMeters: unitMetersFor(source, options), upAxis: options.upAxis, rootPolicy: options.rootPolicy,
    rootScale: options.rootScale, ground: options.ground, mappingPreset: preset ?? undefined, ...(preset && presetFamily ? { presetFamily } : {}), preview: options.preview,
    calibrate: options.calibrate, facingDegrees: options.facingDegrees, swapSides: options.swapSides, adjustments: options.adjustments }
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

export interface RunFile { name: string; kind: 'glb' | 'manifest' | 'report' | 'preview' | 'bobj' | 'bobjPreview' | 'originalBobj' | 'originalGlb'; bytes: number }
const verityModels = new Map<string, VerityModel>()

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
  if (options.review) {
    if (options.actions?.length !== 1) throw new UserError('Review requires exactly one Action')
    // Review already has full diagnostics from inspect; avoid cloning/validating 399 unused clips per click.
    // Empty placeholders keep source indices, names and durations stable. Exports always use the full asset.
    scenes.source.animations = scenes.source.animations.map((clip, index) => options.actions!.includes(index) ? clip : new AnimationClip(clip.name, clip.duration, []))
  }
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
    const names = options.actionNames ?? {}
    if (Object.keys(names).length) {
      const buffer = Buffer.from(result.glb), view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      if (view.getUint32(0, true) !== 0x46546c67) throw new UserError('Cannot rename animations in an invalid GLB', 409)
      const jsonLength = view.getUint32(12, true), document = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))
      for (const action of result.manifest.actions as any[]) {
        const replacement = names[action.sourceActionIndex]
        if (!replacement) continue
        action.sourceName ??= action.name
        action.name = replacement.name
        if (replacement.nameVi) action.nameVi = replacement.nameVi
        if (document.animations?.[action.glbAnimationIndex]) document.animations[action.glbAnimationIndex].name = action.name
      }
      const json = Buffer.from(JSON.stringify(document)), padded = Buffer.alloc((json.length + 3) & ~3, 0x20); json.copy(padded)
      const binaryOffset = 20 + jsonLength, binaryLength = buffer.length > binaryOffset ? view.getUint32(binaryOffset, true) : 0
      const binary = binaryLength ? buffer.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength) : Buffer.alloc(0)
      const out = Buffer.alloc(12 + 8 + padded.length + (binaryLength ? 8 + binary.length : 0)); out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8)
      out.writeUInt32LE(padded.length, 12); out.writeUInt32LE(0x4e4f534a, 16); padded.copy(out, 20)
      if (binaryLength) { const offset = 20 + padded.length; out.writeUInt32LE(binary.length, offset); out.writeUInt32LE(0x004e4942, offset + 4); binary.copy(out, offset + 8) }
      result.glb = new Uint8Array(out)
      ;(result.manifest as any).glbSha256 = sha256(result.glb)
    }
    manifest = result.manifest
    write('.glb', 'glb', result.glb); write('.manifest.json', 'manifest', JSON.stringify(result.manifest, null, 2))
    if (result.preview) write('.preview.png', 'preview', result.preview)
    if (options.bobj) {
      await onProgress('bobj', 0, 1)
      const armatureText = readFileSync(DEFAULT_ARMATURE, 'utf8')
      const previewAnimation = result.manifest.actions.find((action) => action.sourceActionIndex === report.roundtrip.primaryAction)?.glbAnimationIndex ?? 0
      const minecraft = await exportMinecraft20(result.glb, armatureText, { rootTravelMode: options.bobjRoot, proportionSide: options.adjustments.proportionSide,
        shoulderWidth: options.adjustments.shoulderWidth, upperArm: options.adjustments.upperArm, forearm: options.adjustments.forearm, legLength: options.adjustments.legLength }, previewAnimation)
      report.minecraft20 = { ...minecraft.report, armature: basename(DEFAULT_ARMATURE) }
      write('.minecraft20.bobj', 'bobj', minecraft.bobj)
      if (options.preview) write('.minecraft20.preview.png', 'bobjPreview', renderContactSheet(minecraft.previewFrames, minecraft.previewParents))
      if (minecraft.report.status !== 'PASS' && status === 'PASS') status = 'FAIL'
    }
    if (target.original) {
      // Original-skeleton target: every normalized Action goes back onto the character's own bones (Jaw at rest, wings
      // looping a built-in Action), appended to its original .bobj; plus a GLB with the same skeleton for viewing.
      await onProgress('original', 0, 1)
      const bobjPath = join(target.original, 'model.bbs.bobj')
      let model = verityModels.get(bobjPath)
      if (!model) { model = loadVerityModel(bobjPath); verityModels.set(bobjPath, model) }
      const added = await model.convertNormalized(result.glb)
      const bobj = model.appendBobj(added), roundTripMaxErrorUnits = model.roundTripError(bobj, added)
      report.original = { character: target.name ?? target.id, bones: model.boneCount, builtInActions: model.builtInActions, addedActions: added.map((action) => action.name),
        glbAnimationOffset: model.builtInActions.length, jaw: 'rest', wings: model.hasWings ? `loop ${model.wingAction}` : 'none', roundTripMaxErrorUnits,
        textures: join(target.original, 'textures'), status: roundTripMaxErrorUnits < 1e-3 ? 'PASS' : 'FAIL' }
      write('.original.bbs.bobj', 'originalBobj', bobj)
      write('.original.glb', 'originalGlb', model.buildGlb(added))
      if (report.original.status !== 'PASS' && status === 'PASS') status = 'FAIL'
    }
  }
  report.status = status
  write('.report.json', 'report', JSON.stringify(report, null, 2))
  await onProgress('commit', 0, 1)
  signal?.throwIfAborted()
  for (const [name, data] of pending) writeFileSync(join(outDir, name), data)
  return { status, report, manifest, files }
}
