import { describe, expect, it, vi } from 'vitest'
import { saveBeforeExit } from '../saveBeforeExit'

describe('save before leaving', () => {
  it('waits for save before allowing exit', async () => {
    let finish!: (value: string | null) => void
    const save = vi.fn(() => new Promise<string | null>((resolve) => { finish = resolve }))
    const confirm = vi.fn(() => false)
    let resolved = false
    const result = saveBeforeExit(false, true, 'saving', save, confirm).then((value) => { resolved = true; return value })
    await Promise.resolve()
    expect(resolved).toBe(false)
    finish(null)
    expect(await result).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('only leaves after a failed save when the user confirms', async () => {
    expect(await saveBeforeExit(false, true, 'saved', async () => 'error', () => false)).toBe(false)
    expect(await saveBeforeExit(false, true, 'saved', async () => 'error', () => true)).toBe(true)
  })
  it('skips saving when clean but waits for a save already running', async () => {
    const save = vi.fn(async () => null)
    expect(await saveBeforeExit(false, false, 'saved', save, () => false)).toBe(true)
    expect(save).not.toHaveBeenCalled()
    expect(await saveBeforeExit(false, false, 'saving', save, () => false)).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(await saveBeforeExit(true, true, 'saving', save, () => false)).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
  })
  it('does not silently discard dirty edits under a write lock', async () => {
    const save = vi.fn(async () => null)
    expect(await saveBeforeExit(true, true, 'saved', save, () => false)).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })
})
