import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { MotionClip } from '../../../contract/types'
import { motionTimeSeconds } from '../../../evaluate/clips'
import { motionStretchPatch } from '../../../document/clipStretch'

const clip = {
  frameStart: 10, frameEnd: 29, sourceDuration: 2,
  playback: { speed: 1, loop: false }, motion: { time: 0 },
} as MotionClip

test('both edges stretch the complete source at 50% without changing its start', () => {
  for (const [start, end] of [[10, 49], [0, 39]]) {
    const patch = motionStretchPatch(clip, 10, start, end)!
    assert.equal(patch.speed, 0.5)
    const stretched = { ...clip, ...patch, playback: { ...clip.playback, speed: patch.speed } }
    assert.equal(motionTimeSeconds(stretched, start, 10), 0)
    assert.equal(motionTimeSeconds(stretched, start + 10, 10), 0.5)
    assert.equal(motionTimeSeconds(stretched, end, 10), 1.95)
    assert.equal(stretched.motion.time, 0)
    assert.equal(JSON.parse(JSON.stringify(stretched)).playback.speed, 0.5)
  }
})

test('uses the trimmed source window and supports faster playback', () => {
  const trimmed = { ...clip, motion: { ...clip.motion, time: 0.5, sourceLengthSeconds: 1 } }
  assert.equal(motionStretchPatch(trimmed, 10, 0, 19)?.speed, 0.5)
  assert.equal(motionStretchPatch(clip, 10, 0, 9)?.speed, 2)
  assert.equal(motionStretchPatch(clip, 10, 1, 0), null)
  assert.equal(motionStretchPatch(clip, 0, 0, 20), null)
})

test('20 source frames stretched to inclusive 0..39 are exactly 50%', () => {
  const source = { ...clip, sourceDuration: 20 / 30 }
  const patch = motionStretchPatch(source, 30, 0, 39)!
  assert.equal(patch.speed, 0.5)
  const result = { ...source, ...patch, playback: { ...source.playback, speed: patch.speed } }
  assert.equal(motionTimeSeconds(result, 20, 30), 10 / 30)
  assert.deepEqual(result.motion, source.motion)
  assert.equal(motionStretchPatch(source, 30, 0, 0), null)
  assert.equal(motionStretchPatch({ ...source, sourceDuration: 16 / 30 }, 30, 0, 0)?.speed, 16)
})

test('speed contract accepts .01 and 16 and rejects values outside it', () => {
  assert.equal(motionStretchPatch(clip, 10, 0, 1999)?.speed, 0.01)
  assert.equal(motionStretchPatch(clip, 10, 0, 2000), null)
  assert.equal(motionStretchPatch(clip, 10, 0, 0), null)
})
