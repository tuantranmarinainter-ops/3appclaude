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
  doc.content.asset.motionPath = source.map((clip) => ({ id: clip.motion.assetId, path: 'fixture.fbx' }))
  model.replace(doc)
  const editor = new EditorStore('drag-test')
  editor.autoKeyframe = false
  const history = new History()
  const session = new StudioSession(new Proxy({}, { get: () => () => undefined }) as DirectorEngine, model, editor, history, {} as HostAdapter<DirectorDocument>)
  return { model, doc, editor, history, session }
}


test('copy and duplicate preserve playback and motion, allocate only a new clip, undo/redo once', () => {
  const { session, doc, history } = fixture('motion')
  doc.content.nodes.push({ id: 'actor' } as DirectorDocument['content']['nodes'][number])
  const original = doc.content.timeline.animation.motionClips[0]
  original.playback.speed = 0.25
  original.playback.loopMode = 'ping-pong'
  const assets = JSON.stringify(doc.content.asset)
  session.copyTimelineClip('motion', original.id)
  const id = session.pasteTimelineClip(250)!
  const copy = doc.content.timeline.animation.motionClips.find((clip) => clip.id === id)!
  assert.notEqual(id, original.id)
  assert.deepEqual(copy.motion, original.motion)
  assert.deepEqual(copy.playback, original.playback)
  assert.equal(copy.frameStart, 250)
  assert.equal(copy.frameEnd, 347)
  assert.equal(JSON.stringify(doc.content.asset), assets)
  assert.equal(history.undoStack.length, 1)
  history.undo()
  assert.equal(doc.content.timeline.animation.motionClips.length, 5)
  history.redo()
  assert.equal(doc.content.timeline.animation.motionClips.length, 6)
  assert.equal(session.duplicateTimelineClip('motion', 'missing', 400), null)
  assert.equal(doc.content.timeline.animation.motionClips.length, 6)
  assert.ok(session.pasteTimelineClip(400))
})

test('paste rejects locks, nonfinite frames and a replaced document', () => {
  const { session, doc, model } = fixture('motion')
  doc.content.nodes.push({ id: 'actor' } as DirectorDocument['content']['nodes'][number])
  session.copyTimelineClip('motion', doc.content.timeline.animation.motionClips[0].id)
  assert.equal(session.pasteTimelineClip(NaN), null)
  model.replace(makeEmptyDraft('other', 30, 700))
  assert.equal(session.pasteTimelineClip(0), null)
})

test('speed slows the same source span, respects neighbours, clamps numeric limits and undoes', () => {
  const { session, doc, history } = fixture('motion')
  const clips = doc.content.timeline.animation.motionClips
  clips.splice(1)
  clips[0].frameEnd = 30
  session.updateMotionClipConfig(clips[0].id, { speed: 0.25 })
  assert.equal(doc.content.timeline.animation.motionClips[0].frameEnd, 120)
  assert.equal(doc.content.timeline.animation.motionClips[0].playback.speed, 0.25)
  history.undo()
  assert.equal(doc.content.timeline.animation.motionClips[0].frameEnd, 30)
  session.updateMotionClipConfig(clips[0].id, { speed: 100 })
  assert.equal(doc.content.timeline.animation.motionClips[0].playback.speed, 16)
  session.updateMotionClipConfig(clips[0].id, { speed: NaN })
  assert.equal(doc.content.timeline.animation.motionClips[0].playback.speed, 16)
})

test('paste rejects a removed motion catalogue after host applyContent preserving document root', () => {
  const { session, doc, model, history } = fixture('motion')
  doc.content.nodes.push({ id: 'actor' } as DirectorDocument['content']['nodes'][number])
  session.copyTimelineClip('motion', doc.content.timeline.animation.motionClips[0].id)
  const incoming = JSON.parse(JSON.stringify(doc)) as DirectorDocument
  incoming.content.asset.motionPath = []
  incoming.content.timeline.animation.motionClips = []
  model.applyContent(incoming)
  assert.equal(model.toContract(), doc)
  assert.equal(session.pasteTimelineClip(250), null)
  assert.equal(doc.content.timeline.animation.motionClips.length, 0)
  assert.equal(history.canUndo, false)
})
