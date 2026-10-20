import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CompassView } from '../interact/camera/CompassView'
import type { EditorViewDirection } from '../interact/camera/axisView'

const directions: EditorViewDirection[] = ['front', 'back', 'left', 'right', 'top', 'bottom']
describe('compass orthographic framing', () => {
  for (const direction of directions) for (const aspect of [0.5, 2]) {
    it(`fits every corner from ${direction} at aspect ${aspect}`, () => {
      const view = new CompassView()
      const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000)
      const bounds = new THREE.Box3(new THREE.Vector3(-32, -4, -12), new THREE.Vector3(8, 16, 80))
      view.fit(direction, bounds, aspect, camera)
      expect(view.direction).toBe(direction)
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new THREE.Vector3(x, y, z).project(view.camera)
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.81)
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.81)
          expect(Math.abs(projected.z)).toBeLessThan(1)
        }
      }
      view.exit()
      expect(view.direction).toBeNull()
      expect(camera.isPerspectiveCamera).toBe(true)
    })
  }
  it('handles empty scenes and narrower viewport resizing', () => {
    const view = new CompassView()
    expect(view.direction).toBeNull()
    view.fit('top', new THREE.Box3(), 2, new THREE.PerspectiveCamera(50))
    view.resize(0.4)
    expect(view.camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true)
    expect(view.camera.right - view.camera.left).toBeGreaterThanOrEqual(2.5)
  })
})

describe('orthographic activation boundaries', () => {
  it('activates only from compass selection and clears on reset, follow and pilot', async () => {
    const { DualViewport } = await import('../core/Viewport')
    const { vi } = await import('vitest')
    vi.stubGlobal('cancelAnimationFrame', () => {})
    try {
      const perspective = new THREE.PerspectiveCamera(50, 2, 0.1, 2000)
      const viewport = new DualViewport(perspective, {
        onInvalidate() {}, onInvalidateMain() {}, onEditorCameraChange() {}, onContextLostChange() {}, onContextRestored() {},
        getSceneMeshes: () => [],
        getSceneBounds: () => new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
        getOrbitPivot: () => ({ x: 0, y: 0, z: 0 }),
      })
      expect(viewport.viewCamera).toBe(perspective)
      for (const leave of [() => viewport.resetEditorView(), () => viewport.beginFollow(), () => viewport.detachMain()]) {
        viewport.setEditorView('top')
        expect(viewport.viewCamera).toBeInstanceOf(THREE.OrthographicCamera)
        leave()
        expect(viewport.viewDirection).toBeNull()
        expect(viewport.viewCamera).toBe(perspective)
      }
      viewport.cameraPilot = true
      viewport.setEditorView('front')
      expect(viewport.viewCamera).toBe(perspective)
      viewport.cameraPilot = false
      viewport.followMode = true
      viewport.setEditorView('right')
      expect(viewport.viewCamera).toBe(perspective)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
