import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { CharacterAnimator, MotionPlayer } from '../objects/MotionPlayer'

function fixture() {
  const root = new THREE.Group(), bone = new THREE.Bone()
  bone.name = 'Bone'; root.add(bone)
  const end = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  const clip = new THREE.AnimationClip('shared', 1, [new THREE.QuaternionKeyframeTrack('Bone.quaternion', [0, 1], [0, 0, 0, 1, ...end.toArray()])])
  return { bone, clip, animator: new CharacterAnimator(root) }
}

test('same motion plays both separated timeline clips continuously with identical frame 15/75 poses', () => {
  const { bone, clip, animator } = fixture()
  let first: THREE.Quaternion | undefined, worstDegrees = 0, samples = 0
  for (let frame = 0; frame < 90; frame++) {
    if (frame >= 30 && frame < 60) { animator.stopAll(); continue }
    const localFrame = frame < 30 ? frame : frame - 60
    animator.playAt(frame < 30 ? 'first' : 'second', clip, localFrame / 30)
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 * localFrame / 30)
    worstDegrees = Math.max(worstDegrees, bone.quaternion.angleTo(expected) * 180 / Math.PI)
    if (frame === 15) first = bone.quaternion.clone()
    if (frame === 75) assert.ok(first!.angleTo(bone.quaternion) * 180 / Math.PI <= 0.1)
    samples++
  }
  assert.equal(samples, 60)
  assert.ok(worstDegrees <= 0.1, `maximum pose error ${worstDegrees} degrees`)
  console.info(`same motion: ${samples} continuous samples, maximum quaternion error ${worstDegrees} degrees`)
})

test('replacing one timeline clip does not stop or uncache the other action', () => {
  const { bone, clip, animator } = fixture()
  animator.playAt('first', clip, 0.5)
  animator.playAt('second', clip, 0.5)
  const actions = (animator as unknown as { actions: Map<string, THREE.AnimationAction> }).actions
  const second = actions.get('second')!
  assert.notEqual(actions.get('first'), second)
  assert.notEqual(actions.get('first')!.getClip(), second.getClip())
  animator.playAt('first', new THREE.AnimationClip('replacement', 1, []), 0)
  animator.playAt('second', clip, 0.5)
  assert.equal(actions.get('second'), second)
  assert.equal(animator.mixer.existingAction(second.getClip()), second)
  assert.ok(bone.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4)) * 180 / Math.PI <= 0.1)
})

test('replacing the currently active source under the same timeline ID starts its new action', () => {
  const { bone, clip, animator } = fixture()
  animator.playAt('same-id', clip, 0.5)
  const replacement = new THREE.AnimationClip('other', 1, [new THREE.QuaternionKeyframeTrack('Bone.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])])
  animator.playAt('same-id', replacement, 0.5)
  assert.ok(bone.quaternion.angleTo(new THREE.Quaternion()) * 180 / Math.PI <= 0.1)
})

test('motion URL changes invalidate decoded and baked clips while stale requests cannot overwrite new sources', async () => {
  const player = new MotionPlayer()
  const group = (name: string) => Object.assign(new THREE.Group(), { animations: [new THREE.AnimationClip(name, 1, [])] })
  const old = group('old'), current = group('current')
  let finishOld!: (value: THREE.Object3D) => void
  ;(player as unknown as { loader: { loadAsync: (url: string) => Promise<THREE.Object3D> } }).loader = {
    loadAsync: (url) => url.endsWith('old.fbx') ? new Promise((resolve) => { finishOld = resolve }) : Promise.resolve(current),
  }
  const oldRequest = player.load('same-asset', '/old.fbx')
  assert.equal((await player.load('same-asset', '/new.fbx')).clip.name, 'current')
  finishOld(old); await oldRequest
  assert.equal(player.getRaw('same-asset')!.clip.name, 'current')
  const target = new THREE.Group()
  assert.equal(player.getClipForDirectBind('same-asset', target)!.name, 'current')
  const replacement = group('replacement')
  ;(player as unknown as { loader: { loadAsync: () => Promise<THREE.Object3D> } }).loader = { loadAsync: async () => replacement }
  await player.load('same-asset', '/replacement.fbx')
  assert.equal(player.getClipForDirectBind('same-asset', target)!.name, 'replacement')
})
