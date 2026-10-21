// Port of cli/toMinecraft20.ts: keep limb correction and measurements aligned with App 1.
import {Matrix4,Quaternion,Vector3} from 'three';
/** Upper → lower limb segments of the Minecraft20 rig (the right shin is spelled `low_leg_right`). */
const LIMBS = [['left_arm', 'low_left_arm'], ['right_arm', 'low_right_arm'], ['left_leg', 'low_left_leg'], ['right_leg', 'low_leg_right']]         
                                                    
const rotationOf = (matrix         ) => { const q = new Quaternion(); matrix.decompose(new Vector3(), q, new Vector3()); return q }
const degreesOf = (q            ) => 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI

/**
 * Lower-limb rotation relative to the upper limb, measured from the rest pose and split about the lower bone's own axis:
 * q = swing·twist. Minecraft limbs are boxes skinned across the elbow/knee, so a relative twist wrings the joint into a
 * wedge (the original Emoticons emotes stay ≤ ~11° even at 84° of elbow bend).
 */
function limbParts(armature          , worlds                              , upper        , lower        ) {
  const bone = (name        ) => armature.bones.find((item) => item.name === name) 
  const restUpper = rotationOf(new Matrix4().fromArray([...bone(upper).restWorld])), restLower = rotationOf(new Matrix4().fromArray([...bone(lower).restWorld]))
  const deltaUpper = rotationOf(worlds.get(upper) ).multiply(restUpper.clone().invert())
  const relative = deltaUpper.clone().invert().multiply(rotationOf(worlds.get(lower) ).multiply(restLower.clone().invert())).normalize()
  const axis = new Vector3(...bone(lower).localTail).normalize().applyQuaternion(restLower).normalize()
  const projected = new Vector3(relative.x, relative.y, relative.z).projectOnVector(axis)
  const twist = new Quaternion(projected.x, projected.y, projected.z, relative.w)
  if (twist.lengthSq() < 1e-12) twist.identity(); else twist.normalize()
  return { deltaUpper, restLower, twist, swing: relative.clone().multiply(twist.clone().invert()).normalize() }
}

/** Twist (degrees) of each lower limb relative to its upper limb in a world pose. */
export function limbTwistDegrees(armature          , worlds                              )                         {
  return Object.fromEntries(LIMBS.filter(([upper, lower]) => worlds.has(upper) && worlds.has(lower))
    .map(([upper, lower]) => [lower, degreesOf(limbParts(armature, worlds, upper, lower).twist)]))
}

/** Minecraft has no wrists or fingers: the hand tips follow the forearm rigidly (the 85 original emotes: p95 0°). */
const HANDS = ['low_left_arm.end', 'low_right_arm.end']         

/**
 * Hinge-like elbows/knees and rigid hands: keeps each lower limb's swing (its direction, hence elbow and hand
 * positions) and drops its twist about its own axis; the hand tips get their rest transform relative to the forearm
 * back (the Mixamo hand rotation is not applied at all). Every descendant is re-derived from its local transform.
 */
export function untwistLimbs(armature          , worlds                              ) {
  const result = new Map([...worlds].map(([name, world]) => [name, world.clone()]))
  const parentOf = new Map(armature.bones.map((bone) => [bone.name, bone.parent]))
  const locals = new Map(armature.bones.map((bone) => {
    const parent = bone.parent ? result.get(bone.parent) : undefined
    return [bone.name, parent ? parent.clone().invert().multiply(result.get(bone.name) ) : result.get(bone.name) .clone()]
  }))
  let maxBeforeDegrees = 0, maxHandDegrees = 0
  for (const hand of HANDS) {
    const bone = armature.bones.find((item) => item.name === hand)
    if (!bone || !locals.has(hand)) continue
    const restLocal = new Matrix4().fromArray([...bone.restLocal])
    maxHandDegrees = Math.max(maxHandDegrees, degreesOf(rotationOf(restLocal.clone().invert().multiply(locals.get(hand) ))))
    locals.set(hand, restLocal)
  }
  for (const [upper, lower] of LIMBS) {
    if (!result.has(upper) || !result.has(lower)) continue
    const { deltaUpper, restLower, twist, swing } = limbParts(armature, result, upper, lower)
    maxBeforeDegrees = Math.max(maxBeforeDegrees, degreesOf(twist))
    const position = new Vector3(), scale = new Vector3()
    result.get(lower) .decompose(position, new Quaternion(), scale)
    const world = new Matrix4().compose(position, deltaUpper.clone().multiply(swing).multiply(restLower).normalize(), scale)
    locals.set(lower, result.get(parentOf.get(lower) ) .clone().invert().multiply(world))
  }
  for (const bone of armature.bones) { // parents precede children in a BOBJ armature
    const parent = bone.parent ? result.get(bone.parent) : undefined
    result.set(bone.name, parent ? parent.clone().multiply(locals.get(bone.name) ) : locals.get(bone.name) .clone())
  }
  return { worlds: result, maxBeforeDegrees, maxHandDegrees }
}

