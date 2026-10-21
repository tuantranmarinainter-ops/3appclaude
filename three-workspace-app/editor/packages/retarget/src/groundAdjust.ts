import { Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetRig } from './universal'
import type { UniversalBakeFrame } from './universalBake'

/** off = untouched; lift = raise the whole Action so no foot sinks below the rest floor; level = also lower a floating Action; frame = lift per frame (smoothed). */
export type GroundMode = 'off' | 'lift' | 'level' | 'frame'
export const GROUND_MODES: readonly GroundMode[] = ['off', 'lift', 'level', 'frame']
const FOOT = /(?:left|right)(?:foot|toebase)$/i
const SMOOTH_RADIUS = 2

export interface GroundReport { mode: GroundMode; restFloorMeters: number | null; actionFloorMeters: number | null; offsetMeters: number; maxOffsetMeters: number; applied: boolean; skipped?: 'OFFSET_TOO_LARGE' }
/** A lift beyond this share of the rest hips height means the root scale/units are wrong, not the ground: leave the Action alone. */
export const MAX_GROUND_OFFSET_HIPS_RATIO = 0.5

/** Lowest Y of the target rest feet/toes (the floor the rig stands on). */
export function restFootFloor(rig: RetargetRig): number | null {
  const ys = rig.bones.filter((bone) => FOOT.test((bone.name ?? '').replace(/\s/g, ''))).map((bone) => bone.restWorld[13]!)
  return ys.length ? Math.min(...ys) : null
}

/**
 * Moves the root (the joint without a baked parent, i.e. Hips) vertically so the lowest foot/toe of every frame stays on the
 * rest floor. Only the root local position and the cached world matrices change; every rotation is untouched.
 */
export function adjustGround(rig: RetargetRig, frames: UniversalBakeFrame[], mode: GroundMode): GroundReport {
  const restFloor = restFootFloor(rig)
  const none: GroundReport = { mode, restFloorMeters: restFloor, actionFloorMeters: null, offsetMeters: 0, maxOffsetMeters: 0, applied: false }
  if (mode === 'off' || restFloor === null || !frames.length) return none
  const footIds = new Set(rig.bones.filter((bone) => FOOT.test((bone.name ?? '').replace(/\s/g, ''))).map((bone) => bone.id))
  const floors = frames.map((frame) => Math.min(...frame.bones.filter((bone) => footIds.has(bone.targetBoneId)).map((bone) => bone.world[13]!)))
  if (floors.some((value) => !Number.isFinite(value))) return none
  const actionFloor = Math.min(...floors)
  let offsets: number[]
  if (mode === 'level') offsets = floors.map(() => restFloor - actionFloor)
  else if (mode === 'lift') offsets = floors.map(() => Math.max(0, restFloor - actionFloor))
  else {
    const need = floors.map((value) => Math.max(0, restFloor - value))
    // Window max then box blur: every smoothed value is still >= the raw need, so no frame sinks again.
    const widest = need.map((_, i) => Math.max(...need.slice(Math.max(0, i - SMOOTH_RADIUS), i + SMOOTH_RADIUS + 1)))
    offsets = widest.map((_, i) => { const win = widest.slice(Math.max(0, i - SMOOTH_RADIUS), i + SMOOTH_RADIUS + 1); return win.reduce((a, b) => a + b, 0) / win.length })
    offsets = offsets.map((value, i) => Math.max(value, need[i]!))
  }
  const maxOffset = Math.max(...offsets.map(Math.abs))
  if (maxOffset < 1e-6) return { ...none, actionFloorMeters: actionFloor }
  const hipsHeight = rig.bones.find((bone) => /hips$/i.test((bone.name ?? '').replace(/\s/g, '')))?.restWorld[13]
  if (hipsHeight && maxOffset > MAX_GROUND_OFFSET_HIPS_RATIO * hipsHeight) return { ...none, actionFloorMeters: actionFloor, maxOffsetMeters: maxOffset, skipped: 'OFFSET_TOO_LARGE' }
  frames.forEach((frame, index) => {
    const dy = offsets[index]!
    const root = frame.bones.find((bone) => { const parent = rig.bones.find((item) => item.id === bone.targetBoneId)?.parentId; return !parent || !frame.bones.some((other) => other.targetBoneId === parent) })
    if (!root) return
    const world = new Matrix4().fromArray(root.world), local = new Matrix4().compose(new Vector3().fromArray(root.position), new Quaternion().fromArray(root.rotation), new Vector3().fromArray(root.scale))
    const parentWorld = world.clone().multiply(local.clone().invert())
    const shifted = world.clone(); shifted.elements[13] = shifted.elements[13]! + dy
    const newLocal = parentWorld.clone().invert().multiply(shifted)
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
    newLocal.decompose(position, rotation, scale)
    root.position = position.toArray()
    for (const bone of frame.bones) bone.world = Object.assign([...bone.world], { 13: bone.world[13]! + dy })
  })
  return { mode, restFloorMeters: restFloor, actionFloorMeters: actionFloor, offsetMeters: mode === 'frame' ? Math.max(...offsets) : offsets[0]!, maxOffsetMeters: maxOffset, applied: true }
}
