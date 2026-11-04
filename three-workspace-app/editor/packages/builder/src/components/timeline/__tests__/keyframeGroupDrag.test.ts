import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../../contract/emptyDraft'
import type { DirectorDocument, DraftNode } from '../../../contract/types'
import { DirectorDoc } from '../../../document/DirectorDoc'
import { History } from '../../../document/History'
import type { DirectorEngine } from '../../../engine/DirectorEngine'
import { makeKeyframe, type UserKeys } from '../../../evaluate/curves/KeyframeTrack'
import type { HostAdapter } from '../../../host/types'
import { EditorStore } from '../../../stores/EditorStore'
import { keyframeRefsOf, makeKeyframeSelection, makeTimelineBoxSelection, type KeyframeRef, type Selection } from '../../../stores/types'
import { StudioSession } from '../../../sync/StudioSession'
import {
  clampKeyframeGroupDelta,
  collectFrameBundles,
  nextBundleSelection,
  nextKeyframeSelection,
  selectedKeyframeDragItems,
} from '../utils'
import { nextRowSelection } from '../utils/trackRow'
import { nodeIdsOf } from '../../../stores/nodeSelection'

const XFORM = ['position', 'rotation', 'scale'] as const

/** Hai nhân vật, mỗi người có khung biến đổi (vị trí + xoay + tỷ lệ) ở 10 và 30. */
function twoActorKeys(): UserKeys {
  const keys: UserKeys = {}
  for (const nodeId of ['a', 'b']) {
    keys[nodeId] = {
      position: [makeKeyframe(10, [1, 0, 0]), makeKeyframe(30, [2, 0, 0])],
      rotation: [makeKeyframe(10, [0, 90, 0]), makeKeyframe(30, [0, 180, 0])],
      scale: [makeKeyframe(10, [1, 1, 1]), makeKeyframe(30, [2, 2, 2])],
    }
  }
  return keys
}

/** Giống rê khung qua cả hai dòng "Biến đổi": mọi bó ở mọi khung. */
function boxAll(keys: UserKeys): KeyframeRef[] {
  return ['a', 'b'].flatMap((nodeId) => collectFrameBundles(nodeId, [...XFORM], keys).flatMap((b) => b.refs))
}

test('rê khung chọn nhiều dòng rồi bấm vào một hình thoi tổng trong nhóm: giữ nguyên nhóm để kéo cả nhóm', () => {
  const keys = twoActorKeys()
  const refs = boxAll(keys)
  assert.equal(refs.length, 12)
  const box = makeKeyframeSelection(refs)!
  const bundle = collectFrameBundles('a', [...XFORM], keys)[0]
  const next = nextBundleSelection(box, 'a', bundle.frame, bundle.refs, false)
  assert.equal(next, box)
  const items = selectedKeyframeDragItems(next, keys)
  assert.equal(items.length, 12)
  assert.deepEqual([...new Set(items.map((i) => i.origFrame))].sort((x, y) => x - y), [10, 30])
})

test('bấm hình thoi tổng ngoài nhóm: chỉ chọn khung biến đổi đó (như trước)', () => {
  const keys = twoActorKeys()
  const onlyA10 = makeKeyframeSelection(collectFrameBundles('a', [...XFORM], keys)[0].refs)!
  const b30 = collectFrameBundles('b', [...XFORM], keys)[1]
  assert.deepEqual(nextBundleSelection(onlyA10, 'b', 30, b30.refs, false), { kind: 'transformKeyframe', nodeId: 'b', frame: 30 })
  // Bấm lại đúng bó đang chọn (không có nhóm lớn hơn) cũng trả về khung biến đổi đơn.
  const a10 = collectFrameBundles('a', [...XFORM], keys)[0]
  assert.deepEqual(nextBundleSelection(onlyA10, 'a', 10, a10.refs, false), { kind: 'transformKeyframe', nodeId: 'a', frame: 10 })
})

test('Shift/Ctrl + bấm hình thoi tổng: thêm cả bó, bấm lần nữa bỏ cả bó; giữ clip trong nhóm rê khung', () => {
  const keys = twoActorKeys()
  const [a10, a30] = collectFrameBundles('a', [...XFORM], keys)
  const start = makeKeyframeSelection(a10.refs)
  const added = nextBundleSelection(start, 'a', 30, a30.refs, true)
  assert.equal(keyframeRefsOf(added).length, 6)
  const removed = nextBundleSelection(added, 'a', 30, a30.refs, true)
  assert.deepEqual(keyframeRefsOf(removed).map((r) => r.keyId), a10.refs.map((r) => r.keyId))

  const withClip = makeTimelineBoxSelection([{ clipType: 'motion', clipId: 'm1' }], a10.refs)!
  const mixed = nextBundleSelection(withClip, 'a', 30, a30.refs, true) as Extract<Selection, { kind: 'timelineBox' }>
  assert.equal(mixed.kind, 'timelineBox')
  assert.equal(mixed.clips.length, 1)
  assert.equal(mixed.keys.length, 6)
})

test('bấm khóa con (vị trí/xoay/tỷ lệ) nằm trong nhóm rê khung: vẫn giữ nhóm', () => {
  const keys = twoActorKeys()
  const box = makeKeyframeSelection(boxAll(keys))!
  const rotB30 = { nodeId: 'b', prop: 'rotation' as const, keyId: keys.b.rotation![1].id }
  assert.equal(nextKeyframeSelection(box, rotB30, false, 30), box)
})

test('độ dời nhóm: bám khung nguyên, không lùi qua khung 0, không vượt frameEnd', () => {
  const items = [{ origFrame: 10 }, { origFrame: 30 }]
  const bounds = { frameStart: 0, frameEnd: 100 }
  assert.equal(clampKeyframeGroupDelta(4.4, items, bounds), 4)
  assert.equal(clampKeyframeGroupDelta(4.6, items, bounds), 5)
  assert.equal(clampKeyframeGroupDelta(-25, items, bounds), -10)
  assert.equal(clampKeyframeGroupDelta(90, items, bounds), 70)
  assert.equal(clampKeyframeGroupDelta(-0.3, items, bounds), 0)
  assert.ok(Object.is(clampKeyframeGroupDelta(-0.3, items, bounds), 0))
})

const charNode = (id: string): DraftNode => ({
  id,
  type: 'character',
  name: id,
  visible: true,
  locked: false,
  transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  character: {
    placeholder: false,
    gender: 'unknown',
    motionId: null,
    appearance: { color: '#7fb2e0' },
    label: { showLabel: true, scale: 1, yOffset: 0 },
    animation: { mode: 'pose', posePresetId: 'tpose', controlValues: {} },
  },
})

function sessionFixture() {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('kf-group', 30, 300)
  doc.content.nodes.push(charNode('a'), charNode('b'))
  model.replace(doc)
  model.setUserKeys(twoActorKeys())
  const editor = new EditorStore('kf-group')
  editor.autoKeyframe = false
  const history = new History()
  const engine = {
    currentFrame: 0,
    syncPathNodes() {},
    syncGizmo() {},
    syncPathSelection() {},
    syncCameraMotionGuide() {},
    setFcurves() {},
    setEvalContext() {},
    invalidate() {},
  } as unknown as DirectorEngine
  const session = new StudioSession(engine, model, editor, history, {} as HostAdapter<DirectorDocument>)
  return { model, history, session }
}

const framesOf = (keys: UserKeys) =>
  ['a', 'b'].flatMap((n) => XFORM.map((p) => `${n}.${p}:${keys[n]![p]!.map((k) => k.frame).join(',')}`))

test('kéo cả nhóm (2 nhân vật × vị trí/xoay/tỷ lệ) dời đúng số khung, Ctrl+Z hoàn tác một bước', () => {
  const { model, history, session } = sessionFixture()
  const before = JSON.stringify(model.userKeys)
  const items = selectedKeyframeDragItems(makeKeyframeSelection(boxAll(model.userKeys)), model.userKeys)
  const depth = history.undoStack.length
  const delta = clampKeyframeGroupDelta(7.4, items, { frameStart: 0, frameEnd: 300 })
  session.moveKeyframes(items.map((i) => ({ nodeId: i.nodeId, prop: i.prop, keyId: i.keyId, newFrame: i.origFrame + delta })))
  assert.deepEqual(framesOf(model.userKeys), framesOf(twoActorKeys()).map((s) => s.replace('10,30', '17,37')))
  assert.equal(history.undoStack.length, depth + 1)
  session.undo()
  assert.equal(JSON.stringify(model.userKeys), before)
})

test('kéo nhóm sang trái quá khung 0: cả nhóm dừng ở 0, giữ khoảng cách', () => {
  const { model, session } = sessionFixture()
  const items = selectedKeyframeDragItems(makeKeyframeSelection(boxAll(model.userKeys)), model.userKeys)
  const delta = clampKeyframeGroupDelta(-50, items, { frameStart: 0, frameEnd: 300 })
  assert.equal(delta, -10)
  session.moveKeyframes(items.map((i) => ({ nodeId: i.nodeId, prop: i.prop, keyId: i.keyId, newFrame: i.origFrame + delta })))
  for (const s of framesOf(model.userKeys)) assert.ok(s.endsWith(':0,20'), s)
})

test('Ctrl/Shift + bấm tên dòng: chọn nhiều dòng tuỳ ý, bấm lại thì bỏ, bấm thường quay về một dòng', () => {
  let sel: Selection = nextRowSelection(null, 'cam', false)
  sel = nextRowSelection(sel, 'den', true)
  sel = nextRowSelection(sel, 'go', true)
  assert.deepEqual(nodeIdsOf(sel), ['cam', 'den', 'go'])
  sel = nextRowSelection(sel, 'den', true)
  assert.deepEqual(nodeIdsOf(sel), ['cam', 'go'])
  assert.deepEqual(nodeIdsOf(nextRowSelection(nextRowSelection(sel, 'cam', true), 'go', true)), ['go'])
  assert.deepEqual(nextRowSelection(sel, 'den', false), { kind: 'node', nodeId: 'den' })
  // Đang chọn keyframe/clip thì Ctrl + bấm dòng bắt đầu nhóm node mới.
  const fromKey = nextRowSelection({ kind: 'transformKeyframe', nodeId: 'a', frame: 10 }, 'den', true)
  assert.deepEqual(nodeIdsOf(fromKey), ['den'])
})
