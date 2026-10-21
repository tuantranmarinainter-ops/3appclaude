import { Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetBonePair, RetargetPoseBone, RetargetRig, UniversalRetargetFrame } from './universal'
import type { UniversalCalibrationRuntime } from './universalCalibration'

const SIDES = ['Left', 'Right'] as const
const named = (rig: RetargetRig, part: string) => rig.bones.find((bone) => new RegExp(`${part}$`, 'i').test((bone.name ?? bone.id).replace(/\s/g, '')))

/** A target bone driven by a source segment: it is swung so its own rest direction gets the segment's yaw/pitch change. */
interface Segment { target: string; from: string; to: string; restDirection: Vector3; targetRestDirection: Vector3; targetRestQ: Quaternion }
export interface FootDirectionPlan { side: string; foot: Segment; sole: Segment | null; yawFrom: string; yawReferenceQ: Quaternion }

const pitchOf = (v: Vector3) => Math.atan2(v.y, Math.hypot(v.x, v.z))
const yawOf = (v: Vector3) => Math.atan2(v.x, v.z)
const fromAngles = (yaw: number, pitch: number) => new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const rotationOf = (values: readonly number[]) => { const q = new Quaternion(); new Matrix4().fromArray([...values]).decompose(new Vector3(), q, new Vector3()); return q }
const positionOf = (values: readonly number[]) => new Vector3().fromArray(values, 12)
/** Rest ankle→ball pitches closer than this count as the same foot shape: no rewrite needed. */
const SAME_FOOT_DEGREES = 10

/**
 * Ankle→ball pitch is anatomy (WC3 orc rest 71°, Mixamo 39°), so copying the foot's world rotation puts a target on tiptoe.
 * The target's own rest directions get the source's changes instead (roll dropped):
 * - Foot (ankle→ball): pitch change of the source ankle→ball;
 * - ToeBase (ball→tip), when both rigs have a tip: pitch change of the source sole (ball→tip; on WC3 the flat part);
 * - yaw change for both: the twist about world up of the source ball joint's frame. The steep ankle→ball direction's own
 *   yaw is noise (it made feet twitch), and the ankle frame lagged the source's turned-out stance (WC3 right foot −16° vs −42°).
 */
export function planFootDirection(source: RetargetRig, target: RetargetRig, pairs: readonly RetargetBonePair[], calibration?: UniversalCalibrationRuntime): FootDirectionPlan[] {
  const reference = new Map((calibration?.sourceReference ?? source.bones.map((bone) => ({ id: bone.id, world: bone.restWorld }))).map((bone) => [bone.id, bone.world]))
  const alignment = calibration ? new Quaternion().fromArray([...calibration.alignmentRotation]) : new Quaternion()
  const sourceOf = (targetId: string) => pairs.find((pair) => pair.enabled && pair.targetBoneId === targetId)?.sourceBoneId
  const segment = (bone: RetargetRig['bones'][number], tip: RetargetRig['bones'][number], from: string, to: string): Segment | null => {
    if (!reference.has(from) || !reference.has(to)) return null
    const restDirection = positionOf(reference.get(to)!).sub(positionOf(reference.get(from)!)).applyQuaternion(alignment)
    const targetRestDirection = positionOf(tip.restWorld).sub(positionOf(bone.restWorld))
    if (restDirection.lengthSq() < 1e-12 || targetRestDirection.lengthSq() < 1e-12) return null
    return { target: bone.id, from, to, restDirection: restDirection.normalize(), targetRestDirection: targetRestDirection.normalize(), targetRestQ: rotationOf(bone.restWorld) }
  }
  return SIDES.flatMap((side) => {
    const foot = named(target, `${side}Foot`), toe = named(target, `${side}ToeBase`), toeEnd = named(target, `${side}Toe_?End`)
    const sourceFoot = foot && sourceOf(foot.id), sourceToe = toe && sourceOf(toe.id)
    if (!foot || !toe || !sourceFoot || !sourceToe) return []
    const footSegment = segment(foot, toe, sourceFoot, sourceToe)
    if (!footSegment) return []
    // Feet shaped alike (Mixamo→Mixamo) keep the solver's full rotation, roll included.
    if (Math.abs(pitchOf(footSegment.restDirection) - pitchOf(footSegment.targetRestDirection)) * 180 / Math.PI < SAME_FOOT_DEGREES) return []
    // Source tip: the child of the ball joint farthest from it (WC3 foot_L0_1, Mixamo Toe_End).
    const ball = positionOf(source.bones.find((bone) => bone.id === sourceToe)!.restWorld)
    const tip = source.bones.filter((bone) => bone.parentId === sourceToe)
      .sort((a, b) => positionOf(b.restWorld).distanceTo(ball) - positionOf(a.restWorld).distanceTo(ball))[0]
    const sole = tip && toeEnd ? segment(toe, toeEnd, sourceToe, tip.id) : null
    return [{ side, foot: footSegment, sole, yawFrom: sourceToe, yawReferenceQ: alignment.clone().multiply(rotationOf(reference.get(sourceToe)!)) }]
  })
}

/** Rewrites the planned feet/toes' world rotations (positions kept) and re-derives descendants from their unchanged locals. */
export function applyFootDirection(plans: readonly FootDirectionPlan[], target: RetargetRig, sample: readonly RetargetPoseBone[], bones: UniversalRetargetFrame[], alignmentRotation?: readonly number[]) {
  if (!plans.length) return
  const alignment = alignmentRotation ? new Quaternion().fromArray([...alignmentRotation]) : new Quaternion()
  const pose = new Map(sample.map((bone) => [bone.id, bone.world]))
  const byId = new Map(bones.map((bone) => [bone.targetBoneId, bone]))
  const childrenOf = new Map<string, string[]>()
  for (const bone of target.bones) if (bone.parentId) childrenOf.set(bone.parentId, [...(childrenOf.get(bone.parentId) ?? []), bone.id])
  const localOf = (bone: UniversalRetargetFrame) => new Matrix4().compose(new Vector3().fromArray(bone.position), new Quaternion().fromArray(bone.rotation), new Vector3().fromArray(bone.scale))
  const posed = (item: Segment) => {
    const a = pose.get(item.from), b = pose.get(item.to)
    if (!a || !b) return null
    const direction = positionOf(b).sub(positionOf(a)).applyQuaternion(alignment)
    return direction.lengthSq() < 1e-12 ? null : direction.normalize()
  }
  const swingTo = (item: Segment, yawDelta: number, pitchDelta: number) => {
    const bone = byId.get(item.target)
    if (!bone) return
    const wanted = fromAngles(yawOf(item.targetRestDirection) + yawDelta, pitchOf(item.targetRestDirection) + pitchDelta).normalize()
    const swing = new Quaternion().setFromUnitVectors(item.targetRestDirection, wanted)
    const world = new Matrix4().fromArray(bone.world), position = new Vector3(), scale = new Vector3()
    world.decompose(position, new Quaternion(), scale)
    const newWorld = new Matrix4().compose(position, swing.multiply(item.targetRestQ).normalize(), scale)
    const local = world.clone().multiply(localOf(bone).invert()).invert().multiply(newWorld)
    const p = new Vector3(), q = new Quaternion(), s = new Vector3(); local.decompose(p, q, s)
    bone.position = p.toArray(); bone.rotation = q.normalize().toArray(); bone.scale = s.toArray(); bone.world = newWorld.toArray()
    const stack = (childrenOf.get(item.target) ?? []).map((id) => [id, newWorld] as const)
    while (stack.length) {
      const [id, parent] = stack.pop()!, child = byId.get(id)
      if (!child) continue
      const childWorld = parent.clone().multiply(localOf(child)); child.world = childWorld.toArray()
      for (const grandchild of childrenOf.get(id) ?? []) stack.push([grandchild, childWorld])
    }
  }
  for (const plan of plans) {
    const footDirection = posed(plan.foot)
    if (!footDirection) continue
    const soleDirection = plan.sole ? posed(plan.sole) : null
    // Yaw = twist about world up of the source ball joint's turn (the sole lies on it). A twist is defined and continuous
    // even when the toes point straight down, unlike the yaw of a direction (that jumped up to 150° per frame).
    const ball = pose.get(plan.yawFrom)
    const turn = ball ? alignment.clone().multiply(rotationOf(ball)).multiply(plan.yawReferenceQ.clone().invert()).normalize() : new Quaternion()
    const yawDelta = wrap(2 * Math.atan2(turn.y, turn.w))
    swingTo(plan.foot, yawDelta, pitchOf(footDirection) - pitchOf(plan.foot.restDirection))
    if (plan.sole && soleDirection) swingTo(plan.sole, yawDelta, pitchOf(soleDirection) - pitchOf(plan.sole.restDirection))
  }
}
