import assert from 'node:assert/strict'
import test from 'node:test'
import {
  alignFilmRangeToTickGrid,
  filmGridFrameStep,
  readStoredTimelineInOut,
  resolveTimelineInOutDefault,
  timelineInOutStorageKey,
} from '../src/timelineInOut'

const timeline = { frameStart: 0, frameEnd: 299, fps: 30 }

test('filmGridFrameStep matches the 20 Hz tick grid (30 fps -> 3, 24 fps -> 6, 20 fps -> 1)', () => {
  assert.equal(filmGridFrameStep(30), 3)
  assert.equal(filmGridFrameStep(24), 6)
  assert.equal(filmGridFrameStep(20), 1)
  assert.equal(filmGridFrameStep(60), 3)
})

test('alignFilmRangeToTickGrid extends the end like E2 (0-27 at 30 fps -> 0-29)', () => {
  const aligned = alignFilmRangeToTickGrid({ startFrame: 0, endFrame: 27 }, 30, timeline)
  assert.deepEqual(aligned.range, { startFrame: 0, endFrame: 29 })
  assert.equal(aligned.changed, true)
  assert.equal(aligned.ticks, 20)
})

test('alignFilmRangeToTickGrid keeps aligned ranges and shortens at the timeline end', () => {
  const already = alignFilmRangeToTickGrid({ startFrame: 0, endFrame: 29 }, 30, timeline)
  assert.equal(already.changed, false)
  assert.equal(already.ticks, 20)
  // 280-299 = 20 frame, step 3 -> nới cuối vượt 299 nên rút xuống 280-298 (19 frame? không: 280-297 = 18 frame = 12 tick)
  const shortened = alignFilmRangeToTickGrid({ startFrame: 280, endFrame: 299 }, 30, timeline)
  assert.deepEqual(shortened.range, { startFrame: 280, endFrame: 297 })
  assert.equal(shortened.ticks, 12)
})

test('default range from a selected shot: 4 s shot at 30 fps spans whole ticks', () => {
  // Shot 01 dài 4 s = frame 100-219 (120 frame) -> đã nguyên lưới tick (80 tick), giữ nguyên.
  const backing = new Map<string, string>([[timelineInOutStorageKey('p1'), JSON.stringify({ start: 100, end: 219 })]])
  const storage = { getItem: (key: string) => backing.get(key) ?? null }
  assert.deepEqual(readStoredTimelineInOut('p1', storage), { startFrame: 100, endFrame: 219 })
  const resolved = resolveTimelineInOutDefault('p1', timeline, storage)
  // Không có live studio trong test: dùng mirror; 120 frame là bội của bước 3 nên không đổi.
  assert.deepEqual(resolved, { startFrame: 100, endFrame: 219 })
})

test('stored In/Out range is rounded outward to the tick grid (10-37 -> 10-39)', () => {
  const backing = new Map<string, string>([[timelineInOutStorageKey('p2'), JSON.stringify({ start: 10, end: 37 })]])
  const storage = { getItem: (key: string) => backing.get(key) ?? null }
  assert.deepEqual(readStoredTimelineInOut('p2', storage), { startFrame: 10, endFrame: 37 })
  // 28 frame chưa nguyên lưới 3: nới cuối lên 39 -> 30 frame = 20 tick.
  const aligned = alignFilmRangeToTickGrid({ startFrame: 10, endFrame: 37 }, 30, timeline)
  assert.deepEqual(aligned.range, { startFrame: 10, endFrame: 39 })
  assert.equal(aligned.ticks, 20)
  assert.deepEqual(resolveTimelineInOutDefault('p2', timeline, storage), { startFrame: 10, endFrame: 39 })
})

test('resolveTimelineInOutDefault returns null without any In/Out', () => {
  assert.equal(resolveTimelineInOutDefault('no-such-project', timeline), null)
  assert.equal(readStoredTimelineInOut('no-such-project', { getItem: () => null }), null)
  assert.equal(readStoredTimelineInOut('p3', { getItem: () => '{broken' }), null)
})
