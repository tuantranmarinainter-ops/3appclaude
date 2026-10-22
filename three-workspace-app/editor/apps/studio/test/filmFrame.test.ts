import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_FILM_FRAME_ASPECT, readFilmFrameAspect, writeFilmFrameAspect } from '../src/filmFrame'

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
