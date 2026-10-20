import assert from 'node:assert/strict'
import test from 'node:test'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { CameraSequenceSample } from '@topview/3d-builder/headless'
import { cameraSamplesToFilm, type FilmCameraKeyframe } from '../src/filmCamera.ts'

const radians = Math.PI / 180

// Invert the BBS 2.4 view rotation to reconstruct the world camera basis.
function bbsWorld(yaw: number, pitch: number, roll: number): Matrix4 {
  return new Matrix4().makeRotationZ(roll * radians)
    .multiply(new Matrix4().makeRotationX(pitch * radians))
    .multiply(new Matrix4().makeRotationY((yaw + 180) * radians)).invert()
}

function quaternion(yaw = 0, pitch = 0, roll = 0): number[] {
  return new Quaternion().setFromRotationMatrix(bbsWorld(yaw, pitch, roll)).toArray()
}

function shot(id = 'shot-a', duration = 2, start = 0): CameraSequenceSample[] {
  return Array.from({ length: duration + 1 }, (_, tick) => ({
    shotId: id, cameraNodeId: 'camera-a', sourceFrame: 30 + tick * 1.5,
    shotTimeSeconds: tick / 20, sequenceTimeSeconds: (start + tick) / 20,
    side: tick === duration ? 'left' : 'right', position: [tick, 2, -3],
    quaternion: quaternion(), lookAt: [0, 0, 0], verticalFov: 55 + tick / 10,
    aspect: 16 / 9, near: 0.1, far: 1000,
  }))
}

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`)
}

function assertBasis(key: FilmCameraKeyframe, source: number[]) {
  const rotation = new Quaternion().fromArray(source).normalize()
  const reconstructed = bbsWorld(key.yaw, key.pitch, key.roll)
  for (const axis of [[0, 0, -1], [0, 1, 0], [1, 0, 0]]) {
    const expected = new Vector3().fromArray(axis).applyQuaternion(rotation)
    const actual = new Vector3().fromArray(axis).transformDirection(reconstructed)
    assert.ok(actual.distanceTo(expected) < 1e-9, `Basis differs for ${JSON.stringify(key)}: ${actual.toArray()} vs ${expected.toArray()}`)
  }
}

test('returns worker camera schema, relative ticks, vertical FOV, duration and aspect without mutation', () => {
  const samples = shot('main', 60)
  const before = structuredClone(samples)
  for (const sample of samples) {
    Object.freeze(sample.position)
    Object.freeze(sample.quaternion)
    Object.freeze(sample.lookAt)
    Object.freeze(sample)
  }
  const result = cameraSamplesToFilm(Object.freeze(samples))
  assert.deepEqual(Object.keys(result).sort(), ['aspect', 'cameras', 'durationTicks'])
  assert.equal(result.durationTicks, 60)
  assert.equal(result.aspect, 16 / 9)
  assert.equal(result.cameras.length, 1)
  const camera = result.cameras[0]
  assert.deepEqual(Object.keys(camera).sort(), ['durationTicks', 'id', 'keyframes', 'startTick'])
  assert.equal(camera.id, 'main')
  assert.equal(camera.startTick, 0)
  assert.equal(camera.durationTicks, 60)
  assert.equal(camera.keyframes.length, 61)
  camera.keyframes.forEach((key, tick) => {
    assert.deepEqual(Object.keys(key).sort(), ['pitch', 'roll', 'tick', 'verticalFovDegrees', 'x', 'y', 'yaw', 'z'])
    assert.equal(key.tick, tick)
    assert.deepEqual([key.x, key.y, key.z], samples[tick].position)
    assert.equal(key.verticalFovDegrees, samples[tick].verticalFov)
    assertBasis(key, samples[tick].quaternion)
  })
  assert.deepEqual(samples, before)
})

test('reconstructs Three -Z forward, +Y up and +X right for cardinal, rolled, tilted and vertical cameras', () => {
  const rotations = [
    [0, 0, 0, 1], quaternion(0, 0, 0), quaternion(90, 0, 0), quaternion(-90, 0, 0),
    quaternion(45, 35, 70), quaternion(-150, -60, -110), quaternion(25, 90, 40),
    quaternion(-80, -90, 120), quaternion(40, 91, -35), quaternion(0, 180, 0),
    ...Array.from({ length: 100 }, (_, i) => new Quaternion().setFromEuler(new Euler(i * 0.71, i * 0.37, i * -0.23, 'XYZ')).toArray()),
  ]
  for (const rotation of rotations) {
    const samples = shot()
    samples.forEach((sample) => { sample.quaternion = rotation })
    cameraSamplesToFilm(samples).cameras[0].keyframes.forEach((key) => assertBasis(key, rotation))
  }
  const samples = shot()
  samples.forEach((sample) => { sample.quaternion = quaternion(45, 35, 70) })
  const key = cameraSamplesToFilm(samples).cameras[0].keyframes[0]
  close(key.yaw, 45)
  close(key.pitch, 35)
  close(key.roll, 70)
})

test('unwraps yaw and roll independently within a shot, including quaternion sign flips', () => {
  const samples = shot('wrap', 4)
  samples.forEach((sample, i) => {
    sample.quaternion = quaternion(170 + i * 10, 20, -170 - i * 10).map((value) => i % 2 ? -value : value)
  })
  const keys = cameraSamplesToFilm(samples).cameras[0].keyframes
  keys.forEach((key, i) => {
    close(key.yaw, 170 + i * 10)
    close(key.pitch, 20)
    close(key.roll, -170 - i * 10)
    assertBasis(key, samples[i].quaternion)
  })
})

test('retains basis and angular continuity across both vertical poles', () => {
  for (const sign of [-1, 1]) {
    const samples = shot('pole', 4)
    samples.forEach((sample, i) => { sample.quaternion = quaternion(30, sign * (80 + i * 5), 25) })
    cameraSamplesToFilm(samples).cameras[0].keyframes.forEach((key, i) => {
      close(key.yaw, 30)
      close(key.pitch, sign * (80 + i * 5))
      close(key.roll, 25)
      assertBasis(key, samples[i].quaternion)
    })
  }
})

test('preserves outgoing left endpoint and incoming right cut separately and resets angle continuity', () => {
  const first = shot('first', 2)
  first.forEach((sample, i) => { sample.quaternion = quaternion(170 + i * 10, 0, 0) })
  const next = shot('next', 2, 2)
  next.forEach((sample) => { sample.quaternion = quaternion(-170, 0, 0); sample.position = [90, 8, 5] })
  const result = cameraSamplesToFilm([...first, ...next])
  assert.equal(result.durationTicks, 4)
  assert.deepEqual(result.cameras.map(({ id, startTick, durationTicks }) => ({ id, startTick, durationTicks })), [
    { id: 'first', startTick: 0, durationTicks: 2 }, { id: 'next', startTick: 2, durationTicks: 2 },
  ])
  const left = result.cameras[0].keyframes[2], right = result.cameras[1].keyframes[0]
  assert.equal(left.tick, 2)
  assert.equal(right.tick, 0)
  assert.equal(left.x, 2)
  assert.equal(right.x, 90)
  close(left.yaw, 190)
  close(right.yaw, -170)
})

test('accepts only floating-point tick noise, without rounding real off-grid boundaries', () => {
  const samples = shot('noise', 6)
  samples[6].shotTimeSeconds = samples[6].sequenceTimeSeconds = 0.1 + 0.2
  assert.equal(cameraSamplesToFilm(samples).durationTicks, 6)
  samples[6].shotTimeSeconds = samples[6].sequenceTimeSeconds = 1 / 3
  assert.throws(() => cameraSamplesToFilm(samples), /20 Hz tick grid/)
})

test('enforces contiguous 20 Hz samples and complete positive-duration shot boundaries', () => {
  const invalid: CameraSequenceSample[][] = [
    shot('zero', 0), shot().slice(1), shot().slice(0, -1), [shot()[0], shot()[2]],
    [shot()[0], shot()[0], shot()[2]], [...shot(), shot()[2]],
    [...shot().slice(0, -1), ...shot('next', 2, 2)],
    [...shot(), ...shot('gap', 2, 3)], [...shot(), ...shot('overlap', 2, 1)],
    [...shot(), ...shot('next', 2, 2), ...shot('shot-a', 2, 4)],
  ]
  for (const samples of invalid) assert.throws(() => cameraSamplesToFilm(samples), RangeError)
  for (const patch of [
    { shotTimeSeconds: 0.025, sequenceTimeSeconds: 0.025 },
    { shotTimeSeconds: 0.1, sequenceTimeSeconds: 0.1 },
    { sequenceTimeSeconds: 0.1 }, { cameraNodeId: 'different-camera' },
  ]) {
    const samples = shot()
    Object.assign(samples[1], patch)
    assert.throws(() => cameraSamplesToFilm(samples), RangeError)
  }
  const offset = shot('offset', 2, 1)
  assert.throws(() => cameraSamplesToFilm(offset), /sequence tick zero/)
})

test('enforces worker caps including endpoints, accepts iterables, and stops oversized streams', () => {
  const maximum = [...shot('a', 255), ...shot('b', 255, 255), ...shot('c', 255, 510)]
  const result = cameraSamplesToFilm(maximum.values())
  assert.equal(result.durationTicks, 765)
  assert.deepEqual(result.cameras.map((camera) => camera.keyframes.length), [256, 256, 256])
  assert.throws(() => cameraSamplesToFilm([...maximum, ...shot('d', 1, 765)]), /at most 3/)
  assert.throws(() => cameraSamplesToFilm(shot('oversized', 256)), /at most 256/)
  let consumed = 0
  function* endless() {
    while (true) {
      const sample = shot()[0]
      sample.shotTimeSeconds = sample.sequenceTimeSeconds = consumed++ / 20
      yield sample
    }
  }
  assert.throws(() => cameraSamplesToFilm(endless()), /at most 256/)
  assert.equal(consumed, 257)
  assert.throws(() => cameraSamplesToFilm([]), /at least one/)
})

test('rejects changing or invalid aspect and FOV, including across a cut', () => {
  for (const aspect of [0, -1, NaN, Infinity, 4 / 3]) {
    const samples = shot()
    samples[1].aspect = aspect
    assert.throws(() => cameraSamplesToFilm(samples), /aspect/)
  }
  for (const verticalFov of [0, -1, 180, 200, NaN, Infinity]) {
    const samples = shot()
    samples[1].verticalFov = verticalFov
    assert.throws(() => cameraSamplesToFilm(samples), /FOV/)
  }
  const next = shot('next', 2, 2)
  next.forEach((sample) => { sample.aspect = 4 / 3 })
  assert.throws(() => cameraSamplesToFilm([...shot(), ...next]), /same throughout/)
})

test('rejects non-finite, out-of-float-range and malformed sample values', () => {
  const invalid: Partial<CameraSequenceSample>[] = [
    { position: [Infinity, 0, 0] }, { position: [0, NaN, 0] }, { position: [0, 0, 1e39] },
    { position: [0, 0] }, { position: new Array(3) }, { lookAt: [0, 0, NaN] },
    { sourceFrame: NaN }, { sourceFrame: -1 }, { near: 0 }, { near: NaN },
    { far: Infinity }, { far: 0.01 }, { shotTimeSeconds: NaN }, { shotTimeSeconds: -0.05 },
    { sequenceTimeSeconds: Infinity }, { sequenceTimeSeconds: Number.MAX_SAFE_INTEGER },
    { shotId: '' }, { shotId: ' ' }, { shotId: 'x'.repeat(129) }, { cameraNodeId: '' },
    { side: 'invalid' as CameraSequenceSample['side'] },
  ]
  for (const patch of invalid) {
    const samples = shot()
    Object.assign(samples[0], patch)
    assert.throws(() => cameraSamplesToFilm(samples))
  }
})

test('rejects invalid quaternions and normalizes only small unit-length drift', () => {
  for (const rotation of [[0, 0, 0, 0], [0, 0, 0, 2], [0, 0, 0], [NaN, 0, 0, 1],
    [0, Infinity, 0, 1], [0, 0, 0, 1e-20], new Array(4)]) {
    const samples = shot()
    samples[1].quaternion = rotation
    assert.throws(() => cameraSamplesToFilm(samples), /quaternion/)
  }
  const samples = shot()
  samples.forEach((sample) => { sample.quaternion = quaternion(42, -25, 70).map((value) => value * (1 + 1e-8)) })
  cameraSamplesToFilm(samples).cameras[0].keyframes.forEach((key, i) => assertBasis(key, samples[i].quaternion))
})
