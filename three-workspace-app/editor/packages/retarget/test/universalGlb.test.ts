import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, PropertyBinding, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { universalFramesToGlb } from '../src/universalGlb.ts'
import { createUniversalRetargeter, type RetargetRig } from '../src/universal.ts'
import { bakeUniversalRetargetFrames } from '../src/universalBake.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'

function setup() {
  const worlds = new Map<string, Matrix4>()
  const target: RetargetRig = { fingerprint: 'canonical-target', bones: MIXAMO65_BONE_PARENTS.map(([name, parent]) => {
    const world = (parent ? worlds.get(parent)!.clone() : new Matrix4()).multiply(new Matrix4().makeTranslation(0, parent ? 0.1 : 1, 0))
    worlds.set(name, world)
    return { id: name, name: `mixamorig:${name}`, parentId: parent, restWorld: world.toArray() }
  }) }
  const source: RetargetRig = { fingerprint: 'source', bones: [{ id: 'pelvis', parentId: null, restWorld: new Matrix4().makeTranslation(0, 1, 0).toArray() }] }
  const solver = createUniversalRetargeter(source, target, [{ sourceBoneId: 'pelvis', targetBoneId: 'Hips', enabled: true }])
  const frames = bakeUniversalRetargetFrames(solver, (time) => [{ id: 'pelvis', world: new Matrix4().compose(new Vector3(time, 1, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), time), new Vector3(1, 1, 1)).toArray() }], { startFrame: 0, endFrame: 30, fps: 30 })
  return { target, frames, joints: target.bones.map((bone) => bone.id) }
}

test('exports canonical animation-only GLB and preserves poses after an actual GLTFLoader reimport', async () => {
  const { target, frames, joints } = setup()
  const before = JSON.stringify({ target, frames })
  const bytes = universalFramesToGlb(target, joints, frames, 'Retargeted')
  const loaded = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '')
  loaded.scene.animations = loaded.animations
  let meshes = 0
  loaded.scene.traverse((node) => { if ('isMesh' in node && node.isMesh) meshes++ })
  assert.equal(meshes, 0)
  const adapter = createThreeRigAdapter(loaded.scene, { fingerprint: 'roundtrip' })
  assert.equal(adapter.joints.length, 65)
  assert.equal(adapter.actions[0]!.name, 'Retargeted')
  assert.equal(adapter.actions[0]!.durationSeconds, 1)
  const names = new Map(adapter.rig.bones.map((bone) => [bone.name, bone.id]))
  for (const index of [0, 15, 30]) {
    const sample = new Map(adapter.sample(0, index / 30).map((bone) => [bone.id, bone.world]))
    for (const expected of frames[index]!.bones) {
      const actual = sample.get(names.get(PropertyBinding.sanitizeNodeName(expected.targetBoneName))!)!
      assert.ok(actual.every((value, axis) => Math.abs(value - expected.world[axis]!) < 1e-5), `${expected.targetBoneName} at frame ${index}`)
    }
  }
  assert.equal(JSON.stringify({ target, frames }), before)
  assert.deepEqual(universalFramesToGlb(target, joints, frames, 'Retargeted'), bytes)
  adapter.dispose()
})

test('rejects incomplete/noncanonical targets and malformed animation samples before exporting', () => {
  const { target, frames, joints } = setup()
  assert.throws(() => universalFramesToGlb(target, joints.slice(1), frames), /canonical/)
  const broken = structuredClone(frames)
  broken[1]!.bones.pop()
  assert.throws(() => universalFramesToGlb(target, joints, broken), /every target node/)
  const invalid = structuredClone(frames)
  invalid[0]!.bones[0]!.rotation = [0, 0, 0, 0]
  assert.throws(() => universalFramesToGlb(target, joints, invalid), /Invalid rotation/)
  assert.throws(() => universalFramesToGlb(target, joints, [frames[1]!, frames[0]!]), /increasing/)
})
