import assert from 'node:assert/strict'
import test from 'node:test'

// E9: the "Phím tắt" (navigation hint) panel must remember being dismissed via
// localStorage so it does not reappear on every scene entry; the topbar
// Shortcuts button remains the manual way to reopen the full shortcut list.
test('navigation hint dismissal persists to localStorage', async () => {
  const store = new Map<string, string>()
  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
  }
  const globalRef = globalThis as { window?: unknown }
  const originalWindow = globalRef.window
  globalRef.window = { localStorage: fakeStorage }
  try {
    const { navigationHintPreference } = await import('./navigationHintPreference.ts')
    assert.equal(navigationHintPreference.read(), false, 'hint starts visible for a new user')
    navigationHintPreference.dismiss()
    assert.equal(navigationHintPreference.read(), true, 'hint stays dismissed after dismiss()')
    assert.deepEqual([...store.values()], ['1'], 'dismissal is written to localStorage exactly once')

    // A storage backend that throws (private mode) must not break read/dismiss.
    globalRef.window = {
      localStorage: {
        getItem: () => { throw new Error('denied') },
        setItem: () => { throw new Error('denied') },
      },
    }
    assert.doesNotThrow(() => navigationHintPreference.read())
    assert.doesNotThrow(() => navigationHintPreference.dismiss())
    assert.equal(navigationHintPreference.read(), true, 'in-memory fallback keeps the dismissal for the session')
  } finally {
    globalRef.window = originalWindow
  }
})
