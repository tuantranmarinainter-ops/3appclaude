import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, MotionClip } from '../../contract/types'
import { duplicateGapStart, extendedClipEnd, findFreeGapStart, shotRangeAt, splitMotionClip } from '../timelineClipOps'
import { motionTimeSeconds } from '../../evaluate/clips'

const clip = (id: string, start: number, end: number, node = 'a'): MotionClip => ({
  id, frameStart: start, frameEnd: end, target: { type: 'character', nodeId: node },
  source: 't', sourceDuration: 4,
  playback: { version: 1, speed: 1, loop: false, loopMode: 'repeat' },
  motion: { assetId: id, name: id, source: 't', sourceRig: 'mixamorig', url: '', inPlace: true, loop: false, speed: 1, time: 0 },
})
const gap = (clips: [number, number][], from: number, len: number, limit: [number, number]) =>
  findFreeGapStart(clips.map(([start, end]) => ({ start, end })), from, len, { start: limit[0], end: limit[1] })
const withShots = (shots: [number, number][]) => {
  const doc = makeEmptyDraft('d', 30, 300) as DirectorDocument
  doc.content.editorial = { version: 1, activeSequenceId: 's', sequences: [{ id: 's', clips: shots.map(([a, b], i) => ({ id: `c${i}`, cameraNodeId: 'cam', sourceFrameStart: a, sourceFrameEnd: b })) }] }
  return doc
}

test('gap finder picks the nearest free slot at or after the original end', () => {
  assert.equal(gap([[0, 10]], 10, 5, [0, 100]), 10)
  assert.equal(gap([[0, 10], [12, 20]], 10, 5, [0, 100]), 20)
  assert.equal(gap([[0, 10], [15, 20]], 10, 5, [0, 100]), 10)
  assert.equal(gap([[0, 10], [14, 20]], 10, 5, [0, 100]), 20)
  assert.equal(gap([[0, 10], [14, 20]], 10, 5, [0, 22]), null)
  assert.equal(gap([[0, 10]], 10, 5, [0, 14]), null)
})

test('duplicate placement stays inside the shot and only counts clips of the same node', () => {
  const doc = withShots([[0, 99], [100, 199]])
  assert.deepEqual(shotRangeAt(doc, 50), { start: 0, end: 100 })
  const original = clip('o', 20, 50)
  const other = clip('x', 0, 300, 'b')
  assert.equal(duplicateGapStart(doc, original, [original, other]), 50)
  assert.equal(duplicateGapStart(doc, original, [original, clip('n', 60, 120)]), null)
  const wide = clip('w', 20, 80)
  assert.equal(duplicateGapStart(doc, wide, [wide]), null)
  const second = clip('s2', 120, 150)
  assert.equal(duplicateGapStart(doc, second, [second]), 150)
  doc.content.editorial = undefined
  assert.equal(duplicateGapStart(doc, original, [original]), 50)
})

test('extend goes to the next clip of the same node, else shot end', () => {
  const doc = withShots([[0, 99]])
  const a = clip('a1', 10, 30)
  assert.equal(extendedClipEnd(doc, a, [a]), 100)
  assert.equal(extendedClipEnd(doc, a, [a, clip('a2', 60, 80)]), 60)
  assert.equal(extendedClipEnd(doc, a, [a, clip('b1', 60, 80, 'b')]), 100)
})

test('split keeps the motion continuous across the cut', () => {
  const original = clip('o', 30, 120)
  original.playback.speed = 2
  original.motion.time = 0.5
  const parts = splitMotionClip(original, 60, 30)!
  assert.equal(parts.first.frameEnd, 60)
  assert.equal(parts.second.frameStart, 60)
  assert.equal(parts.second.frameEnd, 120)
  const second = { ...parts.second, id: 'n' } as MotionClip
  for (const frame of [60, 75, 119]) {
    const whole = motionTimeSeconds(original, frame, 30)
    assert.ok(Math.abs(motionTimeSeconds(second, frame, 30) - whole) < 1e-9, `frame ${frame}`)
  }
  assert.ok(Math.abs(motionTimeSeconds(parts.first, 59, 30) - motionTimeSeconds(original, 59, 30)) < 1e-9)
  assert.equal(splitMotionClip(original, 30, 30), null)
  assert.equal(splitMotionClip(original, 120, 30), null)
})

test('split of a reversed clip continues downward', () => {
  const original = clip('r', 0, 60)
  original.motion.reverse = true
  original.motion.time = 0
  original.motion.sourceLengthSeconds = 3
  const parts = splitMotionClip(original, 30, 30)!
  const second = { ...parts.second, id: 'n' } as MotionClip
  for (const frame of [30, 45, 59]) {
    assert.ok(Math.abs(motionTimeSeconds(second, frame, 30) - motionTimeSeconds(original, frame, 30)) < 1e-9, `frame ${frame}`)
  }
})
