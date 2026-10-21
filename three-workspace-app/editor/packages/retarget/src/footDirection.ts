import { Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetBonePair, RetargetPoseBone, RetargetRig, UniversalRetargetFrame } from './universal'
import type { UniversalCalibrationRuntime } from './universalCalibration'

const SIDES = ['Left', 'Right'] as const
const named = (rig: RetargetRig, part: string) => rig.bones.find((bone) => new RegExp(`${part}$`, 'i').test((bone.name ?? bone.id).replace(/\s/g, '')))

export interface FootDirectionPlan { side: string; targetFoot: string; sourceFoot: string; sourceToe: string; restDirection: Vector3; targetRestDirection: Vector3; targetRestQ: Quaternion; sourceReferenceQ: Quaternion; restHeading: Vector3 }

const pitchOf = (v: Vector3) => Math.atan2(v.y, Math.hypot(v.x, v.z))
const yawOf = (v: Vector3) => Math.atan2(v.x, v.z)
const fromAngles = (yaw: number, pitch: number) => new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
/** Below this horizontal share a heading has no usable yaw (foot rolled onto its side). */
const MIN_HORIZONTAL = 0.15

/**
 * Ankle→ball pitch is anatomy (WC3 orc rest 71°, Mixamo 39°) and source foot frames rotate about rig-specific axes, so
 * copying the foot's world rotation delta puts a target on tiptoe. Instead the target's own rest ankle→ball direction gets
 * the source's pitch change (from the ankle→ball direction) and yaw change (from the whole foot frame turning a horizontal
 * heading: the direction's own yaw is noise when the foot points steeply down), then the foot is swung onto it (roll dropped).
 */
export function planFootDirection(source: RetargetRig, target: RetargetRig, pairs: readonly RetargetBonePair[], calibration?: UniversalCalibrationRuntime): FootDirectionPlan[] {
  const reference = new Map((calibration?.sourceReference ?? source.bones.map((bone) => ({ id: bone.id, world: bone.restWorld }))).map((bone) => [bone.id, bone.world]))
  const alignment = calibration ? new Quaternion().fromArray([...calibration.alignmentRotation]) : new Quaternion()
  const sourceOf = (targetId: string) => pairs.find((pair) => pair.enabled && pair.targetBoneId === targetId)?.sourceBoneId
  return SIDES.flatMap((side) => {
    const foot = named(target, `${side}Foot`), toe = named(target, `${side}ToeBase`)
    const sourceFoot = foot && sourceOf(foot.id), sourceToe = toe && sourceOf(toe.id)
    if (!foot || !toe || !sourceFoot || !sourceToe || !reference.has(sourceFoot) || !reference.has(sourceToe)) return []
    const restDirection = new Vector3().fromArray(reference.get(sourceToe)!, 12).sub(new Vector3().fromArray(reference.get(sourceFoot)!, 12)).applyQuaternion(alignment)
    if (restDirection.lengthSq() < 1e-12) return []
    const targetRestQ = new Quaternion(); new Matrix4().fromArray(foot.restWorld).decompose(new Vector3(), targetRestQ, new Vector3())
    const targetRestDirection = new Vector3().fromArray(toe.restWorld, 12).sub(new Vector3().fromArray(foot.restWorld, 12))
    if (targetRestDirection.lengthSq() < 1e-12) return []
    const sourceReferenceQ = new Quaternion(); new Matrix4().fromArray(reference.get(sourceFoot)!).decompose(new Vector3(), sourceReferenceQ, new Vector3())
    const restHeading = new Vector3(restDirection.x, 0, restDirection.z)
    if (restHeading.lengthSq() < 1e-8) restHeading.set(0, 0, 1)
    return [{ side, targetFoot: foot.id, sourceFoot, sourceToe, restDirection: restDirection.normalize(), targetRestDirection: targetRestDirection.normalize(), targetRestQ,
      sourceReferenceQ: alignment.clone().multiply(sourceReferenceQ), restHeading: restHeading.normalize() }]
  })
}

/** Rewrites each planned foot's world rotation (position kept) and re-derives its descendants from their unchanged locals. */
export function applyFootDirection(plans: readonly FootDirectionPlan[], target: RetargetRig, sample: readonly RetargetPoseBone[], bones: UniversalRetargetFrame[], alignmentRotation?: readonly number[]) {
  if (!plans.length) return
  const alignment = alignmentRotation ? new Quaternion().fromArray([...alignmentRotation]) : new Quaternion()
  const pose = new Map(sample.map((bone) => [bone.id, bone.world]))
  const byId = new Map(bones.map((bone) => [bone.targetBoneId, bone]))
  const childrenOf = new Map<string, string[]>()
  for (const bone of target.bones) if (bone.parentId) childrenOf.set(bone.parentId, [...(childrenOf.get(bone.parentId) ?? []), bone.id])
  const localOf = (bone: UniversalRetargetFrame) => new Matrix4().compose(new Vector3().fromArray(bone.position), new Quaternion().fromArray(bone.rotation), new Vector3().fromArray(bone.scale))
  for (const plan of plans) {
    const foot = byId.get(plan.targetFoot), a = pose.get(plan.sourceFoot), b = pose.get(plan.sourceToe)
    if (!foot || !a || !b) continue
    const direction = new Vector3().fromArray(b, 12).sub(new Vector3().fromArray(a, 12)).applyQuaternion(alignment)
    if (direction.lengthSq() < 1e-12) continue
    direction.normalize()
    const poseQ = new Quaternion(); new Matrix4().fromArray(a).decompose(new Vector3(), poseQ, new Vector3())
    const turn = alignment.clone().multiply(poseQ).multiply(plan.sourceReferenceQ.clone().invert())
    const heading = plan.restHeading.clone().applyQuaternion(turn)
    const yawDelta = Math.hypot(heading.x, heading.z) < MIN_HORIZONTAL ? 0 : wrap(yawOf(heading) - yawOf(plan.restHeading))
    const wanted = fromAngles(yawOf(plan.targetRestDirection) + yawDelta, pitchOf(plan.targetRestDirection) + pitchOf(direction) - pitchOf(plan.restDirection))
    const swing = new Quaternion().setFromUnitVectors(plan.targetRestDirection, wanted.normalize())
    const world = new Matrix4().fromArray(foot.world), position = new Vector3(), scale = new Vector3()
    world.decompose(position, new Quaternion(), scale)
    const newWorld = new Matrix4().compose(position, swing.multiply(plan.targetRestQ).normalize(), scale)
    const parentWorld = world.clone().multiply(localOf(foot).invert())
    const local = parentWorld.clone().invert().multiply(newWorld)
    const p = new Vector3(), q = new Quaternion(), s = new Vector3(); local.decompose(p, q, s)
    foot.position = p.toArray(); foot.rotation = q.normalize().toArray(); foot.scale = s.toArray(); foot.world = newWorld.toArray()
    const stack = [...(childrenOf.get(plan.targetFoot) ?? [])].map((id) => [id, newWorld] as const)
    while (stack.length) {
      const [id, parent] = stack.pop()!, bone = byId.get(id)
      if (!bone) continue
      const childWorld = parent.clone().multiply(localOf(bone)); bone.world = childWorld.toArray()
      for (const grandchild of childrenOf.get(id) ?? []) stack.push([grandchild, childWorld])
    }
  }
}
