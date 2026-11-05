import { describe, expect, it } from 'vitest'
import { isSaveShortcut } from '../saveShortcut'

describe('scene save shortcut', () => {
  const ctrlS = { ctrlKey: true, metaKey: false, altKey: false, code: 'KeyS' }
  it('handles Ctrl+S and Command+S only while the scene owns keyboard input', () => {
    expect(isSaveShortcut(ctrlS, true, true)).toBe(true)
    expect(isSaveShortcut({ ...ctrlS, ctrlKey: false, metaKey: true }, true, true)).toBe(true)
    expect(isSaveShortcut(ctrlS, false, true)).toBe(false)
    expect(isSaveShortcut(ctrlS, true, false)).toBe(false)
    expect(isSaveShortcut({ ...ctrlS, altKey: true }, true, true)).toBe(false)
  })
})
