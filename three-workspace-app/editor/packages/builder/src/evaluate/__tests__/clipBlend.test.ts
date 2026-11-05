import { describe, expect, it } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DirectorDocument, DraftNode, MotionBlendIn, MotionClip } from '../../contract/types'
import { parseDirectorDocument } from '../../contract/validate'
import { motionBlendPartner, motionClipAt, motionClipsAt } from '../clips'
import { createFrameSnapshot, prepareFrameSnapshot } from '../FrameSnapshot'
import { evaluateFrame } from '../evaluateFrame'
import { sceneFromDocument } from '../sceneFromDocument'

const FPS = 30

function clip(id: string, start: number, end: number, blendIn?: MotionBlendIn, nodeId = 'actor'): MotionClip {
  return {
    id, source: 'test', sourceDuration: 10, frameStart: start, frameEnd: end,
    target: { type: 'character', nodeId },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'repeat', ...(blendIn ? { blendIn } : {}) },
    motion: { assetId: id, name: id, source: 'test', sourceRig: 'mixamorig', url: '', inPlace: true, loop: false, speed: 1, time: 0 },
  }
}
const blend = (frames: number, curve: 'smooth' | 'linear' = 'smooth'): MotionBlendIn => ({ frames, curve, footLock: true })

describe('motionClipsAt', () => {
  // A: 0..58, B: 49..139 chồng 10 khung [49, 58].
  const A = clip('A', 0, 58)
  const B = clip('B', 49, 139, blend(10))
  const clips = [A, B]

  it('weights at zone edges: 0 at first frame, below 1 at last zone frame, B alone after', () => {
    const first = motionClipsAt(clips, 'actor', 49)!
    expect([first.from.id, first.to?.id, first.weight]).toEqual(['A', 'B', 0])
    const last = motionClipsAt(clips, 'actor', 58)!
    expect(last.to?.id).toBe('B')
    expect(last.weight).toBeGreaterThan(0.9)
    expect(last.weight).toBeLessThan(1)
    const after = motionClipsAt(clips, 'actor', 59)!
    expect(after.from.id).toBe('B')
    expect(after.to).toBeNull()
    const before = motionClipsAt(clips, 'actor', 48)!
    expect(before.from.id).toBe('A')
    expect(before.to).toBeNull()
  })

  it('smooth is smoothstep and linear is linear; both monotonic', () => {
    const smooth = motionClipsAt(clips, 'actor', 54)!.weight
    expect(smooth).toBeCloseTo(0.5 * 0.5 * (3 - 2 * 0.5), 10) // t = 5/10
    const lin = motionClipsAt([A, clip('B', 49, 139, blend(10, 'linear'))], 'actor', 54)!.weight
    expect(lin).toBeCloseTo(0.5, 10)
    let prev = -1
    for (let f = 49; f <= 58; f++) {
      const w = motionClipsAt(clips, 'actor', f)!.weight
      expect(w).toBeGreaterThanOrEqual(prev)
      prev = w
    }
  })

  it('left sample boundary stays continuous', () => {
    const w = motionClipsAt(clips, 'actor', 58, 'left')!
    expect(w.to?.id).toBe('B')
    expect(w.weight).toBeGreaterThan(0)
  })

  it('without blendIn it is exactly motionClipAt (first match, no second clip)', () => {
    const plain = [clip('A', 0, 58), clip('B', 49, 139)]
    for (let f = -2; f < 145; f++) {
      const hit = motionClipsAt(plain, 'actor', f)
      expect(hit?.from ?? null).toBe(motionClipAt(plain, 'actor', f))
      expect(hit?.to ?? null).toBeNull()
    }
    // sát nhau (A.end == B.start): hai clip cùng phủ một khung, clip đứng trước trong mảng thắng như cũ.
    const touching = [clip('A', 0, 58), clip('B', 58, 139)]
    expect(motionClipsAt(touching, 'actor', 58)!.from.id).toBe('A')
  })

  it('invalid blendIn is ignored: zone outside A, bad frames, unrelated node', () => {
    const tooLong = [A, clip('B', 49, 139, blend(30))] // vùng trộn vượt quá cuối A
    expect(motionClipsAt(tooLong, 'actor', 52)!.to).toBeNull()
    expect(motionBlendPartner(tooLong, tooLong[1])).toBeNull()
    const bad = [A, clip('B', 49, 139, { frames: 0, curve: 'smooth', footLock: true })]
    expect(motionClipsAt(bad, 'actor', 52)!.to).toBeNull()
    const otherNode = [A, clip('B', 49, 139, blend(10), 'someone')]
    expect(motionClipsAt(otherNode, 'actor', 52)!.to).toBeNull()
  })

  it('never blends more than two clips at a frame', () => {
    const three = [clip('A', 0, 58), clip('B', 49, 139, blend(10)), clip('C', 50, 100, blend(5))]
    expect(motionClipsAt(three, 'actor', 52)!.to).toBeNull()
  })
})

function characterDoc(clips: MotionClip[]): DirectorDocument {
  const doc = makeEmptyDraft('blend', FPS, 200)
  const node: DraftNode = {
    id: 'actor', type: 'character', name: 'actor', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    character: { animation: { mode: 'pose', posePresetId: '', controlValues: {} } },
  } as unknown as DraftNode
  doc.content.nodes.push(node)
  doc.content.timeline.animation.motionClips = clips
  return doc
}

function playbackAt(doc: DirectorDocument, frame: number, boundary?: 'left' | 'right') {
  const scene = sceneFromDocument(doc, { fcurves: null, userKeys: {}, userKeysEnabled: false, chainCameraMotion: false })
  if (boundary) scene.exportSampleBoundary = boundary
  const out = createFrameSnapshot()
  prepareFrameSnapshot(out, scene.nodes.map((n) => n.id))
  evaluateFrame(scene, frame, out)
  return out.motionPlayback.map((c) => ({ ...c }))
}

describe('evaluateCharacters', () => {
  it('without blendIn emits one playback with weight 1, same as before', () => {
    const doc = characterDoc([clip('A', 0, 58), clip('B', 59, 149)])
    for (const f of [0, 30, 58, 59, 100, 149]) {
      const cmds = playbackAt(doc, f)
      expect(cmds).toHaveLength(1)
      expect(cmds[0].weight).toBe(1)
      expect(cmds[0].clipId).toBe(motionClipAt(doc.content.timeline.animation.motionClips, 'actor', f)!.id)
    }
    expect(playbackAt(doc, 500)).toHaveLength(0)
  })

  it('emits two playbacks with complementary weights only inside the blend zone', () => {
    const doc = characterDoc([clip('A', 0, 58), clip('B', 49, 139, blend(10))])
    expect(playbackAt(doc, 48).map((c) => c.clipId)).toEqual(['A'])
    const inside = playbackAt(doc, 54)
    expect(inside.map((c) => c.clipId)).toEqual(['A', 'B'])
    expect(inside[0].weight + inside[1].weight).toBeCloseTo(1, 12)
    // B chạy theo thời gian riêng của nó (từ B.frameStart), A theo thời gian của A.
    expect(inside[0].timeSeconds).toBeCloseTo(54 / FPS, 9)
    expect(inside[1].timeSeconds).toBeCloseTo(5 / FPS, 9)
    expect(playbackAt(doc, 59).map((c) => c.clipId)).toEqual(['B'])
    expect(playbackAt(doc, 59)[0].weight).toBe(1)
  })

  it('outside blend zones the snapshot equals the same scene without blendIn', () => {
    const withBlend = characterDoc([clip('A', 0, 58), clip('B', 49, 139, blend(10))])
    const without = characterDoc([clip('A', 0, 58), clip('B', 49, 139)])
    for (const f of [0, 20, 48, 59, 80, 139]) expect(playbackAt(withBlend, f)).toEqual(playbackAt(without, f))
  })
})

describe('validate blendIn', () => {
  const docWith = (blendIn: unknown): unknown => {
    const doc = makeEmptyDraft("v", FPS, 200); doc.content.timeline.animation.motionClips = [clip("A", 0, 58), clip("B", 49, 139)]
    ;(doc.content.timeline.animation.motionClips[1].playback as Record<string, unknown>).blendIn = blendIn
    return JSON.parse(JSON.stringify(doc))
  }
  it('accepts old files without blendIn and valid blendIn', () => {
    expect(() => parseDirectorDocument(JSON.parse(JSON.stringify(makeEmptyDraft("v", FPS, 200))))).not.toThrow()
    expect(() => parseDirectorDocument(docWith({ frames: 10, curve: 'smooth', footLock: true }))).not.toThrow()
    expect(() => parseDirectorDocument(docWith({ frames: 10, curve: 'smooth', footLock: false }))).not.toThrow()
    expect(() => parseDirectorDocument(docWith({ frames: 6, curve: 'linear', footLock: true, mirror: true, phaseOffsetSeconds: -0.2 }))).not.toThrow()
  })
  it('rejects malformed blendIn', () => {
    for (const bad of [
      { frames: 0, curve: 'smooth', footLock: true },
      { frames: 2.5, curve: 'smooth', footLock: true },
      { frames: 10, curve: 'cubic', footLock: true },
      { frames: 10, curve: 'smooth', footLock: 'false' },
      { frames: 10, curve: 'smooth' },
      { frames: 10, curve: 'smooth', footLock: true, extra: 1 },
      'smooth',
    ]) expect(() => parseDirectorDocument(docWith(bad))).toThrow()
  })
})
