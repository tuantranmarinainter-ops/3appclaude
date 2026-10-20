import assert from 'node:assert/strict'
import test from 'node:test'
import { AnimationClip, Bone, Group, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { createUniversalRetargeter } from '../src/universal.ts'
import { bakeUniversalRetargetFrames, universalFramesToAnimationClip } from '../src/universalBake.ts'

function sourceRig() {
  const asset = new Group(), motionRoot = new Group(), hips = new Bone(), chest = new Bone()
  asset.name = 'Asset'; motionRoot.name = 'MotionRoot'; hips.name = 'Pelvis'; chest.name = 'Chest'
  hips.position.y = 100; chest.position.y = 50
  asset.add(motionRoot); motionRoot.add(hips); hips.add(chest)
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  asset.animations = [new AnimationClip('MoveAndTurn', 1, [
    new VectorKeyframeTrack('MotionRoot.position', [0, 1], [0, 0, 0, 100, 0, 0]),
    new QuaternionKeyframeTrack('Pelvis.quaternion', [0, 1], [0, 0, 0, 1, ...turn.toArray()]),
  ])]
  return { asset, hips, chest }
}

test('samples inherited group motion in normalized units without mutating the source or wrapping endpoints', () => {
  const { asset } = sourceRig()
  const before = JSON.stringify(asset.toJSON())
  const adapter = createThreeRigAdapter(asset, { fingerprint: 'source-hash', sourceToScene: new Matrix4().makeScale(0.01, 0.01, 0.01).toArray() })
  assert.equal(adapter.rig.bones.length, 4)
  assert.equal(adapter.joints.length, 2)
  const chest = adapter.rig.bones.find((bone) => bone.name === 'Chest')!
  const endpoint = adapter.sample(0, 1).find((bone) => bone.id === chest.id)!.world
  assert.ok(new Vector3().setFromMatrixPosition(new Matrix4().fromArray(endpoint)).distanceTo(new Vector3(0.5, 1, 0)) < 1e-6)
  assert.ok(Math.abs(adapter.sample(0, 0.5)[1]!.world[12]! - 0.5) < 1e-6)
  assert.ok(Math.abs(adapter.sample(0, 0)[1]!.world[12]!) < 1e-6)
  assert.deepEqual(adapter.sample(0, 1).find((bone) => bone.id === chest.id)!.world, endpoint)
  assert.equal(JSON.stringify(asset.toJSON()), before)
  adapter.dispose()
  assert.throws(() => adapter.sample(0, 0), /disposed/)
})

test('connects a parsed source sampler to universal retarget and a playable target clip', () => {
  const { asset } = sourceRig()
  const adapter = createThreeRigAdapter(asset, { fingerprint: 'pipeline-source', sourceToScene: new Matrix4().makeScale(0.01, 0.01, 0.01).toArray() })
  const target = { fingerprint: 'other-proportions', bones: [
    { id: 'h', name: 'Hips', parentId: null, restWorld: new Matrix4().makeTranslation(0, 2, 0).toArray() },
    { id: 's', name: 'Spine', parentId: 'h', restWorld: new Matrix4().makeTranslation(0, 3, 0).toArray() },
  ] }
  const pairs = ['Pelvis', 'Chest'].map((name, index) => ({ sourceBoneId: adapter.rig.bones.find((bone) => bone.name === name)!.id, targetBoneId: index ? 's' : 'h', enabled: true }))
  const solver = createUniversalRetargeter(adapter.rig, target, pairs)
  const frames = bakeUniversalRetargetFrames(solver, (time) => adapter.sample(0, time), { startFrame: 0, endFrame: 30, fps: 30 })
  assert.ok(Math.abs(frames.at(-1)!.bones[0]!.world[12]! - 1) < 1e-6)
  assert.ok(Math.abs(frames.at(-1)!.bones[1]!.world[12]!) < 1e-6)
  const clip = universalFramesToAnimationClip(frames, 'Normalized')
  assert.equal(clip.duration, 1)
  assert.ok(clip.tracks.some((track) => track.name === 'Spine.quaternion'))
  adapter.dispose()
})

test('supports UUID-bound animation and explicit animation-only joints with no skin', () => {
  const root = new Group(), joint = new Group()
  joint.name = 'Hips'; root.add(joint)
  root.animations = [new AnimationClip('Translate', 1, [new VectorKeyframeTrack(`${joint.uuid}.position`, [0, 1], [0, 0, 0, 2, 0, 0])])]
  const before = root.animations[0]!.tracks[0]!.name
  const adapter = createThreeRigAdapter(root, { fingerprint: 'uuid', jointNames: ['Hips'] })
  assert.equal(adapter.sample(0, 1).find((bone) => bone.id === adapter.joints[0])!.world[12], 2)
  assert.equal(root.animations[0]!.tracks[0]!.name, before)
  assert.throws(() => adapter.sample(0, 1.01), /duration/)
  adapter.dispose()
})

test('selects and links duplicate-labeled skeleton nodes by source UUID', () => {
  const root = new Group(), first = new Bone(), selected = new Bone()
  first.name = selected.name = 'Joint'
  root.add(first, selected)
  const adapter = createThreeRigAdapter(root, { fingerprint: 'duplicate-labels', jointUUIDs: [selected.uuid] })
  assert.equal(adapter.joints.length, 1)
  assert.equal(adapter.nodeIdsBySourceUUID.get(selected.uuid), adapter.joints[0])
  assert.equal(adapter.nodeIdsBySourceUUID.has(first.uuid), false)
  adapter.dispose()
})

test('rejects ambiguous joints, non-rig tracks, reflection, and sheared source normalization', () => {
  const { asset } = sourceRig()
  const duplicate = new Group(); duplicate.name = 'Pelvis'; asset.add(duplicate)
  assert.throws(() => createThreeRigAdapter(asset, { fingerprint: 'ambiguous', jointNames: ['Pelvis'] }), /ambiguous/)
  assert.throws(() => createThreeRigAdapter(asset, { fingerprint: 'ambiguous' }), /Ambiguous animation node/)
  assert.throws(() => createThreeRigAdapter(asset, { fingerprint: 'reflection', sourceToScene: new Matrix4().makeScale(-1, 1, 1).toArray() }), /orientation-preserving/)
  assert.throws(() => createThreeRigAdapter(asset, { fingerprint: 'shear', sourceToScene: new Matrix4().makeScale(1, 2, 1).toArray() }), /uniform/)
  const clean = sourceRig().asset
  clean.animations[0]!.tracks.push(new VectorKeyframeTrack('Missing.position', [0, 1], [0, 0, 0, 1, 0, 0]))
  assert.throws(() => createThreeRigAdapter(clean, { fingerprint: 'unknown-channel' }), /outside selected rig/)
})

test('collects unsupported channel issues per action without blocking valid actions', () => {
  const { asset } = sourceRig()
  asset.animations = [asset.animations[0]!, new AnimationClip('Unsupported', 1, [
    new VectorKeyframeTrack('Missing.position', [0, 1], [0, 0, 0, 1, 0, 0]),
  ])]
  const adapter = createThreeRigAdapter(asset, { fingerprint: 'action-diagnostics', collectUnsupportedTracks: true })
  assert.equal(adapter.actions[0]!.ready, true)
  assert.equal(adapter.actions[1]!.ready, false)
  assert.equal(adapter.actions[1]!.issues[0]!.code, 'TRACK_OUTSIDE_SELECTED_RIG')
  assert.equal(adapter.sample(0, 1).length, adapter.rig.bones.length)
  assert.throws(() => adapter.sample(1, 1), /unsupported channels/)
  adapter.dispose()
})

test('samples a binary GLB decoded by the existing Three.js loader', async () => {
  const binary = Buffer.alloc(32)
  binary.writeFloatLE(1, 4); binary.writeFloatLE(1, 12); binary.writeFloatLE(2, 20); binary.writeFloatLE(1, 24)
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' },
    nodes: [{ name: 'Hips', translation: [0, 1, 0], children: [1] }, { name: 'Spine', translation: [0, 0.5, 0] }],
    scenes: [{ nodes: [0] }], scene: 0, skins: [{ joints: [0, 1] }], buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' }],
    animations: [{ name: 'Move', samplers: [{ input: 0, output: 1 }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }],
  }))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
  const glb = Buffer.alloc(28 + padded.length + binary.length)
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20)
  glb.writeUInt32LE(binary.length, 20 + padded.length); glb.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(glb, 28 + padded.length)
  const loaded = await new GLTFLoader().parseAsync(Uint8Array.from(glb).buffer, '')
  loaded.scene.animations = loaded.animations
  const adapter = createThreeRigAdapter(loaded.scene, { fingerprint: 'glb-container' })
  const hips = adapter.rig.bones.find((bone) => bone.name === 'Hips')!
  assert.equal(adapter.joints.length, 2)
  assert.ok(Math.abs(adapter.sample(0, 1).find((bone) => bone.id === hips.id)!.world[12]! - 2) < 1e-6)
  adapter.dispose()
})
