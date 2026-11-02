import assert from 'node:assert/strict'
import test from 'node:test'
import { shotClipPayload, shotExtendMode } from '../src/shotClip'

// Action 2 giây; clip trên timeline dài 6 giây (frame 0..179 @30fps).
const base = { frameStart: 0, frameEnd: 179 }
const binding = { sourceStartSeconds: 0, sourceLengthSeconds: 2, reverse: false }

test('B20 hold keeps the source range inside the action and does not loop', () => {
  const p = shotClipPayload({ ...base, playback: { speed: 1, loop: false, loopMode: 'repeat' } }, binding, 30, 0, 2)
  assert.equal(p.extendMode, 'hold')
  assert.equal(p.loop, false)
  assert.equal(p.sourceEndSeconds, 2)
  assert.equal(p.speed, 1)
})

test('B20 loop exports loop=true with the end clamped to the action', () => {
  const p = shotClipPayload({ ...base, playback: { speed: 1, loop: true, loopMode: 'repeat' } }, { ...binding, sourceLengthSeconds: 2.5 }, 30, 0, 2)
  assert.equal(p.loop, true)
  assert.equal(p.sourceEndSeconds, 2)
  assert.throws(() => shotClipPayload({ ...base, playback: { speed: 1, loop: true, loopMode: 'repeat' } }, binding, 30, 30, 2), /loop shots/)
})

test('B20 stretch fills the clip through speed, never beyond the action', () => {
  const p = shotClipPayload({ ...base, playback: { speed: 1, loop: false, loopMode: 'stretch' } }, binding, 30, 0, 2)
  assert.equal(p.extendMode, 'stretch')
  assert.equal(p.loop, false)
  assert.ok(Math.abs(p.speed - 2 / 6) < 1e-9)
  assert.equal(p.sourceEndSeconds, 2)
  const mid = shotClipPayload({ ...base, playback: { speed: 1, loop: false, loopMode: 'stretch' } }, binding, 30, 90, 2)
  assert.ok(Math.abs(mid.sourceStartSeconds - 1) < 1e-9)
  assert.ok(mid.sourceEndSeconds <= 2)
})

test('B20 reverse and legacy mode derivation', () => {
  const p = shotClipPayload({ ...base, playback: { speed: 2, loop: false } }, { sourceStartSeconds: 0.5, sourceLengthSeconds: 1, reverse: true }, 30, 15, 1.2)
  assert.ok(p.sourceEndSeconds <= 1.2 && p.sourceStartSeconds <= p.sourceEndSeconds)
  assert.equal(shotExtendMode({ speed: 1, loop: true }), 'loop')
  assert.equal(shotExtendMode({ speed: 1, loop: false }), 'hold')
})
