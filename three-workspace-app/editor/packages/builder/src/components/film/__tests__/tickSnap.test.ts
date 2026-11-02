import { test } from 'vitest'
import assert from 'node:assert/strict'
import { snapCutToTicks, snapTrimEnd, snapTrimStart, tickGridFrames } from '../tickSnap'

test('tick grid step per fps', () => {
  assert.equal(tickGridFrames(30), 3)
  assert.equal(tickGridFrames(60), 3)
  assert.equal(tickGridFrames(24), 6)
  assert.equal(tickGridFrames(25), 5)
  assert.equal(tickGridFrames(20), 1)
  assert.equal(tickGridFrames(29.97), null)
})

test('cuts snap to multiples of 3 frames at 30 fps; trim-end keeps the inclusive end convention', () => {
  assert.equal(snapCutToTicks(10, 30), 9)
  assert.equal(snapCutToTicks(11, 30), 12)
  assert.equal(snapTrimStart(14, 30), 15)
  assert.equal(snapTrimEnd(97, 30), 98)
  assert.equal(snapTrimEnd(99, 30), 98)
  assert.equal(snapTrimEnd(100, 30), 101)
  assert.equal(snapTrimStart(0, 30), 0)
  assert.equal(snapCutToTicks(10, 29.97), 10)
})
