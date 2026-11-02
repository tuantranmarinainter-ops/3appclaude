import { describe, expect, it } from 'vitest'
import type { MotionBlendIn, MotionClip } from '../../contract/types'
import {
  applyBlendDrag,
  blendWithPrevious,
  defaultBlendFrames,
  findInvalidMotionOverlaps,
  motionOverlapsValid,
  normalizeBlendIns,
  previewBlendDrag,
  removeBlend,
  setBlendCurve,
  setBlendFrames,
} from '../clipBlend'

function clip(id: string, start: number, end: number, blendIn?: MotionBlendIn, nodeId = 'actor'): MotionClip {
  return {
    id, source: 'test', sourceDuration: 10, frameStart: start, frameEnd: end,
    target: { type: 'character', nodeId },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'repeat', ...(blendIn ? { blendIn } : {}) },
    motion: { assetId: id, name: id, source: 'test', sourceRig: 'mixamorig', url: '', inPlace: true, loop: false, speed: 1, time: 0 },
  }
}
const range = (clips: MotionClip[], id: string) => {
  const c = clips.find((item) => item.id === id)!
  return [c.frameStart, c.frameEnd]
}

describe('previewBlendDrag (kéo B sang trái đè đuôi A)', () => {
  const track = [clip('A', 0, 58), clip('B', 59, 149)]

  it('overlap of 10 frames creates blendIn on B and does not push anything', () => {
    const result = previewBlendDrag(track, 'B', 49, 0)!
    expect(result.blendClipId).toBe('B')
    expect(result.frames).toBe(10)
    expect(result.positions.A).toEqual({ frameStart: 0, frameEnd: 58 })
    expect(result.positions.B).toEqual({ frameStart: 49, frameEnd: 139 })
    const next = applyBlendDrag(track, result)
    expect(range(next, 'B')).toEqual([49, 139])
    expect(next.find((c) => c.id === 'B')!.playback.blendIn).toEqual({ frames: 10, curve: 'smooth', footLock: true })
    expect(next.find((c) => c.id === 'A')!.playback.blendIn).toBeUndefined()
    expect(motionOverlapsValid(next)).toBe(true)
  })

  it('drag A to the right over B gives the same blend on B', () => {
    const result = previewBlendDrag(track, 'A', 10, 0)!
    expect(result.positions.A).toEqual({ frameStart: 10, frameEnd: 68 })
    expect(result.blendClipId).toBe('B')
    expect(result.frames).toBe(10)
    expect(range(applyBlendDrag(track, result), 'B')).toEqual([59, 149])
  })

  it('returns null when only touching, when there is no neighbour, or when overlap is too deep', () => {
    expect(previewBlendDrag(track, 'B', 58, 0)).toBeNull() // chạm nhau: không chồng
    expect(previewBlendDrag(track, 'B', 70, 0)).toBeNull() // có khe
    expect(previewBlendDrag(track, 'B', 10, 0)).toBeNull() // đè quá nửa clip: để cách kéo cũ sắp xếp lại
    expect(previewBlendDrag([clip('A', 0, 58)], 'A', 5, 0)).toBeNull()
  })

  it('ignores clips of another character', () => {
    const mixed = [clip('A', 0, 58), clip('B', 59, 149, undefined, 'other')]
    expect(previewBlendDrag(mixed, 'B', 49, 0)).toBeNull()
  })

  it('keeps curve and mirror when updating an existing blend', () => {
    const existing = [clip('A', 0, 58), clip('B', 49, 139, { frames: 10, curve: 'linear', footLock: true, mirror: true })]
    const result = previewBlendDrag(existing, 'B', 44, 0)!
    const b = applyBlendDrag(existing, result).find((c) => c.id === 'B')!
    expect(b.playback.blendIn).toEqual({ frames: 15, curve: 'linear', footLock: true, mirror: true })
    expect(b.frameStart).toBe(44)
  })

  it('does not mutate the input', () => {
    const before = JSON.stringify(track)
    applyBlendDrag(track, previewBlendDrag(track, 'B', 49, 0)!)
    expect(JSON.stringify(track)).toBe(before)
  })
})

describe('blendWithPrevious (chuột phải "Trộn với clip trước")', () => {
  it('moves B earlier by default 1 s worth of frames (K4) and sets blendIn', () => {
    expect(defaultBlendFrames(30)).toBe(30)
    // A 0-58 is 59 frames: the half-clip cap (29) wins over the 30-frame default.
    const capped = blendWithPrevious([clip('A', 0, 58), clip('B', 59, 149)], 'B', 30)!
    expect(range(capped, 'B')).toEqual([30, 120])
    expect(capped.find((c) => c.id === 'B')!.playback.blendIn).toEqual({ frames: 29, curve: 'smooth', footLock: true })
    expect(motionOverlapsValid(capped)).toBe(true)
    const next = blendWithPrevious([clip('A', 0, 89), clip('B', 90, 179)], 'B', 30)!
    expect(range(next, 'B')).toEqual([60, 149])
    expect(next.find((c) => c.id === 'B')!.playback.blendIn).toEqual({ frames: 30, curve: 'smooth', footLock: true })
    expect(motionOverlapsValid(next)).toBe(true)
  })

  it('works for a clip exactly touching its predecessor and is unavailable otherwise', () => {
    expect(range(blendWithPrevious([clip('A', 0, 58), clip('B', 58, 149)], 'B', 30)!, 'B')).toEqual([30, 121])
    expect(blendWithPrevious([clip('A', 0, 58), clip('B', 70, 149)], 'B', 30)).toBeNull() // có khe
    expect(blendWithPrevious([clip('A', 0, 58)], 'A', 30)).toBeNull() // không có clip trước
    expect(blendWithPrevious([clip('A', 0, 58), clip('B', 59, 149, { frames: 5, curve: 'smooth', footLock: true })], 'B', 30)).toBeNull()
  })

  it('caps the blend at half of the shorter clip', () => {
    const next = blendWithPrevious([clip('A', 0, 9), clip('B', 10, 149)], 'B', 30)!
    expect(next.find((c) => c.id === 'B')!.playback.blendIn!.frames).toBe(5)
  })
})

describe('panel edits', () => {
  const blended = [clip('A', 0, 58), clip('B', 49, 139, { frames: 10, curve: 'smooth', footLock: true })]

  it('changing frames moves B so the zone still ends at A.frameEnd', () => {
    const wider = setBlendFrames(blended, 'B', 20)!
    expect(range(wider, 'B')).toEqual([39, 129])
    expect(wider.find((c) => c.id === 'B')!.playback.blendIn!.frames).toBe(20)
    expect(motionOverlapsValid(wider)).toBe(true)
    const narrower = setBlendFrames(wider, 'B', 4)!
    expect(range(narrower, 'B')).toEqual([55, 145])
    expect(motionOverlapsValid(narrower)).toBe(true)
  })

  it('rejects impossible frame counts', () => {
    expect(setBlendFrames(blended, 'B', 1)).toBeNull()
    expect(setBlendFrames(blended, 'B', 500)).toBeNull()
    expect(setBlendFrames(blended, 'B', Number.NaN)).toBeNull()
    expect(setBlendFrames([clip('A', 0, 58), clip('B', 49, 139)], 'B', 10)).toBeNull() // chưa có blendIn
  })

  it('curve switch only changes the curve', () => {
    const linear = setBlendCurve(blended, 'B', 'linear')!
    expect(linear.find((c) => c.id === 'B')!.playback.blendIn).toEqual({ frames: 10, curve: 'linear', footLock: true })
    expect(range(linear, 'B')).toEqual([49, 139])
    expect(setBlendCurve(blended, 'B', 'smooth')).toBeNull()
  })

  it('"Bỏ trộn" removes blendIn and pushes B (and followers) out of the overlap', () => {
    const three = [...blended, clip('C', 139, 200)]
    const next = removeBlend(three, 'B')!
    expect(next.find((c) => c.id === 'B')!.playback.blendIn).toBeUndefined()
    expect(range(next, 'B')).toEqual([58, 148])
    expect(range(next, 'C')).toEqual([148, 209])
    expect(motionOverlapsValid(next)).toBe(true)
  })
})

describe('invariants', () => {
  it('overlap without blendIn, three-way overlap and stale blendIn are invalid / stripped', () => {
    expect(motionOverlapsValid([clip('A', 0, 58), clip('B', 49, 139)])).toBe(false)
    const three = [clip('A', 0, 58), clip('B', 49, 139, { frames: 10, curve: 'smooth', footLock: true }), clip('C', 52, 100, { frames: 7, curve: 'smooth', footLock: true })]
    expect(motionOverlapsValid(three)).toBe(false)
    const stale = [clip('A', 0, 40), clip('B', 49, 139, { frames: 10, curve: 'smooth', footLock: true })]
    expect(normalizeBlendIns(stale).find((c) => c.id === 'B')!.playback.blendIn).toBeUndefined()
    // cảnh cũ không có blendIn: normalize trả đúng các đối tượng cũ
    const plain = [clip('A', 0, 58), clip('B', 58, 149)]
    expect(normalizeBlendIns(plain).every((c, i) => c === plain[i])).toBe(true)
    expect(motionOverlapsValid(plain)).toBe(true)
  })
})

describe('findInvalidMotionOverlaps (K4 preflight)', () => {
  const b = (frames: number): MotionBlendIn => ({ frames, curve: 'smooth', footLock: true })
  const cases: Array<[string, MotionClip[], string[]]> = [
    ['valid blend', [clip('A', 0, 58), clip('B', 44, 134, b(15))], []],
    ['touching clips', [clip('A', 0, 58), clip('B', 58, 134)], []],
    ['overlap without blendIn', [clip('A', 0, 58), clip('B', 44, 134)], ['no-blend']],
    ['blendIn shorter than the overlap', [clip('A', 0, 58), clip('B', 44, 134, b(5))], ['no-blend']],
    ['three clips', [clip('A', 0, 58), clip('B', 40, 100, b(19)), clip('C', 45, 134, b(14))], ['no-blend', 'no-blend', 'triple']],
    ['other characters do not interact', [clip('A', 0, 58), clip('B', 44, 134, undefined, 'other')], []],
  ]
  for (const [name, clips, reasons] of cases) {
    it(name, () => {
      const found = findInvalidMotionOverlaps(clips)
      expect(found.length > 0).toBe(!motionOverlapsValid(clips))
      if (reasons.length) expect(found.map((item) => item.reason).sort()).toEqual([...reasons].sort())
      else expect(found).toEqual([])
    })
  }
})
