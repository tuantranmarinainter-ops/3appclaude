import { describe, expect, it } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, MotionClip } from '../../contract/types'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'
import { EditorStore } from '../../stores/EditorStore'
import { rippleDeleteMotionClips, rippleTrimMotionClip } from '../motionRipple'
import { StudioSession } from '../StudioSession'

const FPS = 30
const motion = (id: string, start: number, end: number, target = 'actor', time = 0, len?: number): MotionClip => ({
  id, frameStart: start, frameEnd: end, target: { type: 'character', nodeId: target },
  source: 'test', sourceDuration: 10,
  playback: { version: 1, speed: 1, loop: false, loopMode: 'repeat' },
  motion: { assetId: id, name: id, source: 'test', sourceRig: 'mixamorig', url: '', inPlace: true, loop: false, speed: 1, time, ...(len != null ? { sourceLengthSeconds: len } : {}) },
})
const bounds = { frameStart: 0, frameEnd: 600 }
const pos = (clips: MotionClip[]) => Object.fromEntries(clips.map((c) => [c.id, [c.frameStart, c.frameEnd]]))

describe('rippleTrimMotionClip', () => {
  const clips = [motion('A', 0, 90), motion('C', 90, 150), motion('other', 30, 120, 'actor2')]

  it('mép trái kéo vào 30 khung: clip giữ chỗ bắt đầu, bỏ 1 giây đầu động tác, clip sau dời trái 30, nhân vật khác đứng yên', () => {
    const next = rippleTrimMotionClip(clips, 'A', 'start', 30, FPS, bounds)!
    expect(pos(next)).toEqual({ A: [0, 60], C: [60, 120], other: [30, 120] })
    expect(next.find((c) => c.id === 'A')!.motion.time).toBeCloseTo(1, 6)
  })

  it('mép trái kéo ra (lấy lại phần đầu) không lùi quá giây 0 của động tác', () => {
    const trimmed = [motion('A', 0, 60, 'actor', 1), motion('C', 60, 120)]
    const next = rippleTrimMotionClip(trimmed, 'A', 'start', -100, FPS, bounds)!
    expect(pos(next)).toEqual({ A: [0, 90], C: [90, 150] })
    expect(next[0].motion.time).toBe(0)
  })

  it('mép trái giảm cả sourceLengthSeconds để không đọc lố sang phần sau', () => {
    const next = rippleTrimMotionClip([motion('B', 0, 60, 'actor', 2, 2)], 'B', 'start', 15, FPS, bounds)!
    expect(next[0].motion.time).toBeCloseTo(2.5, 6)
    expect(next[0].motion.sourceLengthSeconds).toBeCloseTo(1.5, 6)
  })

  it('mép phải kéo vào: các clip sau dời trái; kéo ra không đẩy clip cuối quá frameEnd timeline', () => {
    expect(pos(rippleTrimMotionClip(clips, 'A', 'end', 70, FPS, bounds)!)).toMatchObject({ A: [0, 70], C: [70, 130] })
    expect(pos(rippleTrimMotionClip(clips, 'A', 'end', 999, FPS, { frameStart: 0, frameEnd: 160 })!)).toMatchObject({ A: [0, 100], C: [100, 160] })
  })
})

describe('rippleDeleteMotionClips', () => {
  it('xoá phần A sau khi cắt: phần B dời về đúng chỗ bắt đầu của A, clip sau cũng dời', () => {
    const clips = [motion('A', 10, 40), motion('B', 40, 90), motion('C', 90, 120), motion('other', 0, 50, 'actor2')]
    expect(pos(rippleDeleteMotionClips(clips, ['A']))).toEqual({ B: [10, 60], C: [60, 90], other: [0, 50] })
  })
  it('không ăn vào khoảng trống có sẵn sau clip bị xoá', () => {
    const clips = [motion('A', 0, 30), motion('B', 50, 80)]
    expect(pos(rippleDeleteMotionClips(clips, ['A']))).toEqual({ B: [20, 50] })
  })
  it('xoá nhiều clip một lúc', () => {
    const clips = [motion('A', 0, 30), motion('B', 30, 60), motion('C', 60, 90)]
    expect(pos(rippleDeleteMotionClips(clips, ['A', 'B']))).toEqual({ C: [0, 30] })
  })
})

function fixture() {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('ripple-test', FPS, 600)
  doc.content.timeline.animation.motionClips = [motion('AB', 0, 120), motion('C', 120, 180), motion('other', 0, 200, 'actor2')]
  model.replace(doc)
  const editor = new EditorStore('ripple-test')
  editor.autoKeyframe = false
  const history = new History()
  const state = { currentFrame: 45 }
  const engine = {
    get currentFrame() { return state.currentFrame },
    set currentFrame(frame: number) { state.currentFrame = frame },
    syncPathNodes() {}, syncGizmo() {}, syncPathSelection() {}, syncCameraMotionGuide() {}, removeNode() {},
    setFcurves() {}, setEvalContext() {}, applyLiveNodeTransform() {}, seek(frame: number) { state.currentFrame = frame },
    setStagedTransform() {}, clearStagedTransforms() {}, hasStagedTransform() { return false },
    getNodeSnapshot() { return null }, setPoseEditingId() {}, invalidate() {},
  } as unknown as DirectorEngine
  const session = new StudioSession(engine, model, editor, history, {} as HostAdapter<DirectorDocument>)
  const clips = () => model.toContract()!.content.timeline.animation.motionClips
  const seek = (frame: number) => { state.currentFrame = frame }
  return { model, editor, history, session, engine, clips, seek }
}

describe('Ctrl+B + tự dời trong session', () => {
  it('Ctrl+B cắt clip đang chọn tại đầu phát; xoá phần A thì B dời về khung 0, đọc tiếp từ giây 1.5; Ctrl+Z từng bước', () => {
    const { session, editor, history, clips } = fixture()
    editor.select({ kind: 'clip', clipType: 'motion', clipId: 'AB' })
    const cut = session.splitMotionClipAtPlayhead()
    expect(cut.error).toBeNull()
    const second = clips().find((c) => c.id === cut.id)!
    expect([second.frameStart, second.frameEnd]).toEqual([45, 120])
    expect(second.motion.time).toBeCloseTo(1.5, 6)
    const depth = history.undoStack.length
    editor.select({ kind: 'clip', clipType: 'motion', clipId: 'AB' })
    session.deleteSelection()
    expect(history.undoStack.length).toBe(depth + 1)
    expect(pos(clips())).toEqual({ [cut.id!]: [0, 75], C: [75, 135], other: [0, 200] })
    session.undo()
    expect(pos(clips())).toMatchObject({ AB: [0, 45], [cut.id!]: [45, 120], C: [120, 180] })
    session.undo()
    expect(pos(clips())).toEqual({ AB: [0, 120], C: [120, 180], other: [0, 200] })
  })

  it('Ctrl+B khi chọn nhân vật: cắt clip dưới đầu phát của nhân vật đó; không có clip thì báo not-applicable', () => {
    const { session, editor, clips } = fixture()
    editor.select({ kind: 'node', nodeId: 'actor2' })
    const cut = session.splitMotionClipAtPlayhead()
    expect(cut.error).toBeNull()
    expect(clips().filter((c) => c.target.nodeId === 'actor2').map((c) => [c.frameStart, c.frameEnd])).toEqual([[0, 45], [45, 200]])
    // Chọn đối tượng không có clip: rơi về "clip duy nhất dưới đầu phát" (ở khung 45 chỉ còn AB chứa đầu phát).
    editor.select({ kind: 'node', nodeId: 'nobody' })
    expect(session.splitMotionClipAtPlayhead().error).toBeNull()
    expect(clips().filter((c) => c.target.nodeId === 'actor').map((c) => [c.frameStart, c.frameEnd])).toEqual([[0, 45], [45, 120], [120, 180]])
  })

  it('không chọn gì: dưới đầu phát chỉ một clip thì cắt luôn; nhiều nhân vật thì báo ambiguous; ngoài clip thì not-applicable', () => {
    const { session, editor, seek, clips } = fixture()
    editor.select(null)
    expect(session.splitMotionClipAtPlayhead().error).toBe('ambiguous') // khung 45: AB và other
    seek(150) // chỉ C (120–180) và other (0–200)… vẫn hai
    expect(session.splitMotionClipAtPlayhead().error).toBe('ambiguous')
    seek(190) // chỉ other
    const cut = session.splitMotionClipAtPlayhead()
    expect(cut.error).toBeNull()
    expect(clips().filter((c) => c.target.nodeId === 'actor2').map((c) => [c.frameStart, c.frameEnd])).toEqual([[0, 190], [190, 200]])
    seek(250)
    editor.select(null)
    expect(session.splitMotionClipAtPlayhead().error).toBe('not-applicable')
  })

  it('kéo mép trái khi bật tự dời: một bước hoàn tác; tắt tự dời thì giữ cách cũ (clip dời điểm bắt đầu, không kéo clip sau)', () => {
    const { session, editor, history, clips } = fixture()
    const depth = history.undoStack.length
    session.beginClipResize()
    session.resizeClip('motion', 'AB', 'start', 30)
    session.endClipResize()
    expect(pos(clips())).toEqual({ AB: [0, 90], C: [90, 150], other: [0, 200] })
    expect(clips()[0].motion.time).toBeCloseTo(1, 6)
    expect(history.undoStack.length).toBe(depth + 1)
    session.undo()
    expect(pos(clips())).toEqual({ AB: [0, 120], C: [120, 180], other: [0, 200] })

    editor.setClipRipple(false)
    session.beginClipResize()
    session.resizeClip('motion', 'AB', 'start', 30)
    session.endClipResize()
    expect(pos(clips())).toEqual({ AB: [30, 120], C: [120, 180], other: [0, 200] })
  })
})
