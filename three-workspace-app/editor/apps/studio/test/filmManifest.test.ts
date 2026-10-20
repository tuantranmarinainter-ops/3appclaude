import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion } from 'three'
import { buildFilmExportManifest, type ConvertedFilmModelProfile } from '../src/filmManifest.ts'

const identity = new Matrix4().toArray()
const input = {
  schemaVersion: 1 as const, kind: 'film-sampling-input' as const, targetVersion: '2.4' as const,
  projectId: 'project_1', sourceRevision: 3, sourceSha256: 'a'.repeat(64), sourceHashes: { asset: 'b'.repeat(64) },
  sampleFps: 20, range: { startFrame: 0, endFrame: 1 }, sequenceId: 'sequence', durationTicks: 1,
  models: [{ characterId: 'character', nodeId: 'actor', name: 'Actor', assetId: 'asset', skeletonId: 'skeleton',
    source: { path: 'Actor.fbx', sha256: 'b'.repeat(64) }, metersPerUnit: 1, skeletonFingerprint: 'fingerprint',
    sourceBones: [{ id: 'root', name: 'root', parentId: null, rest: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }] }],
  cameras: [{ id: 'shot', startTick: 0, durationTicks: 1, keyframes: [
    { tick: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, verticalFovDegrees: 60 },
    { tick: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, verticalFovDegrees: 60 },
  ] }],
  frames: [0, 1].map((tick) => ({ tick, sourceFrame: tick, side: tick ? 'left' as const : 'right' as const,
    skeletons: [{ nodeId: 'actor', metersPerUnit: 1, placementMatrix: identity, trajectoryMatrix: identity,
      actorWorldMatrix: new Matrix4().compose({ x: tick * 2, y: 1, z: 3 } as never,
        new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, Math.PI * tick / 2), { x: 1, y: 1, z: 1 } as never).toArray(),
      bones: [{ name: 'root', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: identity }] }] })),
}
const profile: ConvertedFilmModelProfile = {
  schemaVersion: 1, sourceSha256: 'b'.repeat(64), modelId: 'unified/bbbbbbbbbbbbbbbb', metersPerUnit: 1,
  bones: [{ name: 'root', parent: null, bobjRestMatrixRowMajor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
  actions: [], textureRequired: false, files: [{ sourcePath: 'C:/models/model.bobj', targetPath: 'model.bobj', sha256: 'c'.repeat(64) }],
}

test('builds a worker manifest with per-tick actor transforms and editable BOBJ tracks', () => {
  const manifest = buildFilmExportManifest(input as never, new Map([['asset', profile]]), 'take-01')
  assert.equal(manifest.mode, 'editable')
  assert.equal(manifest.durationTicks, 1)
  assert.deepEqual(manifest.models[0]!.bones, ['root'])
  const transforms = manifest.actors[0]!.transformSamples
  assert.deepEqual(transforms.map(({ x, y, z }) => [x, y, z]), [[0, 1, 3], [2, 1, 3]])
  assert.ok(Math.abs(transforms[0]!.yaw) < 1e-12 && Math.abs(transforms[1]!.yaw + 90) < 1e-12)
  assert.equal(manifest.actors[0]!.poseTracks[0]!.keyframes.length, 2)
  assert.equal(manifest.cameras[0]!.id, 'shot')
})

test('rejects a profile from a different source and actor transforms the worker cannot express', () => {
  assert.throws(() => buildFilmExportManifest(input as never, new Map([['asset', { ...profile, sourceSha256: 'd'.repeat(64) }]]), 'take'), /does not match/)
  const rolled = structuredClone(input) as typeof input
  rolled.frames[0]!.skeletons[0]!.actorWorldMatrix = new Matrix4().makeRotationZ(0.2).toArray()
  assert.throws(() => buildFilmExportManifest(rolled as never, new Map([['asset', profile]]), 'take'), /roll is not supported/)
  const scaled = structuredClone(input) as typeof input
  scaled.frames[0]!.skeletons[0]!.actorWorldMatrix = new Matrix4().makeScale(2, 2, 2).toArray()
  assert.throws(() => buildFilmExportManifest(scaled as never, new Map([['asset', profile]]), 'take'), /unit actor scale/)
})
