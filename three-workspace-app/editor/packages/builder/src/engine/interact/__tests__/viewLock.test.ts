import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'vitest'
import type { EditorCameraController } from '../camera/EditorCameraController'
import { bindViewportNavigation } from '../ViewportNavigation'

type Listener = (event: Record<string, unknown>) => void

function fakeTarget() {
  const listeners = new Map<string, Listener[]>()
  return {
    listeners,
    addEventListener: (type: string, fn: Listener) => { listeners.set(type, [...(listeners.get(type) ?? []), fn]) },
    removeEventListener: (type: string, fn: Listener) => { listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== fn)) },
    fire(type: string, event: Record<string, unknown>) { for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, target: null, timeStamp: 0, ...event }) },
  }
}

describe('Khoá khung 3D (B2)', () => {
  const previous = { window: globalThis.window, Element: globalThis.Element }
  let win: ReturnType<typeof fakeTarget>
  let canvas: ReturnType<typeof fakeTarget> & { focus(): void; setPointerCapture(): void; clientHeight: number }
  let calls: string[]
  let locked: boolean
  let unbind: (() => void) | undefined

  beforeEach(() => {
    win = fakeTarget()
    Object.assign(globalThis, { window: win, Element: class {} })
    canvas = Object.assign(fakeTarget(), { focus() {}, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false, clientHeight: 400, style: {}, tabIndex: -1 })
    calls = []
    locked = false
    const record = (name: string) => () => { calls.push(name) }
    const camera = {
      looking: false,
      start() {}, stop() {}, setShift() {},
      setKey: (key: string, down: boolean) => { if (down) calls.push(`key:${key}`) },
      applyLookDelta: record('look'), applyOrbitDelta: record('orbit'), applyPanDelta: record('pan'),
      applyZoomDelta: record('zoom'), beginOrbitGesture: record('beginOrbit'),
    } as unknown as EditorCameraController
    unbind = bindViewportNavigation({
      camera,
      canvas: canvas as unknown as HTMLCanvasElement,
      container: fakeTarget() as unknown as HTMLElement,
      isHandleActive: () => false,
      isEnabled: () => true,
      isViewLocked: () => locked,
      getHandlers: () => null,
    })
  })

  afterEach(() => {
    unbind?.()
    Object.assign(globalThis, previous)
  })

  const drive = () => {
    win.fire('keydown', { key: 'w', code: 'KeyW' })
    canvas.fire('wheel', { deltaX: 0, deltaY: -120, deltaMode: 0, ctrlKey: true, metaKey: false })
    canvas.fire('pointerdown', { button: 2, pointerId: 1, clientX: 10, clientY: 10, pointerType: 'mouse' })
    canvas.fire('pointermove', { pointerId: 1, clientX: 80, clientY: 60, pointerType: 'mouse' })
    canvas.fire('pointerup', { button: 2, pointerId: 1, clientX: 80, clientY: 60, pointerType: 'mouse' })
    canvas.fire('pointerdown', { button: 1, pointerId: 2, clientX: 10, clientY: 10, pointerType: 'mouse' })
    canvas.fire('pointermove', { pointerId: 2, clientX: 50, clientY: 30, pointerType: 'mouse' })
    canvas.fire('pointerup', { button: 1, pointerId: 2, clientX: 50, clientY: 30, pointerType: 'mouse' })
  }

  it('không khoá: phím, lăn, kéo phải và kéo giữa đều đổi camera', () => {
    drive()
    for (const name of ['key:w', 'zoom', 'look', 'pan']) assert.ok(calls.includes(name), `thiếu ${name}: ${calls.join(',')}`)
  })

  it('khoá: phím tắt, Ctrl+lăn và kéo không chạm camera', () => {
    locked = true
    drive()
    assert.deepEqual(calls, [])
  })

  it('mở khoá lại thì camera nhận điều khiển như cũ', () => {
    locked = true
    drive()
    locked = false
    drive()
    assert.ok(calls.includes('key:w') && calls.includes('zoom'))
  })
})
