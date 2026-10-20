import assert from 'node:assert/strict'
import test from 'node:test'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { SkeletonFrameSample } from '@topview/3d-builder/skeleton'
import { bakeFilmPoseTracks } from '../src/filmPoseBake.ts'

const sourceBones = [
  { id: '0', name: 'root', parentId: null, rest: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
  { id: '1', name: 'spine', parentId: '0', rest: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
]
const unit = 0.01
const axis = new Matrix4().makeRotationY(Math.PI / 2)
const toRowMajor = (matrix: Matrix4) => Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, column) => matrix.elements[column * 4 + row]!)).flat()

function sample(tick: number, angle: number, actor = new Matrix4().makeTranslation(7, 2, -3)): SkeletonFrameSample {
  const root = new Matrix4().makeScale(unit, unit, unit)
  const spine = root.clone().multiply(new Matrix4().makeTranslation(0, 1, 0)).multiply(new Matrix4().makeRotationX(angle))
  return {
    nodeId: 'actor', metersPerUnit: unit, placementMatrix: actor.toArray(), trajectoryMatrix: new Matrix4().toArray(), actorWorldMatrix: actor.toArray(),
    bones: [
      { name: 'root', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: actor.clone().multiply(root).toArray() },
      { name: 'spine', position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: actor.clone().multiply(spine).toArray() },
    ],
  }
}

function model() {
  const rootRest = axis.clone().multiply(new Matrix4().makeScale(unit, unit, unit))
  const spineRest = rootRest.clone().multiply(new Matrix4().makeTranslation(0, 1, 0))
  return { modelId: 'unified/test', bones: [
    { name: 'root', parent: null, bobjRestMatrixRowMajor: toRowMajor(rootRest) },
    { name: 'spine', parent: 'root', bobjRestMatrixRowMajor: toRowMajor(spineRest) },
  ] }
}

test('converts source-unit bone samples to editable BOBJ local pose transforms', () => {
  const profile = model()
  const tracks = bakeFilmPoseTracks(sourceBones, unit, profile, [
    { tick: 0, skeleton: sample(0, 0) }, { tick: 1, skeleton: sample(1, Math.PI / 3) },
  ])
  assert.deepEqual(tracks.map((track) => track.boneName), ['root', 'spine'])
  assert.deepEqual(tracks[0]!.keyframes[0]!.r, [0, 0, 0])
  assert.deepEqual(tracks[1]!.keyframes[0]!.r, [0, 0, 0])
  const pose = tracks[1]!.keyframes[1]!
  assert.ok(Math.abs(pose.r[0] - Math.PI / 3) < 1e-9)
  assert.ok(Math.abs(pose.r[1]) < 1e-9 && Math.abs(pose.r[2]) < 1e-9)
  assert.deepEqual(pose.t, [0, 0, 0])
  assert.deepEqual(pose.s, [1, 1, 1])
  assert.deepEqual(pose.r2, [0, 0, 0])
  assert.deepEqual([pose.fix, pose.color, pose.lighting], [0, -1, 0])
})

test('bakes source-to-scene basis consistently with converter BOBJ rest matrices', () => {
  const basis = new Matrix4().makeRotationX(-Math.PI / 2)
  const basisValues = [basis.elements[0]!, basis.elements[4]!, basis.elements[8]!, basis.elements[1]!, basis.elements[5]!, basis.elements[9]!, basis.elements[2]!, basis.elements[6]!, basis.elements[10]!]
  const transformed = model()
  for (const bone of transformed.bones) {
    const values = bone.bobjRestMatrixRowMajor
    const rest = new Matrix4().set(values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!, values[6]!, values[7]!, values[8]!, values[9]!, values[10]!, values[11]!, values[12]!, values[13]!, values[14]!, values[15]!)
    bone.bobjRestMatrixRowMajor = toRowMajor(basis.clone().multiply(rest))
  }
  const samples = [sample(0, 0), sample(1, Math.PI / 3)]
  for (const frame of samples) {
    const actor = new Matrix4().fromArray(frame.actorWorldMatrix)
    for (const bone of frame.bones) bone.worldMatrix = actor.clone().multiply(basis).multiply(actor.clone().invert()).multiply(new Matrix4().fromArray(bone.worldMatrix)).toArray()
  }
  const tracks = bakeFilmPoseTracks(sourceBones, unit, transformed, samples.map((skeleton, tick) => ({ tick, skeleton })), basisValues)
  assert.deepEqual([tracks[0]!.keyframes[0]!.t, tracks[0]!.keyframes[0]!.r, tracks[0]!.keyframes[0]!.s], [[0, 0, 0], [0, 0, 0], [1, 1, 1]])
  assert.ok(Math.abs(tracks[1]!.keyframes[1]!.r[0] - Math.PI / 3) < 1e-9)
  assert.deepEqual(tracks[1]!.keyframes[1]!.t, [0, 0, 0])
})

test('converts sampled bone motion between source and BOBJ bind frames', () => {
  const offset = new Matrix4().makeTranslation(0, 1, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2))
  const targetRoot = axis.clone().multiply(new Matrix4().makeScale(unit, unit, unit))
  const target = { ...model(), bones: [
    model().bones[0]!,
    { name: 'spine', parent: 'root', bobjRestMatrixRowMajor: toRowMajor(targetRoot.clone().multiply(offset)) },
  ] }
  const angle = Math.PI / 3
  const tracks = bakeFilmPoseTracks(sourceBones, unit, target, [
    { tick: 0, skeleton: sample(0, 0) }, { tick: 1, skeleton: sample(1, angle) },
  ])
  const expectedFrame = new Matrix4().makeRotationZ(-Math.PI / 2)
    .multiply(new Matrix4().makeRotationX(angle)).multiply(new Matrix4().makeRotationZ(Math.PI / 2))
  const key = tracks[1]!.keyframes[1]!
  const actual = new Matrix4().compose(new Vector3(...key.t), new Quaternion().setFromEuler(new Euler(...key.r, 'ZYX')), new Vector3(...key.s))
  const rest = tracks[1]!.keyframes[0]!
  assert.deepEqual([rest.t, rest.r, rest.s], [[0, 0, 0], [0, 0, 0], [1, 1, 1]])
  assert.ok(actual.elements.every((value, index) => Math.abs(value - expectedFrame.elements[index]!) < 1e-9))
})

test('maps safe BOBJ bone IDs back to source names when baking pose tracks', () => {
  const base = model()
  const aliased = { ...base, bones: [
    { ...base.bones[0]!, name: 'bone0', sourceName: 'root' },
    { ...base.bones[1]!, name: 'bone1', sourceName: 'spine', parent: 'bone0' },
  ] }
  const tracks = bakeFilmPoseTracks(sourceBones, unit, aliased, [
    { tick: 0, skeleton: sample(0, 0) }, { tick: 1, skeleton: sample(1, Math.PI / 3) },
  ])
  assert.deepEqual(tracks.map((track) => track.boneName), ['bone0', 'bone1'])
  assert.ok(Math.abs(tracks[1]!.keyframes[1]!.r[0] - Math.PI / 3) < 1e-9)
})

test('propagates bind-frame conversion through nested bones', () => {
  const sources = [...sourceBones, { id: '2', name: 'hand', parentId: '1', rest: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }]
  const rootRest = axis.clone().multiply(new Matrix4().makeScale(unit, unit, unit))
  const spineSource = new Matrix4().makeTranslation(0, 1, 0)
  const spineTarget = spineSource.clone().multiply(new Matrix4().makeRotationZ(Math.PI / 2))
  const handLocal = new Matrix4().makeTranslation(0, 1, 0)
  const profile = { modelId: 'unified/nested', bones: [
    { name: 'root', parent: null, bobjRestMatrixRowMajor: toRowMajor(rootRest) },
    { name: 'spine', parent: 'root', bobjRestMatrixRowMajor: toRowMajor(rootRest.clone().multiply(spineTarget)) },
    { name: 'hand', parent: 'spine', bobjRestMatrixRowMajor: toRowMajor(rootRest.clone().multiply(spineTarget).multiply(handLocal)) },
  ] }
  const handSample = (tick: number, angle: number): SkeletonFrameSample => {
    const result = sample(tick, 0)
    const actor = new Matrix4().makeTranslation(7, 2, -3)
    const world = actor.clone().multiply(new Matrix4().makeScale(unit, unit, unit)).multiply(spineSource).multiply(handLocal).multiply(new Matrix4().makeRotationX(angle))
    result.bones.push({ name: 'hand', position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: world.toArray() })
    return result
  }
  const angle = Math.PI / 4
  const tracks = bakeFilmPoseTracks(sources, unit, profile, [
    { tick: 0, skeleton: handSample(0, 0) }, { tick: 1, skeleton: handSample(1, angle) },
  ])
  const conversion = handLocal.clone().invert().multiply(new Matrix4().makeRotationZ(-Math.PI / 2)).multiply(handLocal)
  const expectedFrame = conversion.clone().multiply(new Matrix4().makeRotationX(angle)).multiply(conversion.clone().invert())
  const key = tracks[2]!.keyframes[1]!
  const actual = new Matrix4().compose(new Vector3(...key.t), new Quaternion().setFromEuler(new Euler(...key.r, 'ZYX')), new Vector3(...key.s))
  assert.deepEqual([tracks[2]!.keyframes[0]!.t, tracks[2]!.keyframes[0]!.r, tracks[2]!.keyframes[0]!.s], [[0, 0, 0], [0, 0, 0], [1, 1, 1]])
  assert.ok(actual.elements.every((value, index) => Math.abs(value - expectedFrame.elements[index]!) < 1e-9))
})

test('unwraps Euler radians and rejects profile, sample, shear and hierarchy mismatch', () => {
  const wrapSamples = [-179, 179].map((degrees, tick) => ({ tick, skeleton: sample(tick, degrees * Math.PI / 180) }))
  const wrapped = bakeFilmPoseTracks(sourceBones, unit, model(), wrapSamples)
  assert.ok(Math.abs(wrapped[1]!.keyframes[1]!.r[0] + 181 * Math.PI / 180) < 1e-9)
  assert.throws(() => bakeFilmPoseTracks(sourceBones, unit, { ...model(), bones: model().bones.slice(0, 1) }, [{ tick: 0, skeleton: sample(0, 0) }]), /profile does not match/)
  assert.throws(() => bakeFilmPoseTracks(sourceBones, unit, model(), [{ tick: 1, skeleton: sample(1, 0) }]), /consecutive integer/)
  const wrongRest = model(); wrongRest.bones[1]!.bobjRestMatrixRowMajor[7]! += 0.1
  const calibrated = bakeFilmPoseTracks(sourceBones, unit, wrongRest, [{ tick: 0, skeleton: sample(0, 0) }])
  assert.deepEqual([calibrated[1]!.keyframes[0]!.t, calibrated[1]!.keyframes[0]!.r, calibrated[1]!.keyframes[0]!.s], [[0, 0, 0], [0, 0, 0], [1, 1, 1]])
  const scaledRest = model(); scaledRest.bones[1]!.bobjRestMatrixRowMajor[2]! *= 2
  assert.throws(() => bakeFilmPoseTracks(sourceBones, unit, scaledRest, [{ tick: 0, skeleton: sample(0, 0) }]), /bind frame must be rigid/)
  const sheared = sample(0, 0); sheared.bones[1]!.worldMatrix[4] = 0.2
  assert.throws(() => bakeFilmPoseTracks(sourceBones, unit, model(), [{ tick: 0, skeleton: sheared }]), /shear/)
  const disconnected = model(); disconnected.bones[1]!.parent = null
  assert.throws(() => bakeFilmPoseTracks(sourceBones, unit, disconnected, [{ tick: 0, skeleton: sample(0, 0) }]), /names or parents differ/)
})

test('cancels actor placement before producing model-space pose channels', () => {
  const actor = new Matrix4().compose(new Vector3(20, -4, 8), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7), new Vector3(2, 2, 2))
  const moved = sample(0, 0, actor)
  const tracks = bakeFilmPoseTracks(sourceBones, unit, model(), [{ tick: 0, skeleton: moved }])
  for (const track of tracks) {
    assert.ok(track.keyframes[0]!.t.every((value) => Math.abs(value) < 1e-9))
    assert.ok(track.keyframes[0]!.r.every((value) => Math.abs(value) < 1e-9))
  }
})
