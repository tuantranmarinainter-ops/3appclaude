import type { SaveState } from '../../stores/types'

export function resolveSaveStatus(input: {
  ready: boolean
  dirty: boolean
  saveState: SaveState
  saveError: string | null
  t: (key: string) => string
}): { text: string; tone: 'ok' | 'warn' | 'error' | 'muted' } | null {
  if (!input.ready) return null
  if (input.saveState === 'saving') return { text: input.t('save.saving'), tone: 'muted' }
  if (input.saveState === 'error') {
    return {
      text: input.saveError ? input.t(input.saveError) : input.t('save.failed'),
      tone: 'error',
    }
  }
  if (input.dirty) return { text: input.t('save.unsaved'), tone: 'warn' }
  return { text: input.t('save.saved'), tone: 'ok' }
}

