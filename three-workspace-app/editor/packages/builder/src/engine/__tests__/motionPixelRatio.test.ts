import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import { MotionPixelRatio, PIXEL_RATIO_SETTLE_MS, viewportPixelRatio } from '../core/Renderer'

function fakeRenderer(initial: number): { r: THREE.WebGLRenderer; sets: number[] } {
  let ratio = initial
  const sets: number[] = []
  const r = {
    getPixelRatio: () => ratio,
    setPixelRatio: (v: number) => {
      ratio = v
      sets.push(v)
    },
  } as unknown as THREE.WebGLRenderer
  return { r, sets }
}

describe('viewportPixelRatio', () => {
  it('静止用清晰档（上限 2），运动用 1.5', () => {
    expect(viewportPixelRatio(2, false)).toBe(2)
    expect(viewportPixelRatio(3, false)).toBe(2)
    expect(viewportPixelRatio(2, true)).toBe(1.5)
    expect(viewportPixelRatio(1, true)).toBe(1)
    expect(viewportPixelRatio(0, false)).toBe(1)
  })
})

describe('MotionPixelRatio', () => {
  let now = 0
  beforeEach(() => {
    vi.useFakeTimers()
    now = 1000
  })
  afterEach(() => vi.useRealTimers())

  it('孤立渲染保持清晰，不排补帧', () => {
    const onSettle = vi.fn()
    const m = new MotionPixelRatio(onSettle, () => now)
    const { r, sets } = fakeRenderer(2)
    m.apply(r, 2)
    vi.advanceTimersByTime(PIXEL_RATIO_SETTLE_MS * 2)
    expect(sets).toEqual([])
    expect(onSettle).not.toHaveBeenCalled()
  })

  it('连续渲染降到 1.5，停下后补一帧清晰', () => {
    const onSettle = vi.fn()
    const m = new MotionPixelRatio(onSettle, () => now)
    const { r, sets } = fakeRenderer(2)
    m.apply(r, 2)
    for (let i = 0; i < 5; i++) {
      now += 16
      vi.advanceTimersByTime(16)
      m.apply(r, 2)
    }
    expect(r.getPixelRatio()).toBe(1.5)
    expect(sets).toEqual([1.5])
    expect(onSettle).not.toHaveBeenCalled()

    now += PIXEL_RATIO_SETTLE_MS
    vi.advanceTimersByTime(PIXEL_RATIO_SETTLE_MS)
    expect(onSettle).toHaveBeenCalledTimes(1)

    now += 16
    m.apply(r, 2)
    expect(r.getPixelRatio()).toBe(2)
    vi.advanceTimersByTime(PIXEL_RATIO_SETTLE_MS * 2)
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  it('每次渲染重读 devicePixelRatio（换显示器）', () => {
    const m = new MotionPixelRatio(() => {}, () => now)
    const { r } = fakeRenderer(2)
    m.apply(r, 1)
    expect(r.getPixelRatio()).toBe(1)
  })

  it('dispose 取消待补帧', () => {
    const onSettle = vi.fn()
    const m = new MotionPixelRatio(onSettle, () => now)
    const { r } = fakeRenderer(2)
    m.apply(r, 2)
    now += 16
    m.apply(r, 2)
    m.dispose()
    vi.advanceTimersByTime(PIXEL_RATIO_SETTLE_MS * 2)
    expect(onSettle).not.toHaveBeenCalled()
  })
})
