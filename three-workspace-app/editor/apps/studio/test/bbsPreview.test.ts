import assert from 'node:assert/strict'
import test from 'node:test'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { CameraSequenceSample } from '@topview/3d-builder/headless'
import { bbsActorToThree, bbsCameraToThree, filmFrameRect } from '../src/bbsPreview.ts'
import { cameraSamplesToFilm } from '../src/filmCamera.ts'
import { buildFilmExportManifest, type ConvertedFilmModelProfile } from '../src/filmManifest.ts'

const radians = Math.PI / 180

function bbsCameraQuaternion(yaw: number, pitch: number, roll: number): number[] {
  const world = new Matrix4().makeRotationZ(roll * radians)
    .multiply(new Matrix4().makeRotationX(pitch * radians))
    .multiply(new Matrix4().makeRotationY(yaw * radians))
    .invert()
  const rotation = new Quaternion()
  world.decompose(new Vector3(), rotation, new Vector3())
  return rotation.toArray()
}

function cameraShot(quaternion: number[], position: number[]): CameraSequenceSample[] {
  return [0, 1].map((tick) => ({
    shotId: 'shot', cameraNodeId: 'camera', sourceFrame: tick, shotTimeSeconds: tick / 20,
    sequenceTimeSeconds: tick / 20, side: tick === 1 ? 'left' : 'right', position,
    quaternion, lookAt: [0, 0, 0], verticalFov: 48, aspect: 16 / 9, near: 0.1, far: 1000,
  }))
}

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

function angularError(a: Vector3, b: Vector3): number {
  return Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize()))))
}

test('camera keyframes round trip seeded yaw, pitch, roll, position and camera basis', () => {
  const rand = random(0xBB52026)
  for (let i = 0; i < 64; i++) {
    const sign = i % 2 ? -1 : 1
    const yaw = sign * (160 + rand() * 20)
    const pitch = -80 + rand() * 160
    let roll = -180 + rand() * 360
    if (Math.abs(roll) < 1) roll = roll < 0 ? -1 : 1
    const sourceRotation = new Quaternion().fromArray(bbsCameraQuaternion(yaw, pitch, roll)).normalize()
    const position = [rand() * 200 - 100, rand() * 40 - 20, rand() * 200 - 100]
    const key = cameraSamplesToFilm(cameraShot(sourceRotation.toArray(), position)).cameras[0]!.keyframes[0]!
    const result = bbsCameraToThree(key, 16 / 9)
    assert.ok(result.position.distanceTo(new Vector3().fromArray(position)) <= 1e-6)
    const expectedForward = new Vector3(0, 0, -1).applyQuaternion(sourceRotation)
    const expectedUp = new Vector3(0, 1, 0).applyQuaternion(sourceRotation)
    const actualForward = new Vector3(0, 0, -1).applyQuaternion(result.quaternion)
    const actualUp = new Vector3(0, 1, 0).applyQuaternion(result.quaternion)
    assert.ok(angularError(actualForward, expectedForward) <= 1e-6, `forward differs at pose ${i}`)
    assert.ok(angularError(actualUp, expectedUp) <= 1e-6, `up differs at pose ${i}`)
    assert.equal(result.fov, 48)
    assert.equal(result.aspect, 16 / 9)
    assert.equal(result.near, 0.05)
  }
})

test('actor manifest transforms reconstruct the original App 2 world matrix', () => {
  const originalMatrix = new Matrix4().compose(
    new Vector3(4.5, 1.25, -8),
    new Quaternion().setFromEuler(new Euler(27 * radians, -143 * radians, 0, 'YXZ')),
    new Vector3(1, 1, 1),
  )
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
        actorWorldMatrix: originalMatrix.toArray(),
        bones: [{ name: 'root', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], worldMatrix: identity }] }] })),
  }
  const profile: ConvertedFilmModelProfile = {
    schemaVersion: 1, sourceSha256: 'b'.repeat(64), modelId: 'unified/bbbbbbbbbbbbbbbb', metersPerUnit: 1,
    bones: [{ name: 'root', parent: null, bobjRestMatrixRowMajor: identity }], actions: [], textureRequired: false,
    files: [{ sourcePath: 'C:/models/model.bobj', targetPath: 'model.bobj', sha256: 'c'.repeat(64) }],
  }
  const manifest = buildFilmExportManifest(input as never, new Map([['asset', profile]]), 'take')
  const sample = manifest.actors[0]!.transformSamples[0]!
  const reconstructed = bbsActorToThree(sample)
  assert.ok(reconstructed.elements.every((value, i) => Math.abs(value - originalMatrix.elements[i]!) <= 1e-9))
})

test('film frame uses the largest centered rectangle for the requested aspect', () => {
  assert.deepEqual(filmFrameRect(1920, 1080, 1), { x: 420, y: 0, width: 1080, height: 1080 })
  assert.deepEqual(filmFrameRect(1000, 1000, 16 / 9), { x: 0, y: 218.75, width: 1000, height: 562.5 })
})
