import assert from 'node:assert/strict'
import test from 'node:test'
import { AnimationClip, Bone, Group, VectorKeyframeTrack } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'
import { normalizeAnimation } from '../src/normalizeAnimation.ts'

function fixture(duration = 0.105) {
  const source = new Group(), pelvis = new Bone(); pelvis.name = 'Pelvis'; pelvis.position.y = 1; source.add(pelvis)
  source.animations = [new AnimationClip('Fractional endpoint', duration, [new VectorKeyframeTrack('Pelvis.position', [0, duration], [0, 1, 0, 2, 1, 0])])]
  const target = new Group(), bones = new Map<string, Bone>()
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) {
    const bone = new Bone(); bone.name = name; bone.position.y = parent ? 0.1 : 1
    ;(parent ? bones.get(parent)! : target).add(bone); bones.set(name, bone)
  }
  const sourceOptions = { fingerprint: 'original' }, targetOptions = { fingerprint: 'target-rest' }
  const a = createThreeRigAdapter(source, sourceOptions), b = createThreeRigAdapter(target, targetOptions)
  const pairs = [{ sourceBoneId: a.rig.bones.find((bone) => bone.name === 'Pelvis')!.id,
    targetBoneId: b.rig.bones.find((bone) => bone.name === 'Hips')!.id, enabled: true }]
  a.dispose(); b.dispose()
  return { source, target, sourceOptions, targetOptions, pairs, actionIndex: 0, fps: 30 }
}

test('normalization retains fractional duration and final root displacement through GLB roundtrip', async () => {
  const input = fixture(), original = JSON.stringify(input.source.toJSON())
  const output = await normalizeAnimation(input)
  assert.equal(output.report.sampleCount, 5)
  assert.equal(output.report.targetJointCount, 65)
  assert.equal(output.report.outputMode, 'animation-only')
  assert.equal(output.report.metrics.sampledFrames, output.report.sampleCount)
  assert.ok(output.report.metrics.rootTranslationMaxErrorMeters < 1e-6)
  assert.equal(output.report.metrics.contactDrift, null)
  const loaded = await new GLTFLoader().parseAsync(Uint8Array.from(output.bytes).buffer, '')
  loaded.scene.animations = loaded.animations
  assert.ok(Math.abs(loaded.animations[0]!.duration - 0.105) < 1e-7)
  const adapter = createThreeRigAdapter(loaded.scene, { fingerprint: 'reimported' })
  const hips = adapter.rig.bones.find((bone) => bone.name === 'Hips')!
  assert.ok(Math.abs(adapter.sample(0, adapter.actions[0]!.durationSeconds).find((bone) => bone.id === hips.id)!.world[12]! - 2) < 1e-6)
  adapter.dispose()
  assert.equal(JSON.stringify(input.source.toJSON()), original)
})

test('normalization cancels in flight and rejects oversized jobs or missing mappings', async () => {
  const controller = new AbortController()
  const pending = normalizeAnimation(fixture(3), controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  await assert.rejects(normalizeAnimation(fixture(1000)), /sample budget/)
  await assert.rejects(normalizeAnimation({ ...fixture(), requiredTargetJointIds: ['missing'] }), /required target mappings/)
})

test('rejects expensive rigs from their node-sample budget before the frame loop', async () => {
  const input = fixture(599.9)
  for (let index = 0; index < 3_000; index += 1) {
    const helper = new Bone(); helper.name = `Auxiliary_${index}`; input.source.add(helper)
  }
  await assert.rejects(normalizeAnimation(input), /node-sample or estimated-memory budget/)
})

test('in-place normalization removes root travel and records policy without mutating source', async () => {
  const input = fixture(1), before = JSON.stringify(input.source.toJSON())
  const output = await normalizeAnimation({ ...input, rootTranslationPolicy: 'in-place' })
  assert.equal(output.report.rootTranslationPolicy, 'in-place')
  const loaded = await new GLTFLoader().parseAsync(Uint8Array.from(output.bytes).buffer, '')
  loaded.scene.animations = loaded.animations
  const adapter = createThreeRigAdapter(loaded.scene, { fingerprint: 'in-place-result' })
  const hips = adapter.rig.bones.find((bone) => bone.name === 'Hips')!
  assert.ok(Math.abs(adapter.sample(0, 1).find((bone) => bone.id === hips.id)!.world[12]!) < 1e-6)
  assert.equal(JSON.stringify(input.source.toJSON()), before)
  adapter.dispose()
})
