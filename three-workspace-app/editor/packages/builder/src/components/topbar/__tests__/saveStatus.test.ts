import { describe, expect, it } from 'vitest'
import { resolveSaveStatus } from '../saveStatus'

const t = (key: string) => key
const input = { ready: true, dirty: false, saveState: 'saved' as const, saveError: null, t }

describe('save status', () => {
  it('reflects readiness, pending changes and save outcomes', () => {
    expect(resolveSaveStatus({ ...input, ready: false })).toBeNull()
    expect(resolveSaveStatus(input)).toEqual({ text: 'save.saved', tone: 'ok' })
    expect(resolveSaveStatus({ ...input, dirty: true })).toEqual({ text: 'save.unsaved', tone: 'warn' })
    expect(resolveSaveStatus({ ...input, dirty: true, saveState: 'saving' })).toEqual({ text: 'save.saving', tone: 'muted' })
    expect(resolveSaveStatus({ ...input, dirty: true, saveState: 'error' })).toEqual({ text: 'save.failed', tone: 'error' })
  })
})
