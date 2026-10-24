import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetRig } from './universal'
import type { UniversalBakeFrame } from './universalBake'

export type Side = 'both' | 'left' | 'right'
/** Mixamo-style "Hiệu chỉnh" on the normalized Mixamo65 animation. Defaults are the identity (the frames are not touched at all). */
export interface AdjustmentSettings {
  /** Scales every joint rotation away from the rest pose (1 = as retargeted). */
  intensity: number
  /** Extra scale of the leg rotations (hip, knee, foot). */
  stride: number
  /** Scales the Hips vertical excursion around the rest height. */
  vertical: number
  shoulderWidth: number
  upperArm: number
  forearm: number
  legLength: number
  /** Abducts both upper arms around the shoulder; + wider, − closer (V9.12 `armSpace`: aim direction += side·k·0.55·chestRight). */
  armSpace: number
  /** Same for the upper legs. */
  legSpace: number
  /** Which side the proportions/spacing apply to (Mixamo "Áp dụng"). */
  proportionSide: Side
  /** Which leg the stride scale applies to. */
  strideSide: Side
  /** Swap left and right (mirror the motion across the sagittal plane). */
  mirror: boolean
  /** Share (0–0.9) of the start/end of the clip to cut. */
  trimStart: number
  trimEnd: number
  /** Playback speed multiplier (time is divided by it). */
  speed: number
  /** Extra rotation in degrees per Mixamo65 joint short name (e.g. leftarm), local XYZ axes, applied last. */
  jointOffsets: Record<string, readonly [number, number, number]>
}
type NumericKey = 'intensity' | 'stride' | 'vertical' | 'shoulderWidth' | 'upperArm' | 'forearm' | 'legLength' | 'armSpace' | 'legSpace' | 'trimStart' | 'trimEnd' | 'speed'
export const DEFAULT_ADJUSTMENTS: Readonly<AdjustmentSettings> = { intensity: 1, stride: 1, vertical: 1, shoulderWidth: 1, upperArm: 1, forearm: 1, legLength: 1, armSpace: 0, legSpace: 0,
  proportionSide: 'both', strideSide: 'both', mirror: false, trimStart: 0, trimEnd: 0, speed: 1, jointOffsets: {} }
export const ADJUSTMENT_LIMITS: Readonly<Record<NumericKey, readonly [number, number]>> = {
  intensity: [0, 2], stride: [0, 2], vertical: [0, 2], shoulderWidth: [0.7, 1.4], upperArm: [0.7, 1.4], forearm: [0.7, 1.4], legLength: [0.8, 1.25], armSpace: [-0.5, 1], legSpace: [-0.5, 1],
  trimStart: [0, 0.9], trimEnd: [0, 0.9], speed: [0.25, 4],
}
const SPACE_GAIN = 0.55

const short = (name?: string) => (name ?? '').replace(/^.*[:|]/, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase().replace(/^mixamorig/, '')

export function resolveAdjustments(value?: Partial<AdjustmentSettings> | null): AdjustmentSettings {
  const result: AdjustmentSettings = { ...DEFAULT_ADJUSTMENTS, jointOffsets: {} }
  for (const key of Object.keys(ADJUSTMENT_LIMITS) as NumericKey[]) {
    const item = value?.[key]
    if (item === undefined || item === null) continue
    const [min, max] = ADJUSTMENT_LIMITS[key]
    if (typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max) throw new RangeError(`adjustments.${key} must be a number in [${min}, ${max}]`)
    result[key] = item
  }
  if (result.trimStart + result.trimEnd > 0.95) throw new RangeError('adjustments.trimStart + trimEnd must leave at least 5% of the clip')
  for (const key of ['proportionSide', 'strideSide'] as const) {
    const item = value?.[key]
    if (item === undefined || item === null) continue
    if (item !== 'both' && item !== 'left' && item !== 'right') throw new RangeError(`adjustments.${key} must be both, left or right`)
    result[key] = item
  }
  if (value?.mirror !== undefined && typeof value.mirror !== 'boolean') throw new RangeError('adjustments.mirror must be a boolean')
  result.mirror = value?.mirror === true
  for (const [joint, angles] of Object.entries(value?.jointOffsets ?? {})) {
    if (!Array.isArray(angles) || angles.length !== 3 || angles.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 360)) throw new RangeError(`adjustments.jointOffsets.${joint} must be [x, y, z] degrees`)
    if (angles.some((n) => n !== 0)) result.jointOffsets[short(joint)] = [angles[0]!, angles[1]!, angles[2]!]
  }
  return result
}
export const isDefaultAdjustments = (settings: AdjustmentSettings) => (Object.keys(ADJUSTMENT_LIMITS) as NumericKey[]).every((key) => settings[key] === DEFAULT_ADJUSTMENTS[key])
  && settings.proportionSide === 'both' && settings.strideSide === 'both' && !settings.mirror && !Object.keys(settings.jointOffsets).length

export interface AdjustmentReport { applied: boolean; settings: AdjustmentSettings; framesBefore: number; framesAfter: number }

const sideOf = (name: string): 'left' | 'right' | null => (name.startsWith('left') ? 'left' : name.startsWith('right') ? 'right' : null)
const LEG_ROTATION = new Set(['leftupleg', 'rightupleg', 'leftleg', 'rightleg', 'leftfoot', 'rightfoot', 'lefttoebase', 'righttoebase'])
type Bone = UniversalBakeFrame['bones'][number]

/**
 * Deterministic per-frame post-process of the solved target frames: local rotations/positions change, world matrices are recomputed.
 * Order: trim/speed (time), mirror, intensity/stride, proportions, vertical, arm/leg spacing, joint offsets. May shorten `frames` (trim).
 */
export function adjustFrames(rig: RetargetRig, frames: UniversalBakeFrame[], settings: AdjustmentSettings): AdjustmentReport {
  const framesBefore = frames.length
  if (isDefaultAdjustments(settings) || !frames.length) return { applied: false, settings, framesBefore, framesAfter: framesBefore }
  const index = new Map(rig.bones.map((bone, i) => [bone.id, i]))
  const restWorld = rig.bones.map((bone) => new Matrix4().fromArray(bone.restWorld))
  const parentIndex = rig.bones.map((bone) => (bone.parentId ? index.get(bone.parentId) ?? -1 : -1))
  const names = rig.bones.map((bone) => short(bone.name))
  const byName = new Map(names.map((name, i) => [name, i]))
  const restLocalQ = rig.bones.map((_, i) => new Quaternion().setFromRotationMatrix(parentIndex[i]! >= 0 ? restWorld[parentIndex[i]!]!.clone().invert().multiply(restWorld[i]!) : restWorld[i]!))
  const restWorldQ = restWorld.map((m) => new Quaternion().setFromRotationMatrix(m))
  const hipsIndex = byName.get('hips')
  const restHips = hipsIndex === undefined ? null : restWorld[hipsIndex]!
  const enabled = (name: string, side: Side) => { const of = sideOf(name); return !of || side === 'both' || side === of }
  const scaleOf = (name: string) => name.endsWith('shoulder') ? settings.shoulderWidth : name.endsWith('arm') && !name.endsWith('forearm') ? settings.shoulderWidth
    : name.endsWith('forearm') ? settings.upperArm : name.endsWith('hand') ? settings.forearm
    : (name.endsWith('leg') && !name.endsWith('upleg')) || name.endsWith('foot') ? settings.legLength : 1
  // Left/RightArm sits on the shoulder (width); the forearm/hand offsets are the upper arm/forearm lengths; knee/foot offsets the leg length.
  const positionScale = names.map((name) => (sideOf(name) && enabled(name, settings.proportionSide) ? scaleOf(name) : 1))
  const spaceOf = (name: string) => (name.endsWith('arm') && !name.endsWith('forearm') ? settings.armSpace : name.endsWith('upleg') ? settings.legSpace : 0)
  const childOf = (name: string) => byName.get(name === 'leftarm' ? 'leftforearm' : name === 'rightarm' ? 'rightforearm' : name === 'leftupleg' ? 'leftleg' : name === 'rightupleg' ? 'rightleg' : '')
  const partner = names.map((name, i) => byName.get(name.startsWith('left') ? `right${name.slice(4)}` : name.startsWith('right') ? `left${name.slice(5)}` : name) ?? i)

  if (settings.trimStart > 0 || settings.trimEnd > 0) {
    const count = frames.length, from = Math.min(Math.floor(count * settings.trimStart), count - 1), to = Math.max(from + 1, count - Math.floor(count * settings.trimEnd))
    frames.splice(to); frames.splice(0, from)
    frames.forEach((frame, i) => { frame.frame = i })
  }
  if (settings.speed !== 1) { const t0 = frames[0]!.timeSeconds; for (const frame of frames) frame.timeSeconds = (frame.timeSeconds - t0) / settings.speed + t0 }
  const needsPose = settings.mirror || settings.intensity !== 1 || settings.stride !== 1 || settings.vertical !== 1 || settings.armSpace !== 0 || settings.legSpace !== 0
    || Object.keys(settings.jointOffsets).length > 0 || positionScale.some((value) => value !== 1)

  for (const frame of needsPose ? frames : []) {
    const pose = new Map(frame.bones.map((bone) => [bone.targetBoneId, bone]))
    const original: Bone[] = rig.bones.map((bone) => pose.get(bone.id)!)
    const rootParent = rig.bones.map((_, i) => {
      if (parentIndex[i]! >= 0) return null
      const bone = original[i]!
      const local = new Matrix4().compose(new Vector3().fromArray(bone.position), new Quaternion().fromArray(bone.rotation), new Vector3().fromArray(bone.scale))
      return new Matrix4().fromArray(bone.world).multiply(local.invert())
    })
    const worldsOf = (rotations: Quaternion[], positions: Vector3[]) => {
      const worlds: Matrix4[] = new Array(rig.bones.length)
      // rig.bones is parent-before-child (the GLB writer relies on it).
      for (let i = 0; i < rig.bones.length; i++) worlds[i] = (parentIndex[i]! >= 0 ? worlds[parentIndex[i]!]! : rootParent[i]!).clone().multiply(new Matrix4().compose(positions[i]!, rotations[i]!, new Vector3().fromArray(original[i]!.scale)))
      return worlds
    }
    const commit = (rotations: Quaternion[], positions: Vector3[]) => {
      const worlds = worldsOf(rotations, positions)
      original.forEach((bone, i) => { bone.position = positions[i]!.toArray(); bone.rotation = rotations[i]!.normalize().toArray(); bone.world = worlds[i]!.toArray() })
    }
    if (settings.mirror) {
      const worldQ = original.map((bone) => new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(bone.world)))
      // Mirror across the sagittal (YZ) plane in world space: the pseudo-vector axis flips y/z; the left bone takes the right bone's mirrored delta from rest.
      const newWorldQ = rig.bones.map((_, i) => { const d = worldQ[partner[i]!]!.clone().multiply(restWorldQ[partner[i]!]!.clone().invert()); return new Quaternion(d.x, -d.y, -d.z, d.w).multiply(restWorldQ[i]!) })
      const rotations = rig.bones.map((_, i) => (parentIndex[i]! >= 0 ? newWorldQ[parentIndex[i]!]! : new Quaternion().setFromRotationMatrix(rootParent[i]!)).clone().invert().multiply(newWorldQ[i]!).normalize())
      // Local offsets are the target's own rest offsets (kept per bone); only the Hips travel flips across the body centre line.
      const positions = original.map((bone, i) => { const p = new Vector3().fromArray(bone.position); if (i === hipsIndex && restHips) p.x = 2 * restHips.elements[12]! - p.x; return p })
      commit(rotations, positions)
    }
    const chest = byName.get('spine2') ?? byName.get('spine1')
    const chestAxis = chest === undefined ? null : new Vector3(1, 0, 0).applyQuaternion(new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(original[chest]!.world)))
    const hipAxis = (() => { const a = byName.get('leftupleg'), b = byName.get('rightupleg'); if (a === undefined || b === undefined) return null
      const axis = new Vector3(original[a]!.world[12]! - original[b]!.world[12]!, 0, original[a]!.world[14]! - original[b]!.world[14]!); return axis.lengthSq() > 1e-10 ? axis.normalize() : null })()

    const worlds: Matrix4[] = new Array(rig.bones.length)
    const rotations: Quaternion[] = [], positions: Vector3[] = []
    for (let i = 0; i < rig.bones.length; i++) {
      const bone = original[i]!, name = names[i]!
      const position = new Vector3().fromArray(bone.position), rotation = new Quaternion().fromArray(bone.rotation)
      const parentWorld = parentIndex[i]! >= 0 ? worlds[parentIndex[i]!]! : rootParent[i]!
      const factor = (parentIndex[i]! >= 0 ? settings.intensity : 1) * (LEG_ROTATION.has(name) && enabled(name, settings.strideSide) ? settings.stride : 1)
      if (factor !== 1) rotation.copy(restLocalQ[i]!).slerp(rotation, factor)
      if (positionScale[i] !== 1) position.multiplyScalar(positionScale[i]!)
      if (i === hipsIndex && settings.vertical !== 1) {
        const worldPos = position.clone().applyMatrix4(parentWorld)
        worldPos.y = restHips!.elements[13]! + (worldPos.y - restHips!.elements[13]!) * settings.vertical
        position.copy(worldPos.applyMatrix4(parentWorld.clone().invert()))
      }
      const space = enabled(name, settings.proportionSide) ? spaceOf(name) : 0, axis = name.endsWith('arm') ? chestAxis ?? hipAxis : hipAxis, child = childOf(name)
      if (space !== 0 && axis && child !== undefined) {
        const parentQ = new Quaternion().setFromRotationMatrix(parentWorld)
        const worldQ = parentQ.clone().multiply(rotation)
        const direction = new Vector3().fromArray(original[child]!.position).applyQuaternion(worldQ).normalize()
        const pushed = direction.clone().addScaledVector(axis, (name.startsWith('left') ? 1 : -1) * space * SPACE_GAIN).normalize()
        rotation.copy(parentQ.invert().multiply(new Quaternion().setFromUnitVectors(direction, pushed).multiply(worldQ))).normalize()
      }
      const offset = settings.jointOffsets[name]
      if (offset) rotation.multiply(new Quaternion().setFromEuler(new Euler(offset[0] * Math.PI / 180, offset[1] * Math.PI / 180, offset[2] * Math.PI / 180, 'XYZ')))
      rotations.push(rotation); positions.push(position)
      worlds[i] = parentWorld.clone().multiply(new Matrix4().compose(position, rotation, new Vector3().fromArray(bone.scale)))
    }
    commit(rotations, positions)
  }
  return { applied: true, settings, framesBefore, framesAfter: frames.length }
}
