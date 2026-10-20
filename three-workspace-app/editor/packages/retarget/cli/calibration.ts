import { Matrix4, Quaternion, Vector3 } from 'three'
import type { UniversalCalibrationRuntime } from '../src/universalCalibration.ts'
import type { RetargetRig } from '../src/universal.ts'
import type { MappedJoint } from './autoMapping.ts'

export type CalibrationMode = 'limbs' | 'none'

/** Joint → child whose direction defines the bone. Parent-first order, so each swing sees its parent's correction. */
const LIMB_CHAINS: ReadonlyArray<readonly [string, readonly string[]]> = ['Left', 'Right'].flatMap((side) => [
  [`${side}Shoulder`, [`${side}Arm`]], [`${side}Arm`, [`${side}ForeArm`]], [`${side}ForeArm`, [`${side}Hand`]],
  [`${side}Hand`, [`${side}HandMiddle1`, `${side}HandIndex1`, `${side}HandRing1`]],
  ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((finger) => [1, 2].map((index) =>
    [`${side}Hand${finger}${index}`, [`${side}Hand${finger}${index + 1}`]] as const)),
  [`${side}UpLeg`, [`${side}Leg`]], [`${side}Leg`, [`${side}Foot`]], [`${side}Foot`, [`${side}ToeBase`]],
] as const)

/**
 * Measured yaw from the source facing to the target facing (facing = left-hip→right-hip axis × up, valid for A/T poses).
 * Only quarter turns are applied automatically — exporters rotate by multiples of 90°, while anything in between is
 * usually an authored stance (WC3 archer ≈45°) that must be kept. Off by >15° from a quarter turn → flagged ambiguous,
 * the nearest quarter turn (ties toward 0°) is used, and `--facing` can override.
 */
export function measureFacingYaw(source: RetargetRig, target: RetargetRig, joints: readonly MappedJoint[]): number {
  const byName = new Map(joints.map((joint) => [joint.target, joint]))
  const forward = (rig: RetargetRig, side: 'sourceId' | 'targetId') => {
    const at = (name: string) => new Vector3().fromArray(rig.bones.find((bone) => bone.id === byName.get(name)![side])!.restWorld, 12)
    const left = at('LeftUpLeg').sub(at('RightUpLeg')).setY(0)
    return new Vector3().crossVectors(left, new Vector3(0, 1, 0)).normalize()
  }
  const from = forward(source, 'sourceId'), to = forward(target, 'targetId')
  return Math.atan2(from.z * to.x - from.x * to.z, from.x * to.x + from.z * to.z) * 180 / Math.PI
}

export function resolveFacing(measuredDegrees: number, overrideDegrees?: number) {
  if (overrideDegrees !== undefined) return { degrees: overrideDegrees, ambiguous: false, source: 'override' as const }
  const turns = measuredDegrees / 90, lower = Math.floor(turns), upper = Math.ceil(turns)
  // Nearest quarter turn; an exact tie (45°) prefers the one closer to 0° so a stance is left untouched.
  const pick = Math.abs(turns - lower) === Math.abs(upper - turns) ? (Math.abs(lower) <= Math.abs(upper) ? lower : upper) : Math.round(turns)
  const degrees = (pick * 90 + 540) % 360 - 180 || 0
  return { degrees: degrees === -180 ? 180 : degrees, ambiguous: Math.abs(measuredDegrees - pick * 90) > 15, source: 'measured' as const }
}

/**
 * A/T calibration: builds a source reference pose whose limb directions match the target rest (e.g. A-pose arms swung
 * to the target T-pose). The solver then measures motion relative to that pose, so a source standing in its own rest
 * drives the target into the source's real limb directions instead of keeping the target rest. Swing only (no twist);
 * spine/neck keep the source rest so posture is not straightened. Facing alignment is always applied: without it world
 * deltas of a source turned 180° would swing limbs backwards and root travel would reverse.
 */
export function buildCalibration(source: RetargetRig, target: RetargetRig, joints: readonly MappedJoint[], mode: CalibrationMode, facingOverrideDegrees?: number) {
  const measured = measureFacingYaw(source, target, joints), facing = resolveFacing(measured, facingOverrideDegrees)
  const yaw = facing.degrees * Math.PI / 180
  const alignment = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), inverseAlignment = alignment.clone().invert()
  const world = new Map(source.bones.map((bone) => [bone.id, new Matrix4().fromArray(bone.restWorld)]))
  const children = new Map<string, string[]>()
  for (const bone of source.bones) if (bone.parentId) children.set(bone.parentId, [...(children.get(bone.parentId) ?? []), bone.id])
  const targetWorld = new Map(target.bones.map((bone) => [bone.id, new Matrix4().fromArray(bone.restWorld)]))
  const byName = new Map(joints.map((joint) => [joint.target, joint]))
  const position = (matrix: Matrix4) => new Vector3().setFromMatrixPosition(matrix)
  const corrections: Array<{ joint: string; degrees: number }> = []
  for (const [name, childNames] of mode === 'limbs' ? LIMB_CHAINS : []) {
    const joint = byName.get(name), child = childNames.map((childName) => byName.get(childName)).find((item) => item?.sourceId)
    if (!joint?.sourceId || !child?.sourceId) continue
    const pivot = position(world.get(joint.sourceId)!)
    const from = position(world.get(child.sourceId)!).sub(pivot), to = position(targetWorld.get(child.targetId)!).sub(position(targetWorld.get(joint.targetId)!))
    if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) continue
    // Compare in the target frame, then express the swing back in the source frame: qs = A⁻¹·q·A.
    const swingTarget = new Quaternion().setFromUnitVectors(from.normalize().applyQuaternion(alignment), to.normalize())
    const swing = inverseAlignment.clone().multiply(swingTarget).multiply(alignment)
    const degrees = 2 * Math.acos(Math.min(1, Math.abs(swing.w))) * 180 / Math.PI
    if (degrees < 0.01) continue
    corrections.push({ joint: name, degrees })
    const rotate = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new Matrix4().makeRotationFromQuaternion(swing))
      .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
    const stack = [joint.sourceId]
    while (stack.length) { const id = stack.pop()!; world.set(id, rotate.clone().multiply(world.get(id)!)); stack.push(...(children.get(id) ?? [])) }
  }
  const runtime: UniversalCalibrationRuntime = {
    sourceReference: source.bones.map((bone) => ({ id: bone.id, world: world.get(bone.id)!.toArray() })),
    targetReference: target.bones.map((bone) => ({ id: bone.id, world: bone.restWorld.slice() })),
    alignmentRotation: alignment.toArray() as [number, number, number, number], corrections: [],
  }
  return { runtime, corrections, facingYawDegrees: facing.degrees, measuredFacingYawDegrees: measured, facingAmbiguous: facing.ambiguous, facingSource: facing.source }
}
