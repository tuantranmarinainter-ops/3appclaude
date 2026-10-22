import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { turnFilmSkeletonsByRotationKeys } from '../src/unifiedFilmSampling'

const identity = new Matrix4().toArray()
const placed = new Matrix4().makeTranslation(2, 0, 3).toArray()
const bone = new Matrix4().makeTranslation(2, 1, 4).toArray() // 1 up and 1 in front of the root
const scene = (rotationY: number | null, clip = true) => ({
  fcurves: { evalScalar: (_node: string, _path: string, axis: number) => axis === 1 ? rotationY : null },
  timeline: { animation: { motionClips: clip ? [{ target: { nodeId: 'hero' }, frameStart: 0, frameEnd: 30 }] : [], pathMotionClips: [] } },
  nodes: [{ id: 'hero', transform: { rotation: { x: 0, y: 0, z: 0 } } }],
}) as never
const sample = () => ({ frame: 10, side: 'right' as const, skeletonSamples: [{ nodeId: 'hero', metersPerUnit: 1,
  placementMatrix: [...placed], trajectoryMatrix: [...identity], actorWorldMatrix: [...placed],
  bones: [{ name: 'hips', position: [0, 1, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: [...bone] }] }] })
const position = (matrix: number[]) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(matrix)).toArray().map((v) => +v.toFixed(9))

test('turns an actor playing a motion clip by its rotation keys, about its own root', () => {
  const input = sample()
  turnFilmSkeletonsByRotationKeys(scene(90), input)
  const skeleton = input.skeletonSamples[0]!
  assert.deepEqual(position(skeleton.actorWorldMatrix), [2, 0, 3])
  // +90 degrees about Y takes "1 in front" (+Z) to +X; the bone stays in place relative to the actor.
  assert.deepEqual(position(skeleton.bones[0]!.worldMatrix), [3, 1, 3])
  const local = new Matrix4().fromArray(skeleton.actorWorldMatrix).invert().multiply(new Matrix4().fromArray(skeleton.bones[0]!.worldMatrix))
  assert.deepEqual(position(local.toArray()), [0, 1, 1])
})

test('leaves actors without rotation keys or without a motion clip unchanged', () => {
  for (const [rotationY, clip] of [[null, true], [0, true], [90, false]] as const) {
    const input = sample()
    turnFilmSkeletonsByRotationKeys(scene(rotationY, clip), input)
    assert.deepEqual(input.skeletonSamples[0]!.bones[0]!.worldMatrix, bone)
  }
})
