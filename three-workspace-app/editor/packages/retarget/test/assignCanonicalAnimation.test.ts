import assert from 'node:assert/strict'
import test from 'node:test'
import { AnimationClip, Bone, Group, Vector3, VectorKeyframeTrack } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { assignCanonicalAnimation } from '../src/assignCanonicalAnimation.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'

function rig(length: number, prefix: string, rotated: boolean) {
  const root = new Group(), bones = new Map<string, Bone>()
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) {
    const bone = new Bone(); bone.name = `${prefix}${name}`; bone.position.y = parent ? length : 1
    if (rotated && name === 'Spine') bone.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3)
    ;(parent ? bones.get(parent)! : root).add(bone); bones.set(name, bone)
  }
  return root
}

test('assigns canonical motion onto a different rest/length receiver without changing either source', async () => {
  const source = rig(0.1, '', false), target = rig(0.25, 'mixamorig', true)
  source.animations = [new AnimationClip('Travel', 1, [new VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 2, 1, 0])])]
  const before = JSON.stringify([source.toJSON(), target.toJSON()])
  const output = await assignCanonicalAnimation({ source, target, sourceOptions: { fingerprint: 'source' }, targetOptions: { fingerprint: 'receiver' }, actionIndex: 0, fps: 30 })
  assert.equal(output.assignment.matchedJoints, 65)
  const loaded = await new GLTFLoader().parseAsync(Uint8Array.from(output.bytes).buffer, '')
  loaded.scene.animations = loaded.animations
  const adapter = createThreeRigAdapter(loaded.scene, { fingerprint: 'assigned' })
  const sample = adapter.sample(0, 1)
  const hips = adapter.rig.bones.find((bone) => bone.name === 'mixamorigHips')!, spine = adapter.rig.bones.find((bone) => bone.name === 'mixamorigSpine')!
  assert.ok(Math.abs(sample.find((bone) => bone.id === hips.id)!.world[12]! - 2) < 1e-6)
  const spineWorld = sample.find((bone) => bone.id === spine.id)!.world
  assert.ok(Math.abs(spineWorld[13]! - 1.25) < 1e-6)
  assert.ok(Math.abs(spineWorld[0]! - Math.cos(Math.PI / 3)) < 1e-6)
  assert.equal(JSON.stringify([source.toJSON(), target.toJSON()]), before)
  adapter.dispose()
})

test('assignment rejects noncanonical source instead of bypassing normalization', async () => {
  const source = new Group(), hips = new Bone(); hips.name = 'Hips'; source.add(hips)
  await assert.rejects(assignCanonicalAnimation({ source, target: rig(0.1, '', false), sourceOptions: { fingerprint: 'incomplete' }, targetOptions: { fingerprint: 'target' }, actionIndex: 0, fps: 30 }), /canonical/)
})
