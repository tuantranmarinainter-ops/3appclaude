import { Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetBonePair, RetargetRig, UniversalRetargetFrame } from './universal'

/**
 * LoL and WoW fingers have two joints (knuckle + middle); Mixamo has three. The unmapped distal joint kept its rest, so a
 * clenched source fist left the target fingertips straight. Anatomically the distal joint bends about two thirds of the
 * middle joint, so it receives that share of the middle joint's rotation away from rest (same delta, its own rest frame:
 * the phalanges of one Mixamo finger share an orientation). Rigs with a mapped third joint (Mixamo, WC3) are untouched.
 */
export const DISTAL_FROM_MIDDLE = 2 / 3
const SIDES = ['Left', 'Right'] as const
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const

export interface FingerCurlPlan { finger: string; middle: string; distal: string; middleRestQ: Quaternion; distalRestQ: Quaternion }

const rotationOf = (values: readonly number[]) => { const q = new Quaternion(); new Matrix4().fromArray([...values]).decompose(new Vector3(), q, new Vector3()); return q }

export function planFingerCurl(target: RetargetRig, pairs: readonly RetargetBonePair[]): FingerCurlPlan[] {
  const mapped = new Set(pairs.filter((pair) => pair.enabled).map((pair) => pair.targetBoneId))
  const byId = new Map(target.bones.map((bone) => [bone.id, bone]))
  const named = (name: string) => target.bones.find((bone) => (bone.name ?? bone.id).split(':').pop()!.replace(/^mixamorig\d*/i, '') === name)
  const restLocal = (id: string) => {
    const bone = byId.get(id)!, parent = bone.parentId ? byId.get(bone.parentId) : undefined
    const world = new Matrix4().fromArray(bone.restWorld)
    return rotationOf((parent ? new Matrix4().fromArray(parent.restWorld).invert().multiply(world) : world).toArray())
  }
  return SIDES.flatMap((side) => FINGERS.flatMap((finger): FingerCurlPlan[] => {
    const middle = named(`${side}Hand${finger}2`), distal = named(`${side}Hand${finger}3`)
    if (!middle || !distal || distal.parentId !== middle.id || !mapped.has(middle.id) || mapped.has(distal.id)) return []
    return [{ finger: `${side}Hand${finger}`, middle: middle.id, distal: distal.id, middleRestQ: restLocal(middle.id), distalRestQ: restLocal(distal.id) }]
  }))
}

export function applyFingerCurl(plans: readonly FingerCurlPlan[], target: RetargetRig, bones: UniversalRetargetFrame[]) {
  if (!plans.length) return
  const byId = new Map(bones.map((bone) => [bone.targetBoneId, bone]))
  const childrenOf = new Map<string, string[]>()
  for (const bone of target.bones) if (bone.parentId) childrenOf.set(bone.parentId, [...(childrenOf.get(bone.parentId) ?? []), bone.id])
  const localOf = (bone: UniversalRetargetFrame) => new Matrix4().compose(new Vector3().fromArray(bone.position), new Quaternion().fromArray(bone.rotation), new Vector3().fromArray(bone.scale))
  for (const plan of plans) {
    const middle = byId.get(plan.middle), distal = byId.get(plan.distal)
    if (!middle || !distal) continue
    const bend = plan.middleRestQ.clone().invert().multiply(new Quaternion().fromArray(middle.rotation)).normalize()
    const share = new Quaternion().slerp(bend, DISTAL_FROM_MIDDLE)
    distal.rotation = plan.distalRestQ.clone().multiply(share).normalize().toArray()
    const stack = [[plan.distal, new Matrix4().fromArray(middle.world)] as const]
    while (stack.length) {
      const [id, parent] = stack.pop()!, bone = byId.get(id)
      if (!bone) continue
      const world = parent.clone().multiply(localOf(bone)); bone.world = world.toArray()
      for (const child of childrenOf.get(id) ?? []) stack.push([child, world])
    }
  }
}
