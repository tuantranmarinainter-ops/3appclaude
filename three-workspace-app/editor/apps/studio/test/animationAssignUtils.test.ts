import assert from 'node:assert/strict'
import test from 'node:test'
import { actionFrames, describeAssignError, findFreeStart, frameAfterLastClip, isRangeOccupied, type FrameSpan } from '../app/workbench/components/animation-assign/utils'

const clip = (nodeId: string, frameStart: number, frameEnd: number): FrameSpan => ({ frameStart, frameEnd, target: { nodeId } })

test('isRangeOccupied uses the inclusive overlap rule and ignores other nodes', () => {
  const clips = [clip('a', 10, 39), clip('b', 0, 100)]
  assert.equal(isRangeOccupied(clips, 'a', 40, 10), false)
  assert.equal(isRangeOccupied(clips, 'a', 39, 10), true)
  assert.equal(isRangeOccupied(clips, 'a', 0, 10), false)
  assert.equal(isRangeOccupied(clips, 'a', 0, 11), true)
  assert.equal(isRangeOccupied(clips, 'a', 50, 5), false)
})

test('findFreeStart picks the nearest gap, honours the range and returns null when nothing fits', () => {
  const clips = [clip('a', 0, 29), clip('a', 60, 89), clip('a', 200, 229), clip('b', 0, 500)]
  assert.equal(findFreeStart(clips, 'a', 100, 20), 100, 'free start is kept')
  assert.equal(findFreeStart(clips, 'a', 10, 30), 30, 'gap 30..59 fits exactly 30 frames')
  assert.equal(findFreeStart(clips, 'a', 70, 31), 90, 'gap too short: next fit is after the clip')
  assert.equal(findFreeStart(clips, 'a', 70, 31, { start: 0, end: 150 }), 90)
  assert.equal(findFreeStart(clips, 'a', 70, 31, { start: 0, end: 100 }), null, 'does not fit inside the range')
  assert.equal(findFreeStart(clips, 'a', 190, 20), 180, 'fits just before a later clip')
  assert.equal(findFreeStart([], 'a', 5, 10), 5)
  assert.equal(findFreeStart(clips, 'c', 7, 10), 7, 'node without clips')
})

test('frameAfterLastClip, actionFrames and describeAssignError', () => {
  assert.equal(frameAfterLastClip([clip('a', 0, 29), clip('a', 60, 89), clip('b', 0, 500)], 'a'), 90)
  assert.equal(frameAfterLastClip([], 'a'), 0)
  assert.equal(actionFrames(1, 30), 30)
  assert.equal(actionFrames(0, 30), 1)
  assert.equal(describeAssignError(400, { error: 'Khung bắt đầu đã có clip khác' }, 'Gán thất bại'), 'Khung bắt đầu đã có clip khác')
  assert.match(describeAssignError(422, { error: 'Action rig x does not match', code: 'PROFILE_MISMATCH' }, 'Gán thất bại'), /không khớp bộ xương/)
  assert.equal(describeAssignError(500, null, 'Gán thất bại'), 'Gán thất bại (mã 500)')
})
