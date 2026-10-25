import assert from 'node:assert/strict'
import { test } from 'vitest'
import { advanceFrameWithinRange } from '../../evaluate/timecode'
import {
  clampInOutRange,
  normalizeInOutRange,
  parseTimelineInOut,
  readTimelineInOut,
  serializeTimelineInOut,
  timelineInOutStorageKey,
  writeTimelineInOut,
} from '../inOutPreference'

test('normalizeInOutRange rounds and orders the range', () => {
  assert.deepEqual(normalizeInOutRange(10.4, 20.6), { start: 10, end: 21 })
  assert.deepEqual(normalizeInOutRange(30, 12), { start: 12, end: 30 })
  assert.equal(normalizeInOutRange(Number.NaN, 5), null)
})

test('clampInOutRange keeps the range inside the timeline', () => {
  const tl = { frameStart: 0, frameEnd: 299 }
  assert.deepEqual(clampInOutRange({ start: -5, end: 120 }, tl), { start: 0, end: 120 })
  assert.deepEqual(clampInOutRange({ start: 250, end: 400 }, tl), { start: 250, end: 299 })
  assert.equal(clampInOutRange({ start: 400, end: 500 }, tl), null)
})

test('in/out mirror round-trips through storage per draft', () => {
  const backing = new Map<string, string>()
  const storage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => { backing.set(key, value) },
    removeItem: (key: string) => { backing.delete(key) },
  }
  assert.equal(timelineInOutStorageKey('draft-1'), 'topview.builder.timeline.inOut.draft-1')
  assert.equal(readTimelineInOut(storage, 'draft-1'), null)
  writeTimelineInOut(storage, 'draft-1', { start: 12, end: 131 })
  assert.deepEqual(readTimelineInOut(storage, 'draft-1'), { start: 12, end: 131 })
  // Draft khác không thấy khoảng của draft này.
  assert.equal(readTimelineInOut(storage, 'draft-2'), null)
  writeTimelineInOut(storage, 'draft-1', null)
  assert.equal(readTimelineInOut(storage, 'draft-1'), null)
  // Dữ liệu hỏng -> null, không ném lỗi.
  backing.set(timelineInOutStorageKey('draft-1'), '{broken')
  assert.equal(readTimelineInOut(storage, 'draft-1'), null)
  assert.equal(parseTimelineInOut(serializeTimelineInOut({ start: 3, end: 9 }))?.end, 9)
})

test('advanceFrameWithinRange loops inside the range', () => {
  // Trong khoảng: tiến bình thường.
  assert.equal(advanceFrameWithinRange(10, 1, 10, 20), 11)
  // Vượt Out: vòng về In, giữ phần dư.
  assert.equal(advanceFrameWithinRange(20, 1, 10, 20), 10)
  assert.equal(advanceFrameWithinRange(19, 5, 10, 20), 13)
  // Delta lớn vẫn nằm trong khoảng.
  assert.equal(advanceFrameWithinRange(10, 25, 10, 20), 13)
  // Playhead ngoài khoảng: phát lại từ In.
  assert.equal(advanceFrameWithinRange(0, 1, 10, 20), 10)
  assert.equal(advanceFrameWithinRange(99, 1, 10, 20), 10)
  // Khoảng 1 frame: đứng yên.
  assert.equal(advanceFrameWithinRange(7, 3, 7, 7), 7)
})
