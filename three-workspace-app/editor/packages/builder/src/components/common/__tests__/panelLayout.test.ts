import { describe, expect, it } from 'vitest'
import { clampPanelSize, clearPanelSize, readPanelSize, resizePanelSize, writePanelSize, type PanelSizeStorage } from '../panelLayout'

function memoryStorage(seed: Record<string, string> = {}): PanelSizeStorage & { values: Record<string, string> } {
  const values = { ...seed }
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => { values[key] = value },
    removeItem: (key) => { delete values[key] },
  }
}

describe('panel layout persistence', () => {
  it('applies pointer movement in either direction within panel constraints', () => {
    expect(resizePanelSize(240, 50, 1, 180, 360)).toBe(290)
    expect(resizePanelSize(280, 50, -1, 220, 400)).toBe(230)
    expect(resizePanelSize(240, 999, 1, 180, 360)).toBe(360)
    expect(resizePanelSize(240, 999, -1, 180, 360)).toBe(180)
  })

  it('clamps restored values and falls back for invalid storage', () => {
    const storage = memoryStorage({ wide: '999', invalid: 'nope' })
    const clamp = (value: number) => clampPanelSize(value, 180, 360)
    expect(readPanelSize(storage, 'wide', 241, clamp)).toBe(360)
    expect(readPanelSize(storage, 'invalid', 241, clamp)).toBe(241)
    expect(readPanelSize(storage, 'missing', 999, clamp)).toBe(360)
  })

  it('persists rounded sizes and clears them for reset', () => {
    const storage = memoryStorage()
    writePanelSize(storage, 'left', 245.6)
    expect(storage.values.left).toBe('246')
    clearPanelSize(storage, 'left')
    expect(storage.values.left).toBeUndefined()
  })

  it('keeps resizing usable when storage throws', () => {
    const blocked: PanelSizeStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(readPanelSize(blocked, 'x', 280, (value) => clampPanelSize(value, 220, 400))).toBe(280)
    expect(() => writePanelSize(blocked, 'x', 300)).not.toThrow()
    expect(() => clearPanelSize(blocked, 'x')).not.toThrow()
  })
})
