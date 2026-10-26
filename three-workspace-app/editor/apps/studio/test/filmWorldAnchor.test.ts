import assert from 'node:assert/strict'
import test from 'node:test'
import { applyFilmWorldAnchor, resolveFilmWorldAnchor, parseMinecraftTp } from '../src/filmWorldAnchor.ts'

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


test('F3+C accepts decimal commas, plain tp and whitespace; rejects relative/incomplete/malformed commands', () => {
  assert.deepEqual(parseMinecraftTp('  /execute  in minecraft:overworld run tp @s 107.08 -60.00 207.13 -64.47 7.50  '), {
    dimension: 'minecraft:overworld', x: 107.08, y: -60, z: 207.13, yaw: -64.47, pitch: 7.5,
  })
  assert.equal(parseMinecraftTp('/tp @s 107,08 -60 207,13 -64,47 7,5').yaw, -64.47)
  assert.equal(parseMinecraftTp('/execute in minecraft:the_nether run tp @s 0 70 0 0 0').dimension, 'minecraft:the_nether')
  for (const input of ['/tp @s ~ 1 2 0 0', '/tp @s 1 2 3', '/tp @s 1 2 3 NaN 0', '/tp @s 1 2 3 0 91', '/tp @s 30000001 2 3 0 0', '/tp @p 1 2 3 0 0']) {
    assert.throws(() => parseMinecraftTp(input), /vị trí|Tọa độ/)
  }
})

test('S2 rotates actor, backdrop, camera and VFX positions around explicit pivot with Minecraft yaw', () => {
  const actor = { x: 10, y: 2, z: 21, yaw: 20, pitch: 5 }
  const prop = { x: 11, y: 2, z: 20, yaw: 30 }
  const camera = { x: 10, y: 4, z: 21, yaw: 180, roll: 15, pitch: 7 }
  const effect = { x: 10, y: 2, z: 21, yaw: 12 }
  const anchor = resolveFilmWorldAnchor({ mode: 'local-origin', pivot: [10, 2, 20], destination: [107.08, -60, 207.13], yawDegrees: -64.47 }, [999, 999, 999])
  applyFilmWorldAnchor({ actors: [{ transformSamples: [actor] }, { transformSamples: [prop] }], cameras: [{ keyframes: [camera] }] }, anchor, [effect])
  assert.ok(Math.abs(actor.x - 107.08 - Math.sin(64.47 * Math.PI / 180)) < 1e-10)
  assert.ok(Math.abs(actor.z - 207.13 - Math.cos(64.47 * Math.PI / 180)) < 1e-10)
  assert.equal(actor.y, -60); assert.equal(actor.yaw, 20 - 64.47)
  assert.equal(camera.yaw, 180 - 64.47); assert.equal(camera.roll, 15); assert.equal(camera.pitch, 7)
  assert.equal(effect.x, actor.x); assert.equal(effect.yaw, 12 - 64.47)
  assert.equal(prop.yaw, 30 - 64.47)
})

test('pivot itself maps to the destination; rounding handles negative blocks and old anchors remain translations', () => {
  const point = { x: 10, y: 2, z: 20 }
  const anchor = resolveFilmWorldAnchor({ mode: 'local-origin', pivot: [10, 2, 20], destination: [107.08, -60, 207.13], yawDegrees: -64.47 }, [0, 0, 0])
  applyFilmWorldAnchor({ actors: [{ transformSamples: [point] }], cameras: [] }, anchor)
  assert.deepEqual(point, { x: 107.08, y: -60, z: 207.13 })
  assert.deepEqual(resolveFilmWorldAnchor({ mode: 'local-origin', destination: [-1.9, -60.3, 207.13], roundToBlock: true }, [0, 0, 0]).destination, [-1.5, -60, 207.5])
  assert.throws(() => resolveFilmWorldAnchor({ mode: 'local-origin', yawDegrees: NaN }, [0, 0, 0]))
})

test('destination-only legacy anchors retain translation semantics', () => {
  assert.deepEqual(resolveFilmWorldAnchor({ destination: [3, 4, 5] }, [1, 2, 3]).offset, [2, 2, 2])
})
