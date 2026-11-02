import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createFrameSnapshot } from '../../evaluate/FrameSnapshot'
import { applyMotionAndPose } from '../objects/applySnapshot'
import { CharacterAnimator } from '../objects/MotionPlayer'
import type { StageGraph } from '../objects/graph'

const qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0)
const qb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)

function constantClip(name: string, q: THREE.Quaternion, x: number): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack('Bone.quaternion', [0, 1], [...q.toArray(), ...q.toArray()]),
    new THREE.VectorKeyframeTrack('Bone.position', [0, 1], [x, 0, 0, x, 0, 0]),
  ])
}

function graphWithBone() {
  const node = {
    id: 'hero', name: 'Hero', type: 'character' as const, visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    character: { animation: { mode: 'pose', posePresetId: '', controlValues: {} } },
  }
  const root = new THREE.Group()
  const inner = new THREE.Group()
  const bone = new THREE.Bone()
  bone.name = 'Bone'
  inner.add(bone)
  root.add(inner)
  const character = {
    node, root, inner, rig: 'mixamorig', restPose: new Map(), restPos: new Map(),
    animator: new CharacterAnimator(inner),
  }
  const clips = ['A', 'B'].map((id) => ({ id, motion: { assetId: id }, playback: { version: 1, speed: 1, loop: false, loopMode: 'repeat' } }))
  const sources: Record<string, THREE.AnimationClip> = { A: constantClip('A', qa, 0), B: constantClip('B', qb, 10) }
  const graph = {
    doc: { content: { timeline: { animation: { motionClips: clips } } } },
    scene: new THREE.Scene(), nodeById: new Map([['hero', node]]),
    characters: new Map([['hero', character]]), props: new Map(), primitives: new Map(), groups: new Map(),
    cameras: new Map(), poseBank: new Map(),
    motionPlayer: { getClipForDirectBind: (assetId: string) => sources[assetId], getRaw: () => null },
  } as unknown as StageGraph
  return { graph, bone }
}

function sample(graph: StageGraph, commands: Array<{ clipId: string; weight: number; timeSeconds?: number }>) {
  const snapshot = createFrameSnapshot()
  for (const c of commands) snapshot.motionPlayback.push({ nodeId: 'hero', timeSeconds: 0.5, ...c })
  applyMotionAndPose(graph, snapshot)
}

test('một lệnh phát: đường cũ, trọng số không ảnh hưởng', () => {
  const { graph, bone } = graphWithBone()
  sample(graph, [{ clipId: 'B', weight: 1 }])
  assert.ok(bone.quaternion.angleTo(qb) < 1e-3)
  assert.equal(bone.position.x, 10)
})

test('vùng trộn: xương slerp, vị trí lerp theo trọng số của clip sau', () => {
  const { graph, bone } = graphWithBone()
  for (const w of [0, 0.25, 0.5, 1]) {
    sample(graph, [{ clipId: 'A', weight: 1 - w }, { clipId: 'B', weight: w }])
    const expected = qa.clone().slerp(qb, w)
    assert.ok(bone.quaternion.angleTo(expected) < 1e-3, `w=${w}`)
    assert.ok(Math.abs(bone.position.x - 10 * w) < 1e-5, `w=${w} x=${bone.position.x}`)
  }
})

test('trộn rồi quay lại một clip vẫn cho đúng tư thế (không dính trạng thái)', () => {
  const { graph, bone } = graphWithBone()
  sample(graph, [{ clipId: 'A', weight: 0.5 }, { clipId: 'B', weight: 0.5 }])
  sample(graph, [{ clipId: 'B', weight: 1 }])
  assert.ok(bone.quaternion.angleTo(qb) < 1e-3)
  assert.equal(bone.position.x, 10)
})
