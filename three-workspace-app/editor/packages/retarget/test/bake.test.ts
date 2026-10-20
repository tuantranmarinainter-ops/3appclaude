import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as THREE from 'three'
import { bakeReverseRetargetFrames, retargetFramesToAnimationClip } from '../src/bake.ts'
import { createReverseRetargeter, type MixamoPoseBone } from '../src/reverse.ts'

const armatureText = await readFile(new URL('../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj', import.meta.url), 'utf8')

const source: MixamoPoseBone[] = [{
  name: 'Hips', restWorldPosition: [0, 1, 0], restWorldQuaternion: [0, 0, 0, 1],
  worldPosition: [0, 1, 0], worldQuaternion: [0, 0, 0, 1],
}]

test('bakes each inclusive target frame at its exact frame time', () => {
  const times: number[] = []
  const frames = bakeReverseRetargetFrames({
    evaluate: (_pose, settings) => [{
      name: 'root', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
      worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    }],
  }, (time) => { times.push(time); return source }, { startFrame: 15, endFrame: 17, fps: 15 }, { intensity: 0 })

  assert.deepEqual(times, [1, 16 / 15, 17 / 15])
  assert.deepEqual(frames.map(({ frame }) => frame), [15, 16, 17])
  assert.deepEqual(frames.map(({ timeSeconds }) => timeSeconds), times)
  assert.equal(frames.length, 3)
})

test('rejects invalid ranges, excessive frame counts, and non-finite solver output', () => {
  const solver = { evaluate: () => [{ name: 'root', position: [NaN, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: [] }] }
  assert.throws(() => bakeReverseRetargetFrames(solver, () => source, { startFrame: -1, endFrame: 1, fps: 30 }), /valid inclusive frame range/)
  assert.throws(() => bakeReverseRetargetFrames(solver, () => source, { startFrame: 0, endFrame: 18_000, fps: 30 }), /limited to 18000 frames/)
  assert.throws(() => bakeReverseRetargetFrames(solver, () => source, { startFrame: 0, endFrame: 0, fps: 30 }), /invalid pose at frame 0/)
})

test('bakes changing source poses through the V9.12 Minecraft20 solver', () => {
  const solver = createReverseRetargeter(armatureText)
  const frames = bakeReverseRetargetFrames(solver, (timeSeconds) => [
    source[0]!,
    {
      name: 'Head', restWorldPosition: [0, 2, 0], restWorldQuaternion: [0, 0, 0, 1],
      worldPosition: [0, 2, 0], worldQuaternion: [0, 0, Math.sin(timeSeconds / 2), Math.cos(timeSeconds / 2)],
    },
  ], { startFrame: 0, endFrame: 2, fps: 15 }, { rootMotion: false })

  assert.equal(frames.length, 3)
  assert.ok(frames.every((frame) => frame.bones.length === 20 && frame.bones.every((bone) => [...bone.worldMatrix].every(Number.isFinite))))
  assert.notDeepEqual(frames[0]!.bones.find((bone) => bone.name === 'head')!.worldMatrix, frames[2]!.bones.find((bone) => bone.name === 'head')!.worldMatrix)
})

test('turns sampled local target transforms into a playable Three.js clip', () => {
  const frames = [0, 1].map((frame) => ({
    frame, timeSeconds: frame / 15,
    bones: [
      { name: 'head', position: [0, 1, 0] as [number, number, number], rotation: [0, 0, frame ? Math.SQRT1_2 : 0, frame ? Math.SQRT1_2 : 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number], worldMatrix: [] as never },
      { name: 'low_left_arm.end', position: [frame, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number], worldMatrix: [] as never },
    ],
  }))
  const clip = retargetFramesToAnimationClip(frames)
  const head = new THREE.Bone()
  head.name = 'head'
  const dotted = new THREE.Bone()
  dotted.name = 'low_left_arm.end'
  head.add(dotted)
  const mixer = new THREE.AnimationMixer(head)
  mixer.clipAction(clip).play()
  mixer.setTime(1 / 30)
  assert.equal(head.position.y, 1)
  assert.ok(head.quaternion.z > 0)
  assert.ok(dotted.position.x > 0)
  assert.equal(clip.duration, 1 / 15)
  assert.throws(() => retargetFramesToAnimationClip([]), /at least one sampled frame/)
})
