import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { createSkeletonEvaluator, sampleSkeletonRange } from '../skeletonEvaluator'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import { createFrameSnapshot, evaluateFrame } from '../../evaluate/evaluateFrame'
import { sceneFromDocument } from '../../evaluate/sceneFromDocument'

function fixture() {
  const doc = makeEmptyDraft('CPU skeleton', 30, 90)
  const node = { id: 'actor', type: 'character' as const, name: 'Actor', visible: true, locked: false,
    metadata: { rig: 'direct', modelUnitMeters: 0.01, preserveMaterials: true },
    transform: { position: { x: 2, y: 0, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: 1, z: 1 } } }
  doc.content.nodes.push(node)
  const model = new THREE.Group(), hips = new THREE.Bone(), arm = new THREE.Bone()
  hips.name = 'Hips'; hips.position.y = 100; arm.name = 'Arm'; arm.position.x = 20
  model.add(hips); hips.add(arm)
  model.animations = [new THREE.AnimationClip('walk', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 100, 0, 100, 100, 0])])]
  doc.content.timeline.animation.motionClips.push({ id: 'walk', source: 'user', sourceDuration: 1, frameStart: 0, frameEnd: 29,
    target: { type: 'character', nodeId: 'actor' }, playback: { version: 1, speed: 1, loop: false, loopMode: 'none' },
    motion: { assetId: 'motion', name: 'Walk', source: 'user', sourceRig: 'custom', url: '', inPlace: false, loop: false, speed: 1, time: 0,
      rootMotion: { policy: 'trajectory', boneName: 'Hips', alignment: 'origin' } } })
  const evaluator = createSkeletonEvaluator(doc, new Map([['actor', model]]), new Map([['motion', { group: model, clipIndex: 0 }]]))
  return { doc, evaluator, hips }
}

test('CPU skeleton evaluator reuses browser rig/unit/root playback without a DOM or renderer', () => {
  const { doc, evaluator, hips } = fixture()
  const snapshot = createFrameSnapshot()
  for (const frame of [15, 24, 15]) {
    evaluateFrame(sceneFromDocument(doc), frame, snapshot)
    const sample = evaluator.evaluate(snapshot)[0]!
    assert.equal(sample.bones.length, 2)
    assert.deepEqual(sample.bones[0]!.position, [0, 100, 0])
    const p = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(sample.bones[0]!.worldMatrix))
    assert.ok(Math.abs(p.x - 2) < 1e-6); assert.ok(Math.abs(p.y - 1) < 1e-6); assert.ok(Math.abs(p.z + frame / 30) < 1e-6)
  }
  assert.deepEqual(hips.position.toArray(), [0, 100, 0], 'input template stays in rest pose')
  evaluator.dispose(); evaluator.dispose()
  assert.throws(() => evaluator.evaluate(snapshot), /disposed/)
})

test('skeleton export grid includes one terminal pose and preserves previous-left/next-right at a cut', () => {
  const { doc, evaluator } = fixture()
  const clip = doc.content.timeline.animation.motionClips[0]!
  const next = structuredClone(clip); next.id = 'next'; next.frameStart = 30; next.frameEnd = 59
  next.motion.time = 0.25; next.motion.sourceLengthSeconds = 0.5
  doc.content.timeline.animation.motionClips.push(next)
  const scene = sceneFromDocument(doc)
  const first = [...sampleSkeletonRange(scene, { startFrame: 0, endFrame: 29, sampleFps: 20 }, evaluator.evaluate)]
  const second = [...sampleSkeletonRange(scene, { startFrame: 30, endFrame: 59, sampleFps: 20 }, evaluator.evaluate)]
  assert.equal(first.length, 21)
  assert.equal(first.at(-1)!.frame, 30); assert.equal(first.at(-1)!.timeSeconds, 1); assert.equal(first.at(-1)!.side, 'left')
  const z = (sample: typeof first[number]) => sample.skeletonSamples[0]!.bones[0]!.worldMatrix[14]!
  assert.ok(Math.abs(z(first.at(-1)!) + 1) < 1e-6, 'endpoint keeps previous clip, not rest or next anchor')
  assert.ok(Math.abs(z(second[0]!) + 0.25) < 1e-6, 'next right sample uses its own source anchor')
  assert.ok(Math.abs(z(first[10]!) + 0.5) < 1e-6, 'later samples do not mutate earlier numeric arrays')
  clip.frameEnd = 89; clip.playback.loop = true; doc.content.timeline.animation.motionClips.pop()
  const loop = [...sampleSkeletonRange(scene, { startFrame: 0, endFrame: 89, sampleFps: 20 }, evaluator.evaluate)]
  assert.equal(loop.length, 61)
  assert.ok(Math.abs(z(loop.at(-1)!) + 3) < 1e-6)
  clip.motion.rootMotion!.policy = 'skeletal'
  const skeletal = [...sampleSkeletonRange(scene, { startFrame: 0, endFrame: 89, sampleFps: 20 }, evaluator.evaluate)]
  assert.deepEqual(skeletal.at(-1)!.skeletonSamples[0]!.bones[0]!.position, [100, 100, 0], 'loop endpoint samples source end, not source start')
  clip.motion.reverse = true
  const reverse = [...sampleSkeletonRange(scene, { startFrame: 0, endFrame: 29, sampleFps: 20 }, evaluator.evaluate)]
  assert.deepEqual(reverse[0]!.skeletonSamples[0]!.bones[0]!.position, [100, 100, 0])
  assert.deepEqual(reverse.at(-1)!.skeletonSamples[0]!.bones[0]!.position, [0, 100, 0])
  assert.equal(clip.frameEnd, 89)
  evaluator.dispose()
})

test('skeleton export rejects invalid ranges and sample counts before yielding', () => {
  const { doc, evaluator } = fixture()
  const scene = sceneFromDocument(doc)
  for (const range of [{ startFrame: 0, endFrame: -1, sampleFps: 20 }, { startFrame: 0, endFrame: scene.meta.frameEnd + 1, sampleFps: 20 },
    { startFrame: 0, endFrame: 89, sampleFps: NaN }, { startFrame: 0, endFrame: 89, sampleFps: 0 },
    { startFrame: 0.1, endFrame: 89, sampleFps: 20 }, { startFrame: 0, endFrame: 89, sampleFps: Number.MAX_VALUE }]) {
    assert.throws(() => [...sampleSkeletonRange(scene, range, evaluator.evaluate)], RangeError)
  }
  evaluator.dispose()
})

test('terminal skeleton sample keeps the independent path endpoint with root motion added once', () => {
  const { doc, evaluator } = fixture()
  doc.content.nodes.push({ id: 'path', type: 'path', name: 'Independent path', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    path: { source: 'transform-keyframes', curve: 'polyline', closed: false, groundSnap: true, parameterization: 'time-ratio', smoothing: 0,
      points: [{ id: 'a', timeRatio: 0, position: { x: 0, y: 0, z: 0 } }, { id: 'b', timeRatio: 1, position: { x: 5, y: 0, z: 0 } }] } })
  doc.content.timeline.animation.pathMotionClips.push({ id: 'path-clip', status: 'active', source: 'user', locked: true, lockedReason: 'derived-from-keyframes',
    target: { type: 'character', nodeId: 'actor' }, pathNodeId: 'path', pathName: 'Independent path', pathLength: 5, pathStartPercent: 0, pathEndPercent: 100,
    direction: 'forward', facing: 'none', frameStart: 0, frameEnd: 30, playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: 30 } })
  const samples = [...sampleSkeletonRange(sceneFromDocument(doc), { startFrame: 0, endFrame: 29, sampleFps: 20 }, evaluator.evaluate)]
  const last = samples.at(-1)!.skeletonSamples[0]!
  assert.ok(Math.abs(last.placementMatrix[12]! - 5) < 1e-6)
  assert.ok(Math.abs(last.bones[0]!.worldMatrix[12]! - 5) < 1e-6)
  assert.ok(Math.abs(last.bones[0]!.worldMatrix[14]! + 1) < 1e-6)
  evaluator.dispose()
})
