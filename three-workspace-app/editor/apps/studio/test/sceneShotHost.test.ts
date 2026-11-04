import assert from 'node:assert/strict'
import test from 'node:test'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { editedCharacterIds, sceneMergeDefaults, widenedStatus } from '../src/sceneShotHost'

const clip = (id: string, nodeId: string, frameStart: number, frameEnd: number, name: string, blend?: number) => ({
  id, frameStart, frameEnd, target: { nodeId }, motion: { name }, playback: blend ? { blendIn: { frames: blend } } : {},
})

test('sceneMergeDefaults uses only the character clips touching the range, sorted', () => {
  const project = { characters: { a: { nodeId: 'na' }, b: { nodeId: 'nb' } }, scene: { content: { timeline: { animation: { motionClips: [
    clip('c2', 'na', 60, 120, 'Chạy', 10), clip('c1', 'na', 0, 60, 'Đi'), clip('far', 'na', 500, 600, 'Xa'), clip('other', 'nb', 0, 100, 'Khác'),
  ] } } } } } as unknown as UnifiedProject
  const info = sceneMergeDefaults(project, 'a', [30, 90])
  assert.equal(info.name, 'Đi + Chạy')
  assert.match(info.description, /Đi \(khung 0–60\) \+ Chạy \(khung 60–120\)/)
  assert.equal(sceneMergeDefaults(project, 'b', [30, 90]).name, 'Khác')
})

test('editedCharacterIds reads unique edits[].characterId', () => {
  assert.deepEqual(editedCharacterIds({ edits: [{ characterId: 'a' }, { characterId: 'b' }, { characterId: 'a' }, {}] }), ['a', 'b'])
  assert.deepEqual(editedCharacterIds({ edits: [] }), [])
  assert.deepEqual(editedCharacterIds({}), [])
  assert.deepEqual(editedCharacterIds(null), [])
})

test('widenedStatus', () => {
  assert.equal(widenedStatus([10, 50], [10, 50]), null)
  assert.equal(widenedStatus([10, 50], [0, 80]), 'Đã nới khoảng 10–50 → 0–80 để phủ trọn clip.')
})
