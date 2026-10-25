import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, MotionClip, CameraMotionClip, PathMotionClip } from '../../contract/types'
import { EditorStore } from '../../stores/EditorStore'
import { StudioSession } from '../../sync/StudioSession'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'

const motion = (id: string, start: number, end: number, target = 'actor'): MotionClip => ({
  id, frameStart: start, frameEnd: end, target: { type: 'character', nodeId: target },
  source: 'test', sourceDuration: (end - start) / 30,
  playback: { version: 1, speed: 1, loop: true, loopMode: 'repeat' },
  motion: { assetId: id, name: id, source: 'test', sourceRig: 'mixamorig', url: '', inPlace: true, loop: true, speed: 1, time: 0 },
})
function fixture(kind: 'motion' | 'camera' | 'path') {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('drag-test', 30, 700)
  const source = [motion('失败者', 0, 97), motion('死亡', 97, 229), motion('鲤鱼打挺', 437, 498), motion('舞蹈', 498, 613), motion('other', 50, 650, 'other-actor')]
  if (kind === 'motion') doc.content.timeline.animation.motionClips = source
  if (kind === 'camera') doc.content.timeline.animation.cameraMotionClips = source.map((c): CameraMotionClip => ({
    id: c.id, target: c.target, frameStart: c.frameStart, frameEnd: c.frameEnd,
    trimStartMs: 0, trimEndMs: 0, playback: { ...c.playback, baseDurationFrames: c.frameEnd - c.frameStart },
    motion: { id: c.id, version: 1, presetId: 'test', label: c.id, timeUnit: 'ms', durationMs: 1000, curves: [] },
  }))
  if (kind === 'path') doc.content.timeline.animation.pathMotionClips = source.map((c): PathMotionClip => ({
    id: c.id, target: c.target, frameStart: c.frameStart, frameEnd: c.frameEnd,
    status: 'active', locked: true, source: 'test', pathNodeId: 'path', pathName: 'path', pathLength: 1,
    pathStartPercent: 0, pathEndPercent: 100, direction: 'forward', facing: 'path-tangent',
    playback: { ...c.playback, baseDurationFrames: c.frameEnd - c.frameStart },
  }))
  model.replace(doc)
  const editor = new EditorStore('drag-test')
  editor.autoKeyframe = false
  const history = new History()
  const session = new StudioSession({} as DirectorEngine, model, editor, history, {} as HostAdapter<DirectorDocument>)
  return { model, doc, editor, history, session }
}

for (const kind of ['motion', 'camera', 'path'] as const) {
  test(`${kind}: 移动范围外片段不会重新撑大用户设置的结束帧`, () => {
    const { session, doc, history } = fixture(kind)
    doc.content.timeline.frameEnd = 20
    session.beginClipMove()
    session.moveClip(kind, '鲤鱼打挺', 500)
    session.endClipMove()
    assert.equal(doc.content.timeline.frameEnd, 20)
    history.undo()
    assert.equal(doc.content.timeline.frameEnd, 20)
    history.redo()
    assert.equal(doc.content.timeline.frameEnd, 20)
  })
  test(`${kind}: 预览不改文档/revision/历史，松手提交一次，undo/redo恢复精确位置`, () => {
    const { session, doc, model, history, editor } = fixture(kind)
    const original = JSON.stringify(doc)
    const revision = model.revision
    session.beginClipMove()
    for (const frame of [400, 250, 164, 163, 150, 125, 162]) session.moveClip(kind, '鲤鱼打挺', frame)
    assert.equal(JSON.stringify(doc), original)
    assert.equal(model.revision, revision)
    assert.equal(history.canUndo, false)
    assert.deepEqual(editor.clipMovePreview!.positions['死亡'], { frameStart: 158, frameEnd: 290 })
    assert.equal(editor.clipMovePreview!.positions.other, undefined)
    session.endClipMove()
    assert.equal(editor.clipMovePreview, null)
    assert.equal(model.revision, revision + 1)
    assert.equal(history.undoStack.length, 1)
    const committed = JSON.stringify(doc)
    assert.ok(committed !== original)
    history.undo()
    assert.equal(JSON.stringify(doc), original)
    history.redo()
    assert.equal(JSON.stringify(doc), committed)
  })
  test(`${kind}: 取消或中途文档被编辑时丢弃预览`, () => {
    const { session, doc, model, history, editor } = fixture(kind)
    const original = JSON.stringify(doc)
    session.beginClipMove()
    session.moveClip(kind, '鲤鱼打挺', 163)
    session.cancelClipMove()
    assert.equal(JSON.stringify(doc), original)
    assert.equal(history.canUndo, false)
    assert.equal(editor.clipMovePreview, null)
    session.beginClipMove()
    session.moveClip(kind, '鲤鱼打挺', 163)
    doc.content.timeline.frameEnd = 900
    model.touch()
    session.endClipMove()
    assert.equal(doc.content.timeline.frameEnd, 900)
    assert.equal(editor.clipMovePreview, null)
    assert.equal(history.canUndo, false)
  })
}

test('动作和轨迹 Handler 预览不改文档，松手后一次提交', () => {
  for (const kind of ['motion', 'path'] as const) {
    const { session, doc, model, history, editor } = fixture(kind)
    const original = JSON.stringify(doc)
    const revision = model.revision
    session.beginClipResize()
    session.resizeClip(kind, '失败者', 'end', 80)
    assert.equal(JSON.stringify(doc), original)
    assert.equal(model.revision, revision)
    assert.deepEqual(editor.clipResizePreview, {
      clipType: kind, clipId: '失败者', frameStart: 0, frameEnd: 80,
    })
    session.endClipResize()
    assert.equal(model.revision, revision + 1)
    assert.equal(history.undoStack.length, 1)
    assert.equal(editor.clipResizePreview, null)
    const committed = kind === 'motion'
      ? doc.content.timeline.animation.motionClips.find((c) => c.id === '失败者')
      : doc.content.timeline.animation.pathMotionClips.find((c) => c.id === '失败者')
    assert.equal(committed?.frameEnd, 80)
  }
})

test('路径走位：检查器改帧范围立即提交，并按覆盖率更新时长', () => {
  const { session, doc, history } = fixture('path')
  assert.equal(session.resizePathMotionClip('失败者', 'end', 80), null)
  const resized = doc.content.timeline.animation.pathMotionClips.find((c) => c.id === '失败者')
  assert.equal(resized?.frameStart, 0)
  assert.equal(resized?.frameEnd, 80)
  assert.equal(resized?.playback.baseDurationFrames, 80)
  assert.equal(history.undoStack.length, 1)
  history.undo()
  const restored = doc.content.timeline.animation.pathMotionClips.find((c) => c.id === '失败者')
  assert.equal(restored?.frameEnd, 97)
  assert.equal(restored?.playback.baseDurationFrames, 97)
})

function derivedPathClip(id: string, start: number, end: number, target = 'actor'): PathMotionClip {
  return {
    id,
    target: { type: 'node', nodeId: target },
    frameStart: start,
    frameEnd: end,
    status: 'active',
    locked: true,
    lockedReason: 'derived-from-keyframes',
    source: 'transform-keyframes',
    pathNodeId: `path_${id}`,
    pathName: 'Transform keyframes',
    pathLength: 1,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'path-tangent',
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none', baseDurationFrames: end - start },
  }
}

test('路径走位：关键帧派生的隐藏 clip 不挡住可见轨迹拖动', () => {
  const { session, editor, doc } = fixture('path')
  doc.content.timeline.animation.pathMotionClips.push(derivedPathClip('derived', 0, 700))
  session.beginClipMove()
  session.moveClip('path', '鲤鱼打挺', 300)
  assert.deepEqual(editor.clipMovePreview!.positions['鲤鱼打挺'], { frameStart: 300, frameEnd: 361 })
  assert.equal(editor.clipMovePreview!.positions.derived, undefined)
  session.endClipMove()
  assert.equal(doc.content.timeline.animation.pathMotionClips.find((c) => c.id === '鲤鱼打挺')?.frameStart, 300)
  assert.equal(doc.content.timeline.animation.pathMotionClips.find((c) => c.id === 'derived')?.frameStart, 0)
})

test('路径走位：关键帧派生 clip 不限制可见轨迹 Handler / 检查器改范围', () => {
  const { session, editor, doc } = fixture('path')
  const walk = doc.content.timeline.animation.pathMotionClips.find((c) => c.id === '失败者')!
  doc.content.timeline.animation.pathMotionClips = [walk, derivedPathClip('derived', 0, 700)]
  session.beginClipResize()
  session.resizeClip('path', '失败者', 'end', 200)
  assert.deepEqual(editor.clipResizePreview, { clipType: 'path', clipId: '失败者', frameStart: 0, frameEnd: 200 })
  session.endClipResize()
  assert.equal(doc.content.timeline.animation.pathMotionClips.find((c) => c.id === '失败者')?.frameEnd, 200)
  assert.equal(session.resizePathMotionClip('失败者', 'end', 320), null)
  assert.equal(doc.content.timeline.animation.pathMotionClips.find((c) => c.id === '失败者')?.frameEnd, 320)
})

test('运镜拉长停在时间线终点，不撑大 frameEnd', () => {
  const { session, doc, editor } = fixture('camera')
  const endBefore = doc.content.timeline.frameEnd
  session.beginClipResize()
  session.resizeClip('camera', '失败者', 'end', 900)
  assert.equal(editor.clipResizePreview?.frameEnd, 184)
  session.endClipResize()
  assert.equal(doc.content.timeline.frameEnd, endBefore)
  assert.ok(doc.content.timeline.animation.cameraMotionClips.every((c) => c.frameEnd <= endBefore))
  assert.equal(session.resizeCameraMotionClip('舞蹈', 'end', 900), null)
  assert.equal(doc.content.timeline.frameEnd, endBefore)
  assert.equal(doc.content.timeline.animation.cameraMotionClips.find((c) => c.id === '舞蹈')?.frameEnd, endBefore)
})

test('动作和轨迹拉长停在时间线终点，不撑大 frameEnd', () => {
  for (const kind of ['motion', 'path'] as const) {
    const { session, doc, editor } = fixture(kind)
    const endBefore = doc.content.timeline.frameEnd
    session.beginClipResize()
    session.resizeClip(kind, '舞蹈', 'end', 900)
    assert.equal(editor.clipResizePreview?.frameEnd, endBefore)
    session.endClipResize()
    assert.equal(doc.content.timeline.frameEnd, endBefore)
    const clips = kind === 'motion'
      ? doc.content.timeline.animation.motionClips
      : doc.content.timeline.animation.pathMotionClips
    assert.equal(clips.find((c) => c.id === '舞蹈')?.frameEnd, endBefore)
  }
})

test('路径走位：检查器改帧范围不与同目标后一段重叠，无后段时停在时间线终点', () => {
  const { session, doc } = fixture('path')
  const endBefore = doc.content.timeline.frameEnd
  assert.equal(session.resizePathMotionClip('失败者', 'end', 200), null)
  assert.equal(doc.content.timeline.animation.pathMotionClips.find((c) => c.id === '失败者')?.frameEnd, 97)
  assert.equal(session.resizePathMotionClip('舞蹈', 'end', 800), null)
  const last = doc.content.timeline.animation.pathMotionClips.find((c) => c.id === '舞蹈')
  assert.equal(last?.frameEnd, endBefore)
  assert.equal(last?.playback.baseDurationFrames, endBefore - 498)
  assert.equal(doc.content.timeline.frameEnd, endBefore)
})

for (const edge of ['start', 'end'] as const) {
  test(`A1: ${edge} stretch commits speed, preserves source and supports undo/reload`, () => {
    const { session, doc, history } = fixture('motion')
    const clip = motion('stretch', 100, 120)
    clip.sourceDuration = 2
    clip.motion.time = 0.5
    clip.motion.sourceLengthSeconds = 1
    clip.playback.loop = false
    doc.content.timeline.animation.motionClips = [clip]
    const original = JSON.stringify(doc)
    session.beginClipResize()
    session.resizeClip('motion', clip.id, edge, edge === 'start' ? 61 : 159)
    session.endClipResize()
    const saved = JSON.stringify(doc)
    const result = JSON.parse(saved).content.timeline.animation.motionClips[0]
    assert.equal(result.playback.speed, 0.5)
    assert.equal(result.motion.speed, 0.5)
    assert.equal(result.motion.time, 0.5)
    assert.equal(result.motion.sourceLengthSeconds, 1)
    history.undo()
    assert.equal(JSON.stringify(doc), original)
    history.redo()
    assert.equal(JSON.stringify(doc), saved)
    const loaded = new DirectorDoc()
    loaded.replace(JSON.parse(saved))
    assert.equal(loaded.toContract()!.content.timeline.animation.motionClips[0].playback.speed, 0.5)
  })
}

test('A1: numeric speed/reset keep full source, respect neighbours and reject invalid rates', () => {
  const { session, doc } = fixture('motion')
  const clip = motion('stretch', 100, 120)
  clip.sourceDuration = 2
  doc.content.timeline.animation.motionClips = [clip, motion('next', 250, 300)]
  session.updateMotionClipConfig(clip.id, { speed: 0.5 })
  assert.equal(doc.content.timeline.animation.motionClips[0].frameEnd, 219)
  assert.equal(doc.content.timeline.animation.motionClips[0].playback.speed, 0.5)
  session.updateMotionClipConfig(clip.id, { speed: 1 })
  assert.equal(doc.content.timeline.animation.motionClips[0].frameEnd, 159)
  session.updateMotionClipConfig(clip.id, { speed: 0.1 })
  assert.equal(doc.content.timeline.animation.motionClips[0].frameEnd, 249)
  assert.equal(doc.content.timeline.animation.motionClips[0].playback.speed, 0.4)
  const saved = JSON.stringify(doc)
  for (const speed of [NaN, Infinity, 0, -1, 16.01, 20]) session.updateMotionClipConfig(clip.id, { speed })
  assert.equal(JSON.stringify(doc), saved)
})

test('A1: motion resize/numeric use inclusive neighbour boundaries and one-frame clips', () => {
  const { session, doc } = fixture('motion')
  const clip = motion('stretch', 20, 39)
  clip.sourceDuration = 20 / 30
  doc.content.timeline.animation.motionClips = [motion('previous', 0, 9), clip, motion('next', 60, 79)]
  session.beginClipResize()
  session.resizeClip('motion', clip.id, 'end', 100)
  session.endClipResize()
  assert.equal(doc.content.timeline.animation.motionClips[1].frameEnd, 59)
  assert.equal(doc.content.timeline.animation.motionClips[1].playback.speed, 0.5)
  session.beginClipResize()
  session.resizeClip('motion', clip.id, 'start', 0)
  session.endClipResize()
  assert.equal(doc.content.timeline.animation.motionClips[1].frameStart, 10)
  session.updateMotionClipConfig(clip.id, { frameStart: 0, frameEnd: 100, speed: 1 })
  assert.equal(doc.content.timeline.animation.motionClips[1].frameStart, 10)
  assert.equal(doc.content.timeline.animation.motionClips[1].frameEnd, 59)
  doc.content.timeline.animation.motionClips[1].sourceDuration = 16 / 30
  session.updateMotionClipConfig(clip.id, { speed: 16 })
  assert.equal(doc.content.timeline.animation.motionClips[1].frameEnd, 10)
  assert.equal(doc.content.timeline.animation.motionClips[1].playback.speed, 16)
  assert.equal(doc.content.timeline.animation.motionClips[1].motion.speed, 16)
})

test('A1: oversized drag rate is ignored without changing source/history', () => {
  const { session, doc, history } = fixture('motion')
  const clip = motion('stretch', 0, 59)
  clip.sourceDuration = 2
  doc.content.timeline.animation.motionClips = [clip]
  const before = JSON.stringify(doc)
  session.beginClipResize()
  session.resizeClip('motion', clip.id, 'end', 0)
  session.endClipResize()
  assert.equal(JSON.stringify(doc), before)
  assert.equal(history.canUndo, false)
})
