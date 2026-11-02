import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { makeEmptyDraft } from '@topview/3d-builder'
import { sceneFromDocument } from '@topview/3d-builder/evaluate'
import { createSkeletonEvaluator, sampleSkeletonRange } from '@topview/3d-builder/skeleton'
import { buildFilmExportManifest } from '../src/filmManifest'

test('0.25x motion exports four seconds of editable BBS pose tracks for one source second', (t) => {
  const doc = makeEmptyDraft('slow film', 30, 120)
  doc.content.nodes.push({ id: 'actor', type: 'character', name: 'Actor', visible: true, locked: false,
    metadata: { rig: 'direct', modelUnitMeters: 1, preserveMaterials: true },
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } })
  const model = new THREE.Group(), bone = new THREE.Bone()
  bone.name = 'Bone'; model.add(bone)
  const end = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
  model.animations = [new THREE.AnimationClip('slow', 1, [new THREE.QuaternionKeyframeTrack('Bone.quaternion', [0, 1], [0, 0, 0, 1, ...end.toArray()])])]
  doc.content.timeline.animation.motionClips.push({ id: 'slow', source: 'user', sourceDuration: 1, frameStart: 0, frameEnd: 119,
    target: { type: 'character', nodeId: 'actor' }, playback: { version: 1, speed: 0.25, loop: false, loopMode: 'none' },
    motion: { assetId: 'motion', name: 'Slow', source: 'user', sourceRig: 'custom', url: '', inPlace: false, loop: false, speed: 0.25, time: 0 } })
  const evaluator = createSkeletonEvaluator(doc, new Map([['actor', model]]), new Map([['motion', { group: model, clipIndex: 0 }]]))
  try {
    const samples = [...sampleSkeletonRange(sceneFromDocument(doc), { startFrame: 0, endFrame: 119, sampleFps: 20 }, evaluator.evaluate)]
    const identity = new THREE.Matrix4().toArray(), sha = 'b'.repeat(64)
    const sourceBones = [{ id: 'bone', name: 'Bone', parentId: null, rest: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }]
    const input = { schemaVersion: 1, kind: 'film-sampling-input', targetVersion: '2.4', projectId: 'slow', sourceRevision: 1,
      sourceSha256: 'a'.repeat(64), sourceHashes: { asset: sha }, sampleFps: 20, range: { startFrame: 0, endFrame: 119 }, sequenceId: 'sequence', durationTicks: 80,
      models: [{ characterId: 'character', nodeId: 'actor', name: 'Actor', assetId: 'asset', skeletonId: 'skeleton', source: { path: 'actor.fbx', sha256: sha }, metersPerUnit: 1, skeletonFingerprint: 'slow', sourceBones }],
      cameras: [{ id: 'shot', startTick: 0, durationTicks: 80, keyframes: [0, 80].map((tick) => ({ tick, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, verticalFovDegrees: 60 })) }], frames: samples.map((sample, tick) => ({ tick, sourceFrame: sample.frame, side: sample.side, skeletons: sample.skeletonSamples })) }
    const profile = { schemaVersion: 1 as const, sourceSha256: sha, modelId: 'unified/slow', metersPerUnit: 1,
      bones: [{ name: 'Bone', parent: null, bobjRestMatrixRowMajor: identity }], actions: [], textureRequired: false,
      files: [{ sourcePath: '/fixture/model.bobj', targetPath: 'model.bobj', sha256: 'c'.repeat(64) }] }
    const manifest = buildFilmExportManifest(input as never, new Map([['asset', profile]]), 'slow')
    const keys = manifest.actors[0]!.poseTracks[0]!.keyframes
    assert.equal(manifest.durationTicks, 80)
    assert.equal(keys.length, 81)
    let worst = 0
    for (const tick of [0, 20, 40, 60, 80]) {
      const key = keys.find((entry) => entry.tick === tick)!
      const expected = Math.PI / 2 * tick / 80
      worst = Math.max(worst, Math.abs(key.r[0]! - expected) * 180 / Math.PI)
    }
    assert.ok(worst <= 0.1, `pose angle error ${worst}`)
    t.diagnostic(`0.25x: ${keys.length} pose keys, ${manifest.durationTicks} ticks (4 seconds), max angle error ${worst} degrees`)
  } finally { evaluator.dispose() }
})
