import test from 'node:test'
import assert from 'node:assert/strict'
import { floorMetric, heightMetric, distanceMetric, contactMetric, gatesMetric, continuityMetric, apply, mul } from './tools/measure.mjs'

const data = {}
for (let f = 0; f <= 100; f++) {
  const dip = f >= 41 && f <= 47 ? -0.12 * (1 - Math.abs(f - 44) / 4) : 0.0
  data[f] = {
    a: { head: [0, 1.6, 0], hip: [0, 0.9, 0], torso: [0.8], low: [dip], feet: [0, 0, 0], bone: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0, f === 60 ? 1.0 : 2.0, 0, 1], bones: { hand: [0, 1 + f / 100, 0] } },
    b: { head: [f / 10, 1.5, 0], hip: [f / 10, 0.9, 0], torso: [0.8], low: [0], feet: [0, 0, 0], bones: { hand: [f / 10, 1, 3] } },
  }
}

test('floor reports dip range and worst', () => {
  const [l] = floorMetric(data, ['a'])
  assert.match(l, /min -12 cm @44/)
  assert.match(l, /41-47 below floor, worst -12 cm @44/)
  assert.match(floorMetric(data, ['b'])[0], /never below/)
  assert.match(floorMetric(data, ['a'], [0, 30])[0], /never below/)
})

test('height every step', () => {
  const [l] = heightMetric(data, ['a'], { point: 'head', step: 50 })
  assert.equal(l, 'a head Y cm: 0:160 50:160 100:160')
  assert.match(heightMetric(data, ['a'], { bone: 'hand', frames: [0, 20], step: 10 })[0], /0:100 10:110 20:120/)
})

test('distance horizontal min/max', () => {
  const [row, mm] = distanceMetric(data, 'a', 'b', { step: 50 })
  assert.match(row, /0:0 50:500 100:1000/)
  assert.equal(mm, 'min 0 cm @0, max 1000 cm @100')
  assert.match(distanceMetric(data, 'a', 'b', { bone: 'hand', step: 100 })[0], /0:300 100:/)
  assert.match(distanceMetric(data, 'a', 'b', { bone: 'nope' })[0], /no data/)
})

test('matrix helpers and contact', () => {
  const T = [1,0,0,0, 0,1,0,0, 0,0,1,0, 1,2,3,1]
  assert.deepEqual(apply(mul(T, T), [0, 0, 0]), [2, 4, 6])
  const idg = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
  // tip = (0, 1, 0) + bone translation (0, 1 at f60) => (0,2,0); head top of a = 1.7 => 30 cm; at f60 tip (0,2,0)... use b target
  const r = contactMetric(data, { holder: 'a', other: 'a', grip: idg, gateFrame: 60 })
  assert.match(r[0], /closest 30 cm @\d+/)
  assert.equal(r[1], 'at gate frame 60: 30 cm')
  // bone y 1.0 at f60 -> tip y 2.0; make head top reach it
  const d2 = structuredClone(data); d2[60].a.head[1] = 1.9
  assert.match(contactMetric(d2, { holder: 'a', other: 'a', grip: idg })[0], /closest 0 cm @60/)
})

test('gates and continuity', () => {
  const g = [['CONTINUITY hero', 'PASS', '0.5 cm (x)'], ['FLOOR go 0+', 'FAIL', 'lowest point -12 cm @44'], ['SEAM_JUMP go', 'PASS', 'ok']]
  const out = gatesMetric(g)
  assert.deepEqual(out, ['gates: 2 PASS, 1 FAIL', 'FAIL FLOOR go 0+: lowest point -12 cm @44'])
  assert.deepEqual(continuityMetric(g, ['hero']), ['hero: frame 0 vs previous shot 0.5 cm (x) [PASS]'])
  assert.match(continuityMetric([], null)[0], /no data/)
})
