import { describe, expect, it } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, MotionClip } from '../../contract/types'
import { EditorStore } from '../../stores/EditorStore'
import { makeTimelineBoxSelection } from '../../stores/types'
import { StudioSession } from '../StudioSession'
import { DirectorDoc } from '../../document/DirectorDoc'
import { History } from '../../document/History'
import type { DirectorEngine } from '../../engine/DirectorEngine'
import type { HostAdapter } from '../../host/types'

const motion = (id: string, start: number, end: number): MotionClip => ({
  id, frameStart: start, frameEnd: end, target: { type: 'character', nodeId: 'actor' },
  source: 'test', sourceDuration: (end - start) / 30,
  playback: { version: 1, speed: 1, loop: false, loopMode: 'none' },
  motion: { assetId: id, name: id, source: 'test', sourceRig: 'mixamorig', url: '', inPlace: true, loop: false, speed: 1, time: 0 },
})

function fixture(clips: MotionClip[]) {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('gap-test', 30, 300)
  doc.content.timeline.animation.motionClips = clips
  model.replace(doc)
  const editor = new EditorStore('gap-test')
  editor.autoKeyframe = false
  const history = new History()
  const session = new StudioSession({} as DirectorEngine, model, editor, history, {} as HostAdapter<DirectorDocument>)
  const pos = () => Object.fromEntries(doc.content.timeline.animation.motionClips.map((c) => [c.id, [c.frameStart, c.frameEnd]]))
  const byId = (id: string) => doc.content.timeline.animation.motionClips.find((c) => c.id === id)!
  return { editor, history, session, pos, byId }
}

describe('"Tự dời" mặc định tắt', () => {
  it('EditorStore mới có clipRipple = false', () => {
    expect(new EditorStore('x').clipRipple).toBe(false)
  })
})

describe('kéo clip giữa hai khoảng trống', () => {
  it('tắt "Tự dời": clip giữa chỉ đi trong chỗ trống, clip trước/sau đứng yên', () => {
    const { session, editor, pos } = fixture([motion('A', 0, 30), motion('B', 40, 70), motion('C', 80, 110)])
    editor.clipBlendOverlap = false
    session.beginClipMove()
    session.moveClip('motion', 'B', 75)
    expect(editor.clipMovePreview!.positions).toMatchObject({ A: { frameStart: 0 }, B: { frameStart: 50, frameEnd: 80 }, C: { frameStart: 80 } })
    session.moveClip('motion', 'B', 10)
    expect(editor.clipMovePreview!.positions.B).toEqual({ frameStart: 30, frameEnd: 60 })
    session.moveClip('motion', 'B', 102)
    expect(editor.clipMovePreview!.positions.B).toEqual({ frameStart: 110, frameEnd: 140 })
    session.endClipMove()
    expect(pos()).toEqual({ A: [0, 30], B: [110, 140], C: [80, 110] })
  })

  it('bật "Tự dời": giữ cách cũ (đẩy clip bên cạnh)', () => {
    const { session, editor } = fixture([motion('A', 0, 30), motion('B', 40, 70), motion('C', 80, 110)])
    editor.clipBlendOverlap = false
    editor.clipRipple = true
    session.beginClipMove()
    session.moveClip('motion', 'B', 60)
    expect(editor.clipMovePreview!.positions.C.frameStart).toBe(90)
  })
})

describe('kéo nhóm clip đè lên clip ngoài nhóm để trộn', () => {
  it('B+C sát nhau kéo sang trái đè lên A: B nhận blendIn đúng vùng đè, một bước hoàn tác', () => {
    const { session, editor, history, pos, byId } = fixture([motion('A', 0, 40), motion('B', 40, 70), motion('C', 70, 100)])
    editor.select(makeTimelineBoxSelection([{ clipType: 'motion', clipId: 'B' }, { clipType: 'motion', clipId: 'C' }], []))
    session.beginClipMove()
    session.moveClip('motion', 'B', 34)
    expect(editor.clipMovePreview!.blends).toEqual([{ clipId: 'B', frames: 7 }])
    session.endClipMove()
    expect(pos()).toEqual({ A: [0, 40], B: [34, 64], C: [64, 94] })
    expect(byId('B').playback.blendIn).toMatchObject({ frames: 7, curve: 'smooth' })
    expect(history.undoStack.length).toBe(1)
    history.undo()
    expect(pos()).toEqual({ A: [0, 40], B: [40, 70], C: [70, 100] })
    expect(byId('B').playback.blendIn).toBeUndefined()
  })

  it('A+B đang trộn kéo sang phải đè lên C: C nhận blendIn, vùng trộn A→B giữ nguyên', () => {
    const b = motion('B', 34, 64)
    b.playback = { ...b.playback, blendIn: { frames: 7, curve: 'smooth', footLock: true } }
    const { session, editor, byId, pos } = fixture([motion('A', 0, 40), b, motion('C', 70, 100)])
    editor.select(makeTimelineBoxSelection([{ clipType: 'motion', clipId: 'A' }, { clipType: 'motion', clipId: 'B' }], []))
    session.beginClipMove()
    session.moveClip('motion', 'A', 10)
    session.endClipMove()
    expect(pos()).toEqual({ A: [10, 50], B: [44, 74], C: [70, 100] })
    expect(byId('B').playback.blendIn?.frames).toBe(7)
    expect(byId('C').playback.blendIn?.frames).toBe(5)
  })

  it('đè quá sâu (vượt nửa clip) thì dừng ở mép như cũ', () => {
    const { session, editor } = fixture([motion('A', 0, 40), motion('B', 40, 70), motion('C', 70, 100)])
    editor.select(makeTimelineBoxSelection([{ clipType: 'motion', clipId: 'B' }, { clipType: 'motion', clipId: 'C' }], []))
    session.beginClipMove()
    session.moveClip('motion', 'B', 5)
    expect(editor.clipMovePreview!.positions.B).toEqual({ frameStart: 40, frameEnd: 70 })
    expect(editor.clipMovePreview!.blends).toBeUndefined()
  })

  it('tắt "Cho chồng để trộn": nhóm không được đè (như cũ)', () => {
    const { session, editor } = fixture([motion('A', 0, 40), motion('B', 40, 70), motion('C', 70, 100)])
    editor.clipBlendOverlap = false
    editor.select(makeTimelineBoxSelection([{ clipType: 'motion', clipId: 'B' }, { clipType: 'motion', clipId: 'C' }], []))
    session.beginClipMove()
    session.moveClip('motion', 'B', 34)
    expect(editor.clipMovePreview!.positions.B).toEqual({ frameStart: 40, frameEnd: 70 })
  })
})
