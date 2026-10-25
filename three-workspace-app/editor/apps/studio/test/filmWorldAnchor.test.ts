import assert from 'node:assert/strict'
import test from 'node:test'
import { applyFilmWorldAnchor, resolveFilmWorldAnchor } from '../src/filmWorldAnchor.ts'

test('rebases every world transform, preserving signed orientation, floor and relative camera distances at 0/70/149', () => {
  const actors = [0, 70, 149].map((tick) => ({ tick, x: 10000 + tick / 10, y: 500 + tick / 100, z: -8000 - tick / 5, yaw: -37 + tick / 4, pitch: 13 }))
  const prop = { x: 10012, y: 498.75, z: -8003, yaw: 123, pitch: -12 }
  const camera = actors.map((point) => ({ ...point, x: point.x + 3, y: point.y + 5, z: point.z - 7, yaw: 171, pitch: -21, roll: 8 }))
  const effect = { x: 10004, y: 501, z: -8008 }
  const manifest = { actors: [{ transformSamples: actors }, { transformSamples: [prop] }], cameras: [{ keyframes: camera }] }
  const original = structuredClone(manifest)
  const anchor = resolveFilmWorldAnchor({ mode: 'local-origin', destination: [-230, 67.25, 412] }, [10000, 500, -8000])
  applyFilmWorldAnchor(manifest, anchor, [effect])
  assert.deepEqual(actors[0], { tick: 0, x: -230, y: 67.25, z: 412, yaw: -37, pitch: 13 })
  assert.equal(prop.y, 66) // Nonzero floor offset remains 1.25 blocks below the pivot.
  for (let i = 0; i < actors.length; i++) {
    assert.equal(actors[i]!.yaw, original.actors[0]!.transformSamples[i]!.yaw)
    assert.deepEqual([camera[i]!.x - actors[i]!.x, camera[i]!.y - actors[i]!.y, camera[i]!.z - actors[i]!.z], [3, 5, -7])
    assert.equal(camera[i]!.roll, 8)
  }
  assert.deepEqual(effect, { x: -226, y: 68.25, z: 404 })
  assert.equal(anchor.playerPositionRead, false)
})

test('scene origin is explicit identity; default is explicit local world coordinates', () => {
  assert.deepEqual(resolveFilmWorldAnchor({ mode: 'scene-origin' }, [5, 6, 7]).offset, [0, 0, 0])
  assert.deepEqual(resolveFilmWorldAnchor(undefined, [10000, 500, -8000]).offset, [-10000, -436, 8000])
  assert.throws(() => resolveFilmWorldAnchor({ mode: 'local-origin', destination: [NaN, 0, 0] }, [0, 0, 0]))
  assert.throws(() => resolveFilmWorldAnchor({ mode: 'local-origin', sourceOrigin: [0, Infinity, 0] }, [0, 0, 0]))
})
