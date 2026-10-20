import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'
import { CharacterAnimator, MotionPlayer } from '../objects/MotionPlayer'
import { Ual1Retargeter } from '../rig/applyRetarget'
import { fbxSourceBones } from '../../evaluate/retarget/fbxSourceBones'
import { motionTimeSeconds } from '../../evaluate/clips'
import type { MotionClip } from '../../contract/types'

test('MotionPlayer loads the requested FBX animation clip by index', async () => {
  const player = new MotionPlayer()
  const clips = [new THREE.AnimationClip('idle', 1, []), new THREE.AnimationClip('walk', 2, [])]
  const group = Object.assign(new THREE.Group(), { animations: clips })
  ;(player as unknown as { loader: { loadAsync: () => Promise<THREE.Object3D> } }).loader = { loadAsync: async () => group }
  assert.equal((await player.load('motion-1', '/private/walk.fbx', 1)).clip, clips[1])
  await assert.rejects(player.load('motion-2', '/private/walk.fbx', 2), /animation 2 was not found/)
  await assert.rejects(player.load('motion-3', '/private/walk.fbx', -1), /non-negative integer/)
})

test('MotionPlayer registers decoded CPU sources without loading or mutating their bind pose', () => {
  const player = new MotionPlayer(), source = new THREE.Group()
  const bone = new THREE.Bone(); bone.name = 'Hips'; bone.position.y = 100; source.add(bone)
  source.animations = [new THREE.AnimationClip('idle', 1, [])]
  player.register('cpu-motion', source)
  bone.position.y = 42
  assert.equal(player.getRaw('cpu-motion')!.bind.get('Hips')!.pos.y, 100)
  assert.throws(() => player.register('cpu-motion', source), /already registered/)
  assert.throws(() => player.register('missing', source, 1), /not found/)
})

test('MotionPlayer keeps different clip indexes separate for the same asset ID', async () => {
  const player = new MotionPlayer()
  const clips = [new THREE.AnimationClip('idle', 1, []), new THREE.AnimationClip('walk', 2, [])]
  const group = Object.assign(new THREE.Group(), { animations: clips })
  ;(player as unknown as { loader: { loadAsync: () => Promise<THREE.Object3D> } }).loader = { loadAsync: async () => group }
  assert.equal((await player.load('shared-fbx', '/private/multi.fbx', 0)).clip, clips[0])
  assert.equal((await player.load('shared-fbx', '/private/multi.fbx', 1)).clip, clips[1])
  assert.equal(player.getRaw('shared-fbx', 1)?.clip, clips[1])
  const target = new THREE.Group()
  assert.equal(player.getClipForDirectBind('shared-fbx', target, undefined, undefined, 0)?.name, 'idle')
  assert.equal(player.getClipForDirectBind('shared-fbx', target, undefined, undefined, 1)?.name, 'walk')
})

test('CharacterAnimator can seek a non-looping clip backward without wrapping', () => {
  const root = new THREE.Group()
  const bone = new THREE.Bone()
  bone.name = 'Bone'
  root.add(bone)
  const clip = new THREE.AnimationClip('walk', 3, [new THREE.VectorKeyframeTrack('Bone.position', [0, 1, 2, 3], [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0])])
  const animator = new CharacterAnimator(root)
  animator.playAt('reverse', clip, 3, false)
  assert.equal(bone.position.x, 3)
  animator.playAt('reverse', clip, 2, false)
  assert.equal(bone.position.x, 2)
  animator.playAt('reverse', clip, 1, false)
  assert.equal(bone.position.x, 1)
})

test('stopping a finished clamped action restores its bind position before a timeline gap', () => {
  const root = new THREE.Group(), bone = new THREE.Bone()
  bone.name = 'Bone'; root.add(bone)
  const animator = new CharacterAnimator(root)
  const clip = new THREE.AnimationClip('travel', 1, [new THREE.VectorKeyframeTrack('Bone.position', [0, 1], [0, 0, 0, 10, 0, 0])])
  animator.playAt('travel', clip, 1, false)
  assert.equal(bone.position.x, 10)
  animator.stopAll()
  assert.equal(bone.position.x, 0)
})

test('UAL1 retargeter can seek a non-looping clip backward without losing its pose', () => {
  const source = new THREE.Group()
  const hips = new THREE.Bone()
  hips.name = 'mixamorigHips'
  source.add(hips)
  const destination = new THREE.Group()
  const pelvis = new THREE.Bone()
  pelvis.name = 'pelvis'
  destination.add(pelvis)
  const clip = new THREE.AnimationClip('walk', 3, [
    new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1, 2, 3], [0, 0, 0, 100, 0, 0, 200, 0, 0, 300, 0, 0]),
  ])
  const retargeter = new Ual1Retargeter(destination)
  retargeter.setClip('walk', source, clip)
  retargeter.apply(3, false)
  assert.equal(pelvis.position.x, 3)
  retargeter.apply(2, false)
  assert.equal(pelvis.position.x, 2)
})

test.skipIf(!process.env.BBS_TEST_MIXAMO_FBX)('real FBX trim/reverse direct binding preserves the native source bone pose', async () => {
  const bytes = readFileSync(process.env.BBS_TEST_MIXAMO_FBX!)
  const source = new FBXLoader().parse(Uint8Array.from(bytes).buffer, '')
  const sourceBones = fbxSourceBones(source)
  assert.equal(sourceBones.length, 65)
  const destination = skeletonClone(source)
  const destinationBones = fbxSourceBones(destination)
  const index = source.animations.findIndex((clip) => clip.duration > 0 && clip.tracks.length > 0)
  const nativeClip = source.animations[index]!
  const player = new MotionPlayer()
  ;(player as unknown as { loader: { loadAsync: () => Promise<THREE.Object3D> } }).loader = { loadAsync: async () => source }
  await player.load('real-fbx', '/private/source.fbx', index)
  const clip = player.getClipForDirectBind('real-fbx', destination, undefined, undefined, index)!
  const animator = new CharacterAnimator(destination)
  const nativeMixer = new THREE.AnimationMixer(source)
  const nativeAction = nativeMixer.clipAction(nativeClip).setLoop(THREE.LoopOnce, 1)
  nativeAction.clampWhenFinished = true
  const start = nativeClip.duration * 0.2
  const length = nativeClip.duration * 0.5
  const placement = { frameStart: 0, sourceDuration: nativeClip.duration, playback: { speed: 2, loop: false }, motion: { time: start, sourceLengthSeconds: length, reverse: true } } as MotionClip
  for (const progress of [0, 0.5, 1]) {
    const time = motionTimeSeconds(placement, progress * length / 2 * 30, 30)
    assert.ok(Math.abs(time - (start + length * (1 - progress))) < 1e-7)
    nativeAction.reset().play(); nativeMixer.setTime(time)
    animator.playAt('trim-reverse', clip, time, false)
    for (const [i, bone] of sourceBones.entries()) {
      const target = destinationBones[i]!
      assert.ok(bone.position.distanceTo(target.position) < 1e-5, `${bone.name} position at ${time}`)
      const angle = bone.quaternion.clone().normalize().angleTo(target.quaternion.clone().normalize())
      assert.ok(angle < 1e-5, `${bone.name} rotation at ${time}: ${angle} radians`)
    }
  }
})
