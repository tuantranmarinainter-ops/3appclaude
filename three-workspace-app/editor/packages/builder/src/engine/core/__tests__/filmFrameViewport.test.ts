import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyFilmFrameProjection, applyViewportProjection, filmFrameAspectForView, filmFrameRect, viewportLetterboxRect } from '../Viewport'

describe('film frame viewport policy and geometry', () => {
  it('centers the largest square film frame inside a 16:9 viewport', () => {
    expect(filmFrameRect(1920, 1080, 1)).toEqual({ x: 420, y: 0, width: 1080, height: 1080 })
  })

  it('centers a 16:9 frame inside a square viewport', () => {
    const rect = filmFrameRect(1000, 1000, 16 / 9)
    expect(rect.x).toBe(0)
    expect(rect.y).toBeCloseTo(218.75)
    expect(rect.width).toBe(1000)
    expect(rect.height).toBeCloseTo(562.5)
  })

  it('leaves current framing alone when BBS look or camera view is off', () => {
    expect(filmFrameAspectForView(false, true, 1)).toBeNull()
    expect(filmFrameAspectForView(true, false, 1)).toBeNull()
    expect(filmFrameAspectForView(true, true, null)).toBeNull()
    expect(filmFrameAspectForView(true, true, 1)).toBe(1)
  })

  it('sets camera aspect and view offset to the saved film rectangle', () => {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100)
    applyFilmFrameProjection(camera, 1920, 1080, 1)
    expect(camera.aspect).toBe(1)
    expect(camera.view).toMatchObject({ enabled: true, fullWidth: 1080, fullHeight: 1080, offsetX: -420, offsetY: 0, width: 1920, height: 1080 })

    applyFilmFrameProjection(camera, 1000, 1000, 9 / 16)
    expect(camera.aspect).toBe(9 / 16)
    expect(camera.view).toMatchObject({ enabled: true, fullWidth: 562.5, fullHeight: 1000, offsetX: -218.75, offsetY: 0, width: 1000, height: 1000 })
  })

  it('restores the normal free-view projection when film framing turns off', () => {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100)
    applyViewportProjection(camera, 1920, 1080, null, 1, 16 / 9)
    expect(camera.aspect).toBe(1)
    expect(camera.view?.enabled).toBe(true)
    applyViewportProjection(camera, 1920, 1080, null, filmFrameAspectForView(false, true, 1), null)
    expect(camera.aspect).toBeCloseTo(16 / 9)
    expect(camera.view?.enabled).toBe(false)
  })

  it('uses the film overlay instead of opaque letterboxing for a BBS-look camera view', () => {
    expect(viewportLetterboxRect(1920, 1080, null, 16 / 9)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(viewportLetterboxRect(1920, 1080, 1, 16 / 9)).toBeNull()
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100)
    applyViewportProjection(camera, 1920, 1080, null, 1, null)
    expect(camera.aspect).toBe(1)
    expect(camera.view).toMatchObject({ enabled: true, fullWidth: 1080, fullHeight: 1080, offsetX: -420, offsetY: 0 })
  })

  it('rejects nonpositive or nonfinite geometry inputs', () => {
    expect(() => filmFrameRect(0, 100, 1)).toThrow(/positive finite/)
    expect(() => filmFrameRect(100, 100, Number.NaN)).toThrow(/positive finite/)
    expect(() => filmFrameAspectForView(true, true, 0)).toThrow(/positive finite/)
  })
})
