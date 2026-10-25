import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  formatDurationInUnit,
  formatFrameInUnit,
  frameToUnitValue,
  readTimelineUnit,
  timelineUnitRuler,
  unitValueToFrame,
  writeTimelineUnit,
} from '../utils/timeUnit'

test('frame <-> seconds at project fps 30', () => {
  assert.equal(frameToUnitValue(45, 30, 'seconds'), 1.5)
  assert.equal(unitValueToFrame(1.5, 30, 'seconds'), 45)
  assert.equal(unitValueToFrame(0.04, 30, 'seconds'), 1)
})

test('frame <-> ticks at 20 Hz BBS (30 fps: 3 frames = 2 ticks)', () => {
  assert.equal(frameToUnitValue(3, 30, 'ticks'), 2)
  assert.equal(frameToUnitValue(45, 30, 'ticks'), 30)
  assert.equal(unitValueToFrame(30, 30, 'ticks'), 45)
  assert.equal(unitValueToFrame(1, 30, 'ticks'), 2)
  // fps 20: 1 frame = 1 tick.
  assert.equal(frameToUnitValue(10, 20, 'ticks'), 10)
  assert.equal(unitValueToFrame(10, 20, 'ticks'), 10)
})

test('frames unit is identity and labels are compact', () => {
  assert.equal(frameToUnitValue(120, 30, 'frames'), 120)
  assert.equal(unitValueToFrame(120.4, 30, 'frames'), 120)
  assert.equal(formatFrameInUnit(120, 30, 'frames'), '120f')
  assert.equal(formatFrameInUnit(45, 30, 'seconds'), '1.5s')
  assert.equal(formatFrameInUnit(45, 30, 'ticks'), '30t')
  assert.equal(formatDurationInUnit(18, 30, 'seconds'), '0.6s')
  assert.equal(formatDurationInUnit(18, 30, 'ticks'), '12t')
  assert.equal(formatDurationInUnit(18, 30, 'frames'), '18f')
})

test('round trip frame -> unit -> frame is stable on grid points', () => {
  for (const frame of [0, 3, 30, 45, 90, 300]) {
    for (const unit of ['seconds', 'frames', 'ticks'] as const) {
      assert.equal(unitValueToFrame(frameToUnitValue(frame, 30, unit), 30, unit), frame)
    }
  }
})

test('unit ruler steps keep labels at least ~70px apart and tick steps stay integral', () => {
  const frames = timelineUnitRuler(1.5, 30, 'frames')
  assert.ok(frames.step * 1.5 >= 70)
  const seconds = timelineUnitRuler(1.5, 30, 'seconds')
  assert.ok(seconds.step * 1.5 >= 70)
  assert.equal(seconds.format(60), '2s')
  const ticks = timelineUnitRuler(1.5, 30, 'ticks')
  assert.ok(Number.isInteger(ticks.step))
  assert.ok(ticks.step * 1.5 >= 70)
  assert.equal(ticks.format(45), '30t')
  // Zoom sát: từng frame một.
  assert.equal(timelineUnitRuler(80, 30, 'frames').step, 1)
  assert.equal(timelineUnitRuler(60, 30, 'frames').step, 2)
  assert.equal(timelineUnitRuler(60, 30, 'ticks').step, 3)
})

test('unit preference persists and falls back to frames', () => {
  const backing = new Map<string, string>()
  const storage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => { backing.set(key, value) },
  }
  assert.equal(readTimelineUnit(storage), 'frames')
  writeTimelineUnit(storage, 'ticks')
  assert.equal(readTimelineUnit(storage), 'ticks')
  backing.set('topview.builder.timeline.unit', 'bogus')
  assert.equal(readTimelineUnit(storage), 'frames')
  assert.equal(readTimelineUnit(null), 'frames')
})
