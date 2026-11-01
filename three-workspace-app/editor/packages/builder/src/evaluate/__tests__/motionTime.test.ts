import { describe, expect, it } from 'vitest'
import type { MotionClip } from '../../contract/types'
import { motionClipOverrunSeconds, motionExtendMode, motionTimeSeconds } from '../clips'

const FPS = 30

// 1 giây động tác gốc, clip 3 giây (frame 0..89).
function clip(playback: Partial<MotionClip['playback']> = {}, motion: Partial<MotionClip['motion']> = {}): MotionClip {
  return {
    id: 'c1',
    source: 'x',
    sourceDuration: 1,
    frameStart: 0,
    frameEnd: 89,
    target: { type: 'node', nodeId: 'n1' },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'repeat', ...playback },
    motion: { assetId: 'a', name: 'a', source: 's', sourceRig: 'r', url: 'u', inPlace: false, loop: false, speed: 1, time: 0, ...motion },
  }
}

describe('B9 motionTimeSeconds extend modes', () => {
  it('old documents: loop=false holds the last frame, loop=true repeats', () => {
    expect(motionExtendMode(clip().playback)).toBe('hold')
    expect(motionExtendMode(clip({ loop: true }).playback)).toBe('loop')
    expect(motionTimeSeconds(clip(), 15, FPS)).toBeCloseTo(0.5)
    expect(motionTimeSeconds(clip(), 60, FPS)).toBeCloseTo(1)
    expect(motionTimeSeconds(clip({ loop: true }), 45, FPS)).toBeCloseTo(0.5)
  })

  it('stretch fills the whole clip', () => {
    const c = clip({ loopMode: 'stretch' })
    expect(motionExtendMode(c.playback)).toBe('stretch')
    expect(motionTimeSeconds(c, 0, FPS)).toBeCloseTo(0)
    expect(motionTimeSeconds(c, 45, FPS)).toBeCloseTo(0.5)
    expect(motionTimeSeconds(c, 89, FPS)).toBeCloseTo(89 / 90)
  })

  it('stretch honours the trimmed source range and reverse', () => {
    const c = clip({ loopMode: 'stretch' }, { time: 0.2, sourceLengthSeconds: 0.5 })
    expect(motionTimeSeconds(c, 45, FPS)).toBeCloseTo(0.45)
    const r = clip({ loopMode: 'stretch' }, { time: 0.2, sourceLengthSeconds: 0.5, reverse: true })
    expect(motionTimeSeconds(r, 0, FPS)).toBeCloseTo(0.7)
  })

  it('ping-pong bounces back and forth', () => {
    const c = clip({ loop: true, loopMode: 'ping-pong' })
    expect(motionTimeSeconds(c, 15, FPS)).toBeCloseTo(0.5)
    expect(motionTimeSeconds(c, 45, FPS)).toBeCloseTo(0.5)
    expect(motionTimeSeconds(c, 60, FPS)).toBeCloseTo(0)
    expect(motionTimeSeconds(c, 75, FPS)).toBeCloseTo(0.5)
  })

  it('explicit extendMode wins over the legacy flags', () => {
    expect(motionExtendMode({ loop: true, loopMode: 'repeat', extendMode: 'hold' })).toBe('hold')
  })

  it('reports how much longer the clip is than its source', () => {
    expect(motionClipOverrunSeconds(clip(), FPS)).toBeCloseTo(2)
    expect(motionClipOverrunSeconds(clip({ speed: 2 }), FPS)).toBeCloseTo(2.5)
    expect(motionClipOverrunSeconds({ ...clip(), frameEnd: 14 }, FPS)).toBe(0)
  })
})
