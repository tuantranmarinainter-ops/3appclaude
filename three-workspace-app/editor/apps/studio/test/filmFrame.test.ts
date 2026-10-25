import assert from 'node:assert/strict'
import test from 'node:test'
import { alignFilmRangeToTickGrid, DEFAULT_FILM_FRAME_ASPECT, filmGridFrameStep, fitFilmFrameDimensions, readFilmFrameAspect, resolveFilmFrameAspect, writeFilmFrameAspect } from '../src/filmFrame'

test('film frame extension helpers default old projects to 16:9 and read named aspects', () => {
    assert.equal(readFilmFrameAspect(undefined), DEFAULT_FILM_FRAME_ASPECT)
    assert.equal(readFilmFrameAspect({ filmFrame: { aspect: '16:9' } }), 16 / 9)
    assert.equal(readFilmFrameAspect({ filmFrame: { aspect: '9:16' } }), 9 / 16)
    assert.equal(readFilmFrameAspect({ filmFrame: { aspect: '1:1' } }), 1)
})

test('film frame extension helpers read custom positive aspects and fall back for invalid saved values', () => {
    assert.equal(readFilmFrameAspect({ filmFrame: { aspect: 2.4 } }), 2.4)
    for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'wide', null]) {
      assert.equal(readFilmFrameAspect({ filmFrame: { aspect } }), DEFAULT_FILM_FRAME_ASPECT)
    }
})

test('film frame extension writes immutably without discarding other project extensions', () => {
    const original = { topview: { fcurves: [] } }
    const next = writeFilmFrameAspect(original, '9:16')
    assert.deepEqual(next, { topview: original.topview, filmFrame: { aspect: '9:16' } })
    assert.equal('filmFrame' in original, false)
    assert.throws(() => writeFilmFrameAspect(original, 0), /positive finite/)
})

test('render bounds fit exact named aspects and report custom numeric rounding', () => {
  assert.deepEqual(fitFilmFrameDimensions(1000, 1000, 16 / 9), { width: 992, height: 558, aspect: 16 / 9, aspectError: 0 })
  assert.deepEqual(fitFilmFrameDimensions(1000, 1000, 1), { width: 1000, height: 1000, aspect: 1, aspectError: 0 })
  const custom = fitFilmFrameDimensions(1000, 1000, 2.4)
  assert.deepEqual({ width: custom.width, height: custom.height }, { width: 1000, height: 417 })
  assert.ok(custom.aspectError > 0)
  assert.equal(resolveFilmFrameAspect({ filmFrame: { aspect: '9:16' } }, undefined), 9 / 16)
  assert.equal(resolveFilmFrameAspect({ filmFrame: { aspect: '1:1' } }, 9 / 16), 9 / 16)
  assert.throws(() => fitFilmFrameDimensions(64, 64, 9 / 16), /minimum 64 pixel/)
})

test('film tick grid step is the frame quantum that keeps ranges on the 20 Hz grid', () => {
  assert.equal(filmGridFrameStep(30), 3)
  assert.equal(filmGridFrameStep(60), 3)
  assert.equal(filmGridFrameStep(24), 6)
  assert.equal(filmGridFrameStep(25), 5)
  assert.equal(filmGridFrameStep(20), 1)
  assert.equal(filmGridFrameStep(0), 1)
})

test('alignFilmRangeToTickGrid extends an off-grid end (0-27 at 30 fps becomes 0-29)', () => {
  const aligned = alignFilmRangeToTickGrid({ startFrame: 0, endFrame: 27 }, 30, { frameStart: 0, frameEnd: 300 })
  assert.deepEqual(aligned, { range: { startFrame: 0, endFrame: 29 }, changed: true, ticks: 20 })
})

test('alignFilmRangeToTickGrid leaves an on-grid range untouched', () => {
  const aligned = alignFilmRangeToTickGrid({ startFrame: 0, endFrame: 29 }, 30, { frameStart: 0, frameEnd: 300 })
  assert.deepEqual(aligned, { range: { startFrame: 0, endFrame: 29 }, changed: false, ticks: 20 })
})

test('alignFilmRangeToTickGrid shortens when extending would leave the timeline', () => {
  const aligned = alignFilmRangeToTickGrid({ startFrame: 270, endFrame: 298 }, 30, { frameStart: 0, frameEnd: 298 })
  assert.deepEqual(aligned, { range: { startFrame: 270, endFrame: 296 }, changed: true, ticks: 18 })
})

test('alignFilmRangeToTickGrid keeps the range when no grid fit exists inside the timeline', () => {
  const aligned = alignFilmRangeToTickGrid({ startFrame: 0, endFrame: 1 }, 30, { frameStart: 0, frameEnd: 1 })
  assert.deepEqual(aligned, { range: { startFrame: 0, endFrame: 1 }, changed: false })
})
