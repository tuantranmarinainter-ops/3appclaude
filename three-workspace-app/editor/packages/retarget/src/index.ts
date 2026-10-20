import { Matrix4, Quaternion, Vector3 } from 'three'
import type { BobjArmature, RetargetedBone } from './reverse'

export interface BobjKeyframe {
  t: number
  v: number
  mode: string
  lx?: number
  ly?: number
  rx?: number
  ry?: number
}

export interface BobjChannel {
  path: string
  index: number
  keys: BobjKeyframe[]
}

export interface BobjGroup {
  name: string
  channels: BobjChannel[]
}

export interface BobjAction {
  name: string
  groups: Map<string, BobjGroup>
  durationTicks: number
}

function parseFinite(value: string | undefined, line: number, field: string): number {
  const parsed = Number(value)
  if (!value || !Number.isFinite(parsed)) throw new Error(`BOBJ line ${line}: invalid ${field}`)
  return parsed
}

/** Reads V9.12's BOBJ key format without converting its Minecraft tick timebase. */
export function parseBobjActions(text: string): Map<string, BobjAction> {
  const actions = new Map<string, BobjAction>()
  let action: BobjAction | null = null
  let group: BobjGroup | null = null
  let channel: BobjChannel | null = null

  for (const [lineIndex, raw] of text.split(/\r?\n/).entries()) {
    const lineNumber = lineIndex + 1
    if (raw.startsWith('an ')) {
      const name = raw.slice(3).trim()
      if (!name || actions.has(name)) throw new Error(`BOBJ line ${lineNumber}: missing or duplicate action`)
      action = { name, groups: new Map(), durationTicks: 0 }
      actions.set(name, action)
      group = null
      channel = null
    } else if (raw.startsWith('ao ')) {
      if (!action) throw new Error(`BOBJ line ${lineNumber}: group before action`)
      const name = raw.slice(3).trim()
      if (!name || action.groups.has(name)) throw new Error(`BOBJ line ${lineNumber}: missing or duplicate group`)
      group = { name, channels: [] }
      action.groups.set(name, group)
      channel = null
    } else if (raw.startsWith('ag ')) {
      if (!action || !group) throw new Error(`BOBJ line ${lineNumber}: channel before group`)
      const parts = raw.trim().split(/\s+/)
      if (parts.length !== 3) throw new Error(`BOBJ line ${lineNumber}: invalid channel`)
      const index = parseFinite(parts[2], lineNumber, 'channel index')
      if (!Number.isInteger(index)) throw new Error(`BOBJ line ${lineNumber}: invalid channel index`)
      channel = { path: parts[1], index, keys: [] }
      group.channels.push(channel)
    } else if (raw.startsWith('kf ')) {
      if (!action || !group || !channel) throw new Error(`BOBJ line ${lineNumber}: keyframe before channel`)
      const parts = raw.trim().split(/\s+/)
      if (parts.length < 4) throw new Error(`BOBJ line ${lineNumber}: invalid keyframe`)
      const mode = parts[3].toUpperCase()
      if (!mode) throw new Error(`BOBJ line ${lineNumber}: interpolation missing`)
      const key: BobjKeyframe = {
        t: parseFinite(parts[1], lineNumber, 'keyframe time'),
        v: parseFinite(parts[2], lineNumber, 'keyframe value'),
        mode,
      }
      if (parts.length >= 8) {
        key.lx = parseFinite(parts[4], lineNumber, 'left handle time')
        key.ly = parseFinite(parts[5], lineNumber, 'left handle value')
        key.rx = parseFinite(parts[6], lineNumber, 'right handle time')
        key.ry = parseFinite(parts[7], lineNumber, 'right handle value')
      } else if (mode === 'BEZIER') {
        throw new Error(`BOBJ line ${lineNumber}: bezier handles missing`)
      }
      const previous = channel.keys[channel.keys.length - 1]
      if (previous && key.t < previous.t) throw new Error(`BOBJ line ${lineNumber}: keyframes are out of order`)
      channel.keys.push(key)
      action.durationTicks = Math.max(action.durationTicks, key.t)
    }
  }

  return actions
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

function solveBezierX(x1: number, x2: number, x: number): number {
  let low = 0
  let high = 1
  let u = x
  for (let i = 0; i < 18; i += 1) {
    if (cubic(0, x1, x2, 1, u) < x) low = u
    else high = u
    u = (low + high) * 0.5
  }
  return u
}

/** Evaluates a BOBJ channel in source ticks using V9.12's interpolation rules. */
export function evaluateBobjChannel(channel: BobjChannel, timeTicks: number): number {
  if (!Number.isFinite(timeTicks)) throw new RangeError('timeTicks must be finite')
  const keys = channel.keys
  if (!keys.length) return 0
  if (keys.length === 1 || timeTicks <= keys[0].t) return keys[0].v
  let low = 0
  let high = keys.length - 1
  if (timeTicks >= keys[high].t) return keys[high].v
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (keys[mid].t <= timeTicks) low = mid
    else high = mid
  }
  const a = keys[low]
  const b = keys[high]
  const fraction = (timeTicks - a.t) / (b.t - a.t || 1)
  if (a.mode === 'CONSTANT') return a.v
  if (a.mode !== 'BEZIER' || a.rx === undefined || b.lx === undefined || a.ry === undefined || b.ly === undefined) {
    return a.v + (b.v - a.v) * fraction
  }
  const dt = b.t - a.t
  const dv = (b.v - a.v) || 1e-5
  const x1 = Math.min(1, Math.max(0, (a.rx - a.t) / dt))
  const x2 = Math.min(1, Math.max(0, (b.lx - a.t) / dt))
  const y1 = (a.ry - a.v) / dv
  const y2 = (b.ly - a.v) / dv
  const u = solveBezierX(x1, x2, fraction)
  return a.v + cubic(0, y1, y2, 1, u) * dv
}

/** Samples V9.12 BOBJ transforms in source ticks: restLocal multiplied by T·Rz·Ry·Rx·S. */
export function evaluateBobjAction(armature: BobjArmature, action: BobjAction, timeTicks: number): RetargetedBone[] {
  if (!Number.isFinite(timeTicks)) throw new RangeError('timeTicks must be finite')
  const locals = new Map<string, Matrix4>()
  for (const bone of armature.bones) {
    let x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1
    for (const channel of action.groups.get(bone.name)?.channels ?? []) {
      const value = evaluateBobjChannel(channel, timeTicks)
      const values = channel.path === 'location' ? [x, y, z] : channel.path === 'rotation' ? [rx, ry, rz] : channel.path === 'scale' ? [sx, sy, sz] : null
      if (!values || channel.index < 0 || channel.index > 2) continue
      values[channel.index] = value
      if (channel.path === 'location') [x, y, z] = values
      else if (channel.path === 'rotation') [rx, ry, rz] = values
      else [sx, sy, sz] = values
    }
    const delta = new Matrix4().makeTranslation(x, y, z)
      .multiply(new Matrix4().makeRotationZ(rz))
      .multiply(new Matrix4().makeRotationY(ry))
      .multiply(new Matrix4().makeRotationX(rx))
      .multiply(new Matrix4().makeScale(sx, sy, sz))
    locals.set(bone.name, new Matrix4().fromArray([...bone.restLocal]).multiply(delta))
  }
  const bones = new Map(armature.bones.map((bone) => [bone.name, bone]))
  const worlds = new Map<string, Matrix4>()
  const visiting = new Set<string>()
  const world = (name: string): Matrix4 => {
    const cached = worlds.get(name)
    if (cached) return cached
    const bone = bones.get(name)
    if (!bone) throw new Error(`BOBJ armature is missing parent bone ${name}`)
    if (visiting.has(name)) throw new Error(`BOBJ armature contains a cycle at ${name}`)
    visiting.add(name)
    const local = locals.get(name)!
    const matrix = bone.parent ? world(bone.parent).clone().multiply(local) : local.clone()
    visiting.delete(name)
    worlds.set(name, matrix)
    return matrix
  }
  return armature.bones.map((bone) => {
    const local = locals.get(bone.name)!
    const position = new Vector3()
    const rotation = new Quaternion()
    const scale = new Vector3()
    local.decompose(position, rotation, scale)
    return {
      name: bone.name,
      position: position.toArray() as [number, number, number],
      rotation: rotation.normalize().toArray() as [number, number, number, number],
      scale: scale.toArray() as [number, number, number],
      worldMatrix: world(bone.name).toArray() as RetargetedBone['worldMatrix'],
    }
  })
}

export { createReverseRetargeter, parseBobjArmature } from './reverse'
export { bakeReverseRetargetFrames, retargetFramesToAnimationClip } from './bake'
export { defaultReverseRetargetSettings, validateReverseRetargetSettings } from './reverse'
export { buildSkeletonMappingSuggestions, createRetargetCalibration, isRetargetCalibrationV1, RETARGET_SEMANTIC_ROLES, validateSemanticMapping } from './mapping'
export { applyMixamo65MappingPreset, createMixamo65MappingPreset } from './mappingPreset'
export type { AppliedMappingPreset, Mixamo65MappingPreset } from './mappingPreset'
export { isRetargetProjectV99 } from './project'
export { createUniversalRetargeter } from './universal'
export { calibrationRuntime, isUniversalCalibrationDraftV1, isUniversalCalibrationV1, isUniversalReferencePoseV1, sealUniversalCalibrationV1 } from './universalCalibration'
export type { UniversalCalibrationDraftV1, UniversalCalibrationRuntime, UniversalCalibrationV1, UniversalPoseReferenceV1, UniversalReferencePoseV1 } from './universalCalibration'
export { createThreeRigAdapter } from './threeRigAdapter'
export { universalFramesToGlb } from './universalGlb'
export { normalizeAnimation } from './normalizeAnimation'
export { assignCanonicalAnimation } from './assignCanonicalAnimation'
export { rebindCanonicalModel } from './rebindCanonicalModel'
export { exportCanonicalModel } from './exportCanonicalModel'
export type { NormalizeAnimationInput } from './normalizeAnimation'
export type { ThreeRigActionIssue, ThreeRigAdapterOptions } from './threeRigAdapter'
export { buildUniversalMappingSuggestions, validateUniversalMapping } from './universal'
export type { RetargetBonePair, RetargetPoseBone, RetargetRig, RetargetRigBone, UniversalMappingReport, UniversalMappingSuggestion, UniversalRetargetFrame } from './universal'
export { bakeUniversalRetargetFrames, estimateUniversalBakeCost, MAX_UNIVERSAL_BAKE_ESTIMATED_BYTES, MAX_UNIVERSAL_BAKE_FRAMES, MAX_UNIVERSAL_BAKE_NODE_SAMPLES, universalFramesToAnimationClip } from './universalBake'
export type { UniversalBakeFrame, UniversalBakeRange, UniversalRetargetSolver } from './universalBake'
export { transferSkinWeights } from './universalSkin'
export type { SkinInfluence, SkinVertex, SkinWeightTransferReport } from './universalSkin'
export { isMixamo65Topology, MIXAMO65_BONE_PARENTS, MIXAMO65_REFERENCE } from './mixamo65'
export type { BobjArmature, BobjArmatureBone, MixamoPoseBone, Quat, RetargetedBone, ReverseRetargetSettings, Vec3 } from './reverse'
export type { RetargetBakeFrame, RetargetBakeRange, ReverseRetargetSolver } from './bake'
export type { MappingSkeleton, MappingSuggestion, MappingValidationReport, RetargetCalibrationV1, SemanticBonePair, SemanticRole } from './mapping'
export type { RetargetProjectV99 } from './project'
