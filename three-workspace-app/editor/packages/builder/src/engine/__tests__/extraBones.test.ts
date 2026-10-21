import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { CharacterAnimator, MotionPlayer } from '../objects/MotionPlayer'
import { extraJointHandleSpecs, resolveHandleBones, solveJointAim, applyRelativeJoint } from '../interact/joints/jointPosing'
import { JointHandleLayer } from '../interact/joints/JointHandleLayer'

function rig(prefix = '') {
  const root = new THREE.Group()
  const hips = new THREE.Bone(); hips.name = `${prefix}Hips`; hips.position.y = 1; root.add(hips)
  let parent = hips
  for (const name of ['X_Hips_Tail1', 'X_Hips_Tail2', 'X_Hips_Tail3', 'X_Head_Jaw']) {
    const bone = new THREE.Bone(); bone.name = prefix + name; bone.position.set(0, 0.2, 0); parent.add(bone); parent = bone
  }
  return root
}

for (const [prefix, targetPrefix] of [['', ''], ['mixamorig:', ''], ['', 'mixamorig']]) test(`extra motion direct bind (${prefix || 'bare'} → ${targetPrefix || 'bare'})`, () => {
  const source = rig(prefix), target = rig(targetPrefix), player = new MotionPlayer()
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 6)
  source.animations = [new THREE.AnimationClip('tail', 1, [new THREE.QuaternionKeyframeTrack(`${prefix}X_Hips_Tail1.quaternion`, [0, 1], [0, 0, 0, 1, ...q.toArray()])])]
  player.register('tail', source)
  const animator = new CharacterAnimator(target)
  animator.playAt('tail', player.getClipForDirectBind('tail', target)!, 1, false)
  const tail = target.getObjectByName(targetPrefix + 'X_Hips_Tail1')!
  assert.ok(tail.quaternion.angleTo(q) * 180 / Math.PI <= 0.5)
  source.animations = [new THREE.AnimationClip('v1.0', 1, [new THREE.QuaternionKeyframeTrack(`${prefix}Hips.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])])]
  player.register('old', source)
  animator.playAt('old', player.getClipForDirectBind('old', target)!, 1, false)
  assert.ok(tail.quaternion.angleTo(new THREE.Quaternion()) < 1e-6)
})

test('all extra joints, including leaf jaw, have aim handles without changing skeleton hierarchy', () => {
  const root = rig(), before: string[] = []
  root.traverse(obj => before.push(obj.uuid))
  const rest = new Map<string, THREE.Quaternion>(); root.traverse(obj => rest.set(obj.name, obj.quaternion.clone()))
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.position.z = 5
  const layer = new JointHandleLayer(); layer.sync(camera, 400, {}, rest, root)
  assert.equal(layer.handles.filter(handle => handle.visible).length, 4)
  const otherActor = rig()
  assert.equal(layer.spec('extra:X_Head_Jaw', otherActor)!.extraBone, otherActor.getObjectByName('X_Head_Jaw'))
  const spec = layer.spec('extra:X_Head_Jaw')!
  const bones = resolveHandleBones(spec, {}, rest)!
  root.updateMatrixWorld(true)
  const pivot = bones.pivot.getWorldPosition(new THREE.Vector3())
  const target = bones.tip.getWorldPosition(new THREE.Vector3()).sub(pivot).applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 9).add(pivot)
  const rotation = solveJointAim({ ...bones, camera, ndc: new THREE.Vector2(), target })!
  assert.ok(Math.abs(rotation.z - 20) < 0.001)
  const beforeTip = bones.tip.getWorldPosition(new THREE.Vector3())
  applyRelativeJoint(bones.pivot, bones.restQuat, rotation)
  assert.ok(bones.tip.getWorldPosition(new THREE.Vector3()).distanceTo(beforeTip) > 0.01)
  assert.ok(Math.abs(new THREE.Euler().setFromQuaternion(bones.pivot.quaternion).z * 180 / Math.PI - 20) < 0.001)
  const after: string[] = []; root.traverse(obj => after.push(obj.uuid)); assert.deepEqual(after, before)
  assert.equal(extraJointHandleSpecs(root).length, 4)
  layer.dispose()
})
