import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { CharacterAnimator } from '../objects/MotionPlayer'
import { applyMotionAndPose } from '../objects/applySnapshot'
import { createFrameSnapshot } from '../../evaluate/FrameSnapshot'
import type { StageGraph } from '../objects/graph'
import type { MotionClip } from '../../contract/types'
import type { CharInstance } from '../objects/types'
import type { MotionPlayer } from '../objects/MotionPlayer'
import { evaluateRootTrajectory } from '../objects/rootMotion'

function fixture() {
  const root = new THREE.Group()
  root.position.set(2, 3, 4); root.rotation.y = 0.4; root.scale.set(2, 3, 4)
  const motionRoot = new THREE.Group()
  motionRoot.matrixAutoUpdate = false
  const inner = new THREE.Group(); inner.scale.setScalar(0.01)
  const model = new THREE.Group(); model.name = 'SourceModel'; model.position.set(1, 2, 3); model.rotation.z = 0.2
  const bone = new THREE.Bone(); bone.name = 'Hips'; bone.position.y = 100
  const arm = new THREE.Bone(); arm.name = 'Arm'; arm.position.x = 20
  root.add(motionRoot); motionRoot.add(inner); inner.add(model); model.add(bone); bone.add(arm)
  const restPos = new Map<string, THREE.Vector3>(), restPose = new Map<string, THREE.Quaternion>(), restScale = new Map<string, THREE.Vector3>()
  inner.traverse((object) => { restPos.set(object.name, object.position.clone()); restPose.set(object.name, object.quaternion.clone()); restScale.set(object.name, object.scale.clone()) })
  const character: CharInstance = { node: { id: 'actor', name: 'Actor', type: 'character', visible: true, locked: false,
    transform: { position: { x: 2, y: 3, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 3, z: 4 } } },
    root, motionRoot, inner, rig: 'direct', restPos, restPose, restScale, animator: new CharacterAnimator(inner), retargeter: null, legLength: null }
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  const animation = new THREE.AnimationClip('walk', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 100, 0, 100, 100, 0]),
    new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, ...turn.toArray()]),
    new THREE.VectorKeyframeTrack('Arm.position', [0, 1], [20, 0, 0, 30, 10, 0]),
  ])
  const clip = { id: 'walk', sourceDuration: 1, frameStart: 0, frameEnd: 29, target: { nodeId: 'actor' },
    motion: { assetId: 'fbx', time: 0, sourceLengthSeconds: 1, rootMotion: { policy: 'trajectory', boneName: 'Hips', alignment: 'origin' } },
    playback: { speed: 1, loop: false } } as MotionClip
  const player = { getClipForDirectBind: () => animation } as unknown as MotionPlayer
  return { character, bone, arm, model, animation, clip, player }
}

function closeMatrix(a: THREE.Matrix4, b: THREE.Matrix4) {
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(a.elements[i] - b.elements[i]) < 1e-5, `matrix[${i}] ${a.elements[i]} != ${b.elements[i]}`)
}

test('trajectory transfers root position and turn once with exact skin parity under units, source hierarchy and nonuniform placement scale', () => {
  const source = fixture(), target = fixture()
  // Animated model parents remain inside the skeleton; sampling must not depend on the previous rendered frame.
  for (const data of [source, target]) data.animation.tracks.push(new THREE.VectorKeyframeTrack('SourceModel.position', [0, 1], [1, 2, 3, 10, 2, 8]))
  const graph = { doc: { content: { timeline: { fps: 30, animation: { motionClips: [target.clip] } } } },
    motionPlayer: target.player, characters: new Map([['actor', target.character]]) } as unknown as StageGraph
  const snapshot = createFrameSnapshot()
  for (const time of [0.3, 0.8, 0.3, 0, 1]) {
    source.character.animator.playAt('walk', source.animation, time, false)
    snapshot.frame = time * 30
    snapshot.motionPlayback = [{ nodeId: 'actor', clipId: 'walk', timeSeconds: time, weight: 1 }]
    applyMotionAndPose(graph, snapshot)
    source.character.root.updateMatrixWorld(true); target.character.root.updateMatrixWorld(true)
    closeMatrix(source.bone.matrixWorld, target.bone.matrixWorld)
    closeMatrix(source.arm.matrixWorld, target.arm.matrixWorld)
    assert.deepEqual(target.bone.position.toArray(), [0, 100, 0])
    assert.deepEqual(target.bone.quaternion.toArray(), [0, 0, 0, 1])
    assert.deepEqual(target.character.root.position.toArray(), [2, 3, 4])
  }
})

test('trajectory loop accumulates turns, reverse travels backward, and continue uses the previous end-exclusive endpoint', () => {
  const { character, clip, player } = fixture()
  character.inner.children[0].position.set(0, 0, 0)
  character.restPos.set('SourceModel', new THREE.Vector3())
  character.restPose.set('SourceModel', new THREE.Quaternion())
  clip.playback.loop = true; clip.frameEnd = 89
  const twice = evaluateRootTrajectory(character, [clip], player, 60, 30)!
  const p = new THREE.Vector3().setFromMatrixPosition(twice)
  assert.ok(Math.abs(p.x - 1) < 1e-6); assert.ok(Math.abs(p.z + 1) < 1e-6)
  clip.playback.loop = false; clip.frameEnd = 29
  const next = structuredClone(clip); next.id = 'next'; next.frameStart = 30; next.frameEnd = 59; next.motion.rootMotion!.alignment = 'continue'
  const joined = evaluateRootTrajectory(character, [next, clip], player, 30, 30)!
  closeMatrix(joined, evaluateRootTrajectory(character, [clip], player, 30, 30)!)
  const joinedEnd = evaluateRootTrajectory(character, [clip, next], player, 60, 30)!
  closeMatrix(joinedEnd, twice)
  next.motion.rootMotion!.alignment = 'origin'
  closeMatrix(evaluateRootTrajectory(character, [clip, next], player, 30, 30)!, new THREE.Matrix4())
  next.motion.reverse = true
  const reverseStart = evaluateRootTrajectory(character, [next], player, 30, 30)!
  const reverseEnd = evaluateRootTrajectory(character, [next], player, 60, 30)!
  assert.ok(new THREE.Vector3().setFromMatrixPosition(reverseStart).x > 0.99)
  closeMatrix(reverseEnd, new THREE.Matrix4())
  closeMatrix(evaluateRootTrajectory(character, [clip, next], player, 60, 30)!, reverseEnd)
})

test('trimmed trajectory keeps fractional speed/loop progress and holds its final endpoint in timeline gaps', () => {
  const { character, clip, animation, player } = fixture()
  character.restPos.set('SourceModel', new THREE.Vector3())
  character.restPose.set('SourceModel', new THREE.Quaternion())
  animation.tracks = animation.tracks.filter((track) => track.name !== 'Hips.quaternion')
  clip.motion.time = 0.25; clip.motion.sourceLengthSeconds = 0.5; clip.playback.speed = 2; clip.playback.loop = true
  function x(frame: number) { return new THREE.Vector3().setFromMatrixPosition(evaluateRootTrajectory(character, [clip], player, frame, 30)!).x }
  assert.ok(Math.abs(x(15) - 1.25) < 1e-6)
  assert.ok(Math.abs(x(3.75) - 0.5) < 1e-6)
  assert.ok(Math.abs(x(300) - 2.25) < 1e-6)
  clip.motion.reverse = true
  assert.ok(Math.abs(x(15) + 0.25) < 1e-6)
  assert.ok(Math.abs(x(3.75) - 0.5) < 1e-6)
  assert.ok(Math.abs(x(300) + 1.25) < 1e-6)
})

test('in-place removes root translation and rotation while preserving limbs, units and actor placement', () => {
  const root = new THREE.Group()
  root.position.set(2, 3, 4)
  root.rotation.y = 0.7
  const inner = new THREE.Group()
  inner.scale.setScalar(0.01)
  root.add(inner)
  const hips = new THREE.Bone()
  hips.name = 'Hips'
  hips.position.set(0, 100, 0)
  hips.rotation.x = -Math.PI / 2
  inner.add(hips)
  const arm = new THREE.Bone()
  arm.name = 'Arm'
  hips.add(arm)
  const restPosition = hips.position.clone()
  const restRotation = hips.quaternion.clone()
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1)
  const animation = new THREE.AnimationClip('walk', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 100, 0, 200, 120, 50]),
    new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [...restRotation.toArray(), ...turn.toArray()]),
    new THREE.VectorKeyframeTrack('Arm.position', [0, 1], [1, 2, 3, 10, 20, 30]),
  ])
  const clip = { id: 'walk', motion: { assetId: 'fbx', rootMotion: { policy: 'in-place', boneName: 'Hips' } }, playback: { loop: false } } as MotionClip
  const graph = {
    doc: { content: { timeline: { animation: { motionClips: [clip] } } } },
    motionPlayer: { getClipForDirectBind: () => animation },
    characters: new Map([['actor', { node: {}, root, inner, rig: 'direct', animator: new CharacterAnimator(inner),
      restPos: new Map([['Hips', restPosition]]), restPose: new Map([['Hips', restRotation]]) }]]),
  } as unknown as StageGraph
  const snapshot = createFrameSnapshot()
  const command = { nodeId: 'actor', clipId: 'walk', timeSeconds: 0.25, weight: 1 }
  snapshot.motionPlayback.push(command)
  for (const time of [0.25, 0.75, 0.25, 1, 0]) {
    command.timeSeconds = time
    applyMotionAndPose(graph, snapshot)
    assert.deepEqual(hips.position.toArray(), restPosition.toArray())
    assert.deepEqual(hips.quaternion.toArray(), restRotation.toArray())
    assert.ok(Math.abs(arm.position.x - (1 + 9 * time)) < 1e-6)
    assert.deepEqual(inner.scale.toArray(), [0.01, 0.01, 0.01])
    assert.deepEqual(root.position.toArray(), [2, 3, 4])
    assert.equal(root.rotation.y, 0.7)
  }
  clip.motion.rootMotion!.policy = 'skeletal'
  command.timeSeconds = 0.5
  applyMotionAndPose(graph, snapshot)
  assert.ok(Math.abs(hips.position.x - 100) < 1e-6)
  assert.ok(hips.quaternion.angleTo(restRotation) > 0.1)
  delete clip.motion.rootMotion
  applyMotionAndPose(graph, snapshot)
  assert.ok(Math.abs(hips.position.x - 100) < 1e-6, 'legacy playback stays skeletal')
})
