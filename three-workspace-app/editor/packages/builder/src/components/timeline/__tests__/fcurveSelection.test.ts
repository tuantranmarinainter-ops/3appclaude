import { test } from 'vitest'
import assert from 'node:assert/strict'
import { FCurveSet } from '../../../evaluate/curves/FCurveSet'
import { makeKeyframe } from '../../../evaluate/curves/KeyframeTrack'
import { fcurveRefsOf, keyframeRefsOf } from '../../../stores/types'
import { makeEmptyDraft } from '../../../contract/emptyDraft'
import { fcurveFrames, transformKeyframeFrames } from '../utils/trackRow'
import { contextTimelineKeySelection, fcurveRefsAtFrame, fcurveToken, nextTimelineKeySelection, selectedTimelineDragItems } from '../utils/fcurveSelection'
import { clampKeyframeGroupDelta, collectSnapTargets, snapFrame } from '../utils'

test('gộp các thành phần gần cùng khung và loại khóa đang kéo khỏi snap', () => {
  const fc = FCurveSet.empty()
  fc.upsertKey('actor', 'transform.position', 0, 10, 0)
  fc.upsertKey('actor', 'transform.position', 1, 10.0000005, 1)
  fc.upsertKey('actor', 'transform.position', 2, 10.5, 2)
  assert.deepEqual(fcurveFrames(fc, 'actor', 'position'), [10, 10.5])
  const user = makeKeyframe(10, [1, 2, 3])
  const keys = { actor: { position: [user] } }
  assert.deepEqual(transformKeyframeFrames(keys, fc, 'actor', ['position']), [10, 10.5])
  const refs = fcurveRefsAtFrame(fc, 'actor', ['position'], 10.0000005)
  assert.deepEqual(refs, [{ nodeId: 'actor', propPath: 'transform.position', frame: 10 }])
  const doc = makeEmptyDraft('snap', 30, 120)
  doc.content.nodes.push({ id: 'actor' } as typeof doc.content.nodes[number])
  const targets = collectSnapTargets(doc, keys, fc)
  assert.equal(targets.filter((target) => target.keyId === fcurveToken(refs[0])).length, 1)
  assert.equal(snapFrame(10.1, targets, 0.2, { excludeKeyIds: new Set([fcurveToken(refs[0]), user.id]) }), 10.1)
})

test('chọn nhóm hai lớp, Shift thêm/bỏ và kẹp frame lẻ', () => {
  const fc = FCurveSet.empty()
  fc.upsertKey('actor', 'transform.position', 0, 10.25, 1)
  const key = makeKeyframe(20, [1, 2, 3])
  const user = { actor: { rotation: [key] } }
  const ref = fcurveRefsAtFrame(fc, 'actor', ['position'], 10.25)[0]
  const first = nextTimelineKeySelection(null, [], [ref], false, user, fc)
  const mixed = nextTimelineKeySelection(first, [{ nodeId: 'actor', prop: 'rotation', keyId: key.id }], [], true, user, fc)
  assert.equal(fcurveRefsOf(mixed).length, 1)
  assert.equal(keyframeRefsOf(mixed).length, 1)
  const items = selectedTimelineDragItems(mixed, user, fc)
  assert.equal(items.length, 2)
  assert.equal(clampKeyframeGroupDelta(-100, items, { frameStart: 0, frameEnd: 120 }), -10)
  const removed = nextTimelineKeySelection(mixed, [], [ref], true, user, fc)
  assert.equal(fcurveRefsOf(removed).length, 0)
  assert.equal(keyframeRefsOf(removed).length, 1)
})

test('xem trước kẹp theo mọi thành phần thật ở cả hai biên', () => {
  const fc = FCurveSet.empty()
  fc.upsertKey('actor', 'transform.position', 0, 10, 0)
  fc.upsertKey('actor', 'transform.position', 1, 10.0000005, 1)
  const ref = fcurveRefsAtFrame(fc, 'actor', ['position'], 10)[0]
  const selection = nextTimelineKeySelection(null, [], [ref], false, {}, fc)
  const items = selectedTimelineDragItems(selection, {}, fc)
  assert.equal(clampKeyframeGroupDelta(10, items, { frameStart: 0, frameEnd: 20 }), 9)
  assert.equal(clampKeyframeGroupDelta(-10, items, { frameStart: 0.000001, frameEnd: 20 }), -9)
})

test('context menu preserves a ghost selection and adds the overlapping curve bundle', () => {
  const fc = FCurveSet.empty()
  fc.upsertKey('actor', 'transform.position', 0, 10, 1)
  const a = makeKeyframe(10, [1, 2, 3]), b = makeKeyframe(20, [4, 5, 6])
  const keys = { actor: { position: [a, b] } }
  const refs = [a, b].map((key) => ({ nodeId: 'actor', prop: 'position' as const, keyId: key.id }))
  const selected = nextTimelineKeySelection(null, refs, [], false, keys, fc)
  const curve = fcurveRefsAtFrame(fc, 'actor', ['position'], 10)
  const result = contextTimelineKeySelection(selected, [refs[0]], curve, true, keys, fc)
  assert.deepEqual(keyframeRefsOf(result), refs)
  assert.deepEqual(fcurveRefsOf(result), curve)
  const aggregateNotHighlighted = contextTimelineKeySelection(selected, [refs[0]], curve, false, keys, fc)
  assert.deepEqual(keyframeRefsOf(aggregateNotHighlighted), [refs[0]])
  assert.deepEqual(fcurveRefsOf(aggregateNotHighlighted), curve)
})
