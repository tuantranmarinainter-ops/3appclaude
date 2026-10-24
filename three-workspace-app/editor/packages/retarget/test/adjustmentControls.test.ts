import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { adjustFrames, resolveAdjustments } from '../src/adjustments.ts'
import { HAND_REFERENCE_POSES } from '../src/handReferencePoses.ts'
import type { RetargetRig } from '../src/universal.ts'
import type { UniversalBakeFrame } from '../src/universalBake.ts'

const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
const rig: RetargetRig = { fingerprint: 'controls', bones: [
  { id: 'Hips', name: 'Hips', parentId: null, restWorld: new Matrix4().makeRotationFromQuaternion(q).toArray() },
  { id: 'LeftHandIndex1', name: 'LeftHandIndex1', parentId: 'Hips', restWorld: new Matrix4().makeRotationFromQuaternion(q).toArray() },
  { id: 'RightHandIndex1', name: 'RightHandIndex1', parentId: 'Hips', restWorld: new Matrix4().makeRotationFromQuaternion(q).toArray() },
] }
const frame = (): UniversalBakeFrame => ({ frame: 0, timeSeconds: 0, bones: rig.bones.map((b, i) => ({ targetBoneId: b.id, targetBoneName: b.name,
  position: [0, 0, 0], rotation: i ? [0, 0, 0, 1] : q.toArray(), scale: [1, 1, 1], world: b.restWorld.slice() })) })

test('joint rotations use local, World, or the chosen node axes', () => {
  const results = ['local', 'world', 'Hips'].map(axes => {
    const frames = [frame()]
    adjustFrames(rig, frames, resolveAdjustments({ jointOffsets: { LeftHandIndex1: [90, 0, 0] }, jointAxes: { LeftHandIndex1: axes } }))
    return new Quaternion().fromArray(frames[0]!.bones[1]!.rotation)
  })
  assert.ok(results[0]!.angleTo(results[1]!) > 1)
  assert.ok(results[0]!.angleTo(results[2]!) < 1e-7)
  assert.throws(() => adjustFrames(rig, [frame()], resolveAdjustments({ jointOffsets: { LeftHandIndex1: [1, 0, 0] }, jointAxes: { LeftHandIndex1: 'Missing' } })), /Unknown joint/)
})

test('hand references are normalized, scoped and strength blends from the animation', () => {
  for (const pose of Object.values(HAND_REFERENCE_POSES)) {
    assert.ok(Object.keys(pose).length >= 30)
    for (const value of Object.values(pose)) assert.ok(Math.abs(new Quaternion().fromArray(value).length() - 1) < 1e-8)
  }
  for (const handPose of ['natural', 'fist'] as const) {
    const frames = [frame()]
    adjustFrames(rig, frames, resolveAdjustments({ handPose, handStrength: 0.5, handSide: 'left' }))
    const actual = new Quaternion().fromArray(frames[0]!.bones[1]!.rotation)
    const expected = new Quaternion().slerp(new Quaternion().fromArray(HAND_REFERENCE_POSES[handPose]!.lefthandindex1!), 0.5).normalize()
    assert.ok(actual.angleTo(expected) < 1e-7)
    assert.deepEqual(frames[0]!.bones[2]!.rotation, [0, 0, 0, 1])
  }
  assert.throws(() => resolveAdjustments({ handStrength: 2 }), /handStrength/)
  assert.throws(() => resolveAdjustments({ jointAxes: [] as any }), /jointAxes/)
  assert.throws(() => resolveAdjustments({ handPose: 'unknown' as any }), /handPose/)
})
