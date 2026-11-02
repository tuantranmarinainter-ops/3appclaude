import assert from 'node:assert/strict'
import test from 'node:test'

// B8: dismissing on one port (e.g. 3016) must also hide the panel on other ports of the same host.
test('navigation hint dismissal is shared across ports through a cookie', async () => {
  const globalRef = globalThis as { window?: unknown; document?: unknown }
  const originalWindow = globalRef.window, originalDocument = globalRef.document
  let jar = ''
  const doc = { get cookie() { return jar }, set cookie(value: string) { jar = jar ? `${jar}; ${value.split(';')[0]}` : value.split(';')[0]! } }
  globalRef.document = doc
  globalRef.window = { localStorage: { getItem: () => null, setItem: () => undefined } }
  try {
    const first = (await import('../src/navigationHintPreference.ts?port-3016')).navigationHintPreference
    assert.equal(first.read(), false)
    first.dismiss()
    assert.match(jar, /t3d-nav-hint-dismissed=1/)
    // Another port: fresh module state and empty localStorage, same host cookie.
    const second = (await import('../src/navigationHintPreference.ts?port-3025')).navigationHintPreference
    assert.equal(second.read(), true)
  } finally {
    globalRef.window = originalWindow; globalRef.document = originalDocument
  }
})
