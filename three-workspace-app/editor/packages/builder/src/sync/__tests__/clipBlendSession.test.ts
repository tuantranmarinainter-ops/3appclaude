import { describe, expect, it } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, MotionClip } from '../../contract/types'
import { EditorStore } from '../../stores/EditorStore'
import { StudioSession } from '../StudioSession'
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

function fixture(clips: MotionClip[] = [motion('A', 0, 58), motion('B', 59, 149), motion('other', 50, 650, 'other-actor')]) {
  const model = new DirectorDoc()
  const doc = makeEmptyDraft('blend-test', 30, 700)
  doc.content.timeline.animation.motionClips = clips
  model.replace(doc)
  const editor = new EditorStore('blend-test')
  editor.autoKeyframe = false
  const history = new History()
  const session = new StudioSession({} as DirectorEngine, model, editor, history, {} as HostAdapter<DirectorDocument>)
  const byId = (id: string) => doc.content.timeline.animation.motionClips.find((c) => c.id === id)!
  return { model, doc, editor, history, session, byId }
}

describe('drag over neighbour creates blendIn (one undo step)', () => {
  it('B dragged left over A: no push, blendIn set, preview does not touch the document', () => {
    const { session, doc, history, editor, byId, model } = fixture()
    const original = JSON.stringify(doc)
    const revision = model.revision
    expect(editor.clipBlendOverlap).toBe(true) // mặc định bật
    session.beginClipMove()
    session.moveClip('motion', 'B', 52)
    session.moveClip('motion', 'B', 49)
    expect(JSON.stringify(doc)).toBe(original)
    expect(editor.clipMovePreview!.blend).toEqual({ clipId: 'B', frames: 10 })
    expect(editor.clipMovePreview!.positions.A).toEqual({ frameStart: 0, frameEnd: 58 })
    session.endClipMove()
    expect(model.revision).toBe(revision + 1)
    expect(history.undoStack.length).toBe(1)
    expect([byId('B').frameStart, byId('B').frameEnd]).toEqual([49, 139])
    expect([byId('A').frameStart, byId('A').frameEnd]).toEqual([0, 58])
    expect(byId('B').playback.blendIn).toEqual({ frames: 10, curve: 'smooth', footLock: true })
    expect(byId('other').frameStart).toBe(50)
    history.undo()
    expect(JSON.stringify(doc)).toBe(original)
    expect(byId('B').playback.blendIn).toBeUndefined()
    history.redo()
    expect(byId('B').playback.blendIn!.frames).toBe(10)
  })

  it('with the toggle off the old behaviour (shift/reorder) is kept and no blendIn is written', () => {
    const { session, editor, byId } = fixture()
    editor.setClipBlendOverlap(false)
    session.beginClipMove()
    session.moveClip('motion', 'B', 49)
    expect(editor.clipMovePreview!.blend).toBeUndefined()
    session.endClipMove()
    expect(byId('B').playback.blendIn).toBeUndefined()
    const a = byId('A')
    const b = byId('B')
    // không chồng nhau như cũ
    expect(a.frameStart >= b.frameEnd || b.frameStart >= a.frameEnd).toBe(true)
  })

  it('dragging a blended clip away strips the stale blendIn in the same undo step', () => {
    const { session, history, byId } = fixture()
    session.beginClipMove(); session.moveClip('motion', 'B', 49); session.endClipMove()
    expect(byId('B').playback.blendIn).toBeDefined()
    session.beginClipMove(); session.moveClip('motion', 'B', 100); session.endClipMove()
    expect(byId('B').playback.blendIn).toBeUndefined()
    expect(history.undoStack.length).toBe(2)
    history.undo()
    expect(byId('B').playback.blendIn!.frames).toBe(10)
  })
})

describe('context menu and panel actions are single undo steps', () => {
  it('"Trộn với clip trước" -> change frames/curve -> "Bỏ trộn", undo each', () => {
    const { session, doc, history, byId } = fixture()
    const original = JSON.stringify(doc)
    expect(session.blendMotionClipWithPrevious('B')).toBe(true)
    expect([byId('B').frameStart, byId('B').playback.blendIn!.frames]).toEqual([44, 15])
    expect(history.undoStack.length).toBe(1)
    expect(session.setMotionClipBlend('B', { frames: 20, curve: 'linear' })).toBe(true)
    expect(byId('B').frameStart).toBe(39)
    expect(byId('B').playback.blendIn).toEqual({ frames: 20, curve: 'linear', footLock: true })
    expect(history.undoStack.length).toBe(2)
    expect(session.setMotionClipBlend('B', { frames: 1 })).toBe(false)
    expect(history.undoStack.length).toBe(2)
    expect(session.removeMotionClipBlend('B')).toBe(true)
    expect(byId('B').playback.blendIn).toBeUndefined()
    expect(byId('B').frameStart).toBe(58)
    expect(history.undoStack.length).toBe(3)
    history.undo()
    expect(byId('B').playback.blendIn!.frames).toBe(20)
    history.undo()
    expect(byId('B').playback.blendIn!.frames).toBe(15)
    history.undo()
    expect(JSON.stringify(doc)).toBe(original)
  })

  it('Dao chan and Khop nhip buoc are one undo step each; they restore exactly', () => {
    const { session, doc, history, byId } = fixture()
    expect(session.blendMotionClipWithPrevious('B')).toBe(true)
    const before = JSON.stringify(doc)
    const depth = history.undoStack.length
    expect(session.setMotionClipBlend('B', { mirror: true })).toBe(true)
    expect(byId('B').playback.blendIn!.mirror).toBe(true)
    expect(history.undoStack.length).toBe(depth + 1)
    expect(session.setMotionClipBlend('B', { mirror: true })).toBe(false)
    expect(history.undoStack.length).toBe(depth + 1)
    expect(session.setMotionClipBlend('B', { phaseOffsetSeconds: 0.34 })).toBe(true)
    expect(byId('B').playback.blendIn).toMatchObject({ mirror: true, phaseOffsetSeconds: 0.34 })
    expect(history.undoStack.length).toBe(depth + 2)
    expect(session.setMotionClipBlend('B', { phaseOffsetSeconds: null })).toBe(true)
    expect(byId('B').playback.blendIn!.phaseOffsetSeconds).toBeUndefined()
    history.undo(); history.undo()
    expect(byId('B').playback.blendIn!.mirror).toBe(true)
    history.undo()
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('unavailable without a touching predecessor', () => {
    const { session, history } = fixture([motion('A', 0, 58), motion('B', 80, 149)])
    expect(session.blendMotionClipWithPrevious('B')).toBe(false)
    expect(history.undoStack.length).toBe(0)
  })
})
