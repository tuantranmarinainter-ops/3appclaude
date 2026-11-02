import assert from 'node:assert/strict'
import test from 'node:test'
import { invalidateLibrary, libraryJson } from '../src/libraryClient'
import { loadVfxPreviews } from '../src/vfxPreviewClient'

test('profiles share three simultaneous reads, persist, invalidate once and recover from errors', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ characters: [{ charId: 'synthetic' }] }) }
  try {
    invalidateLibrary()
    await Promise.all(Array.from({ length: 3 }, () => libraryJson('/api/library?characters=1')))
    await libraryJson('/api/library?characters=1')
    assert.equal(calls, 1)
    invalidateLibrary()
    await Promise.all(Array.from({ length: 3 }, () => libraryJson('/api/library?characters=1')))
    assert.equal(calls, 2)
    for (const url of ['/api/library?raw=1', '/api/library?charId=synthetic']) {
      await Promise.all([libraryJson(url), libraryJson(url)])
      assert.equal(calls, url.includes('raw') ? 3 : 5)
      await libraryJson(url)
      assert.equal(calls, url.includes('raw') ? 4 : 6)
    }
    invalidateLibrary()
    globalThis.fetch = async () => Response.json({ error: 'offline' }, { status: 503 })
    await assert.rejects(libraryJson('/api/library?characters=1'), /offline/)
    globalThis.fetch = async () => Response.json({ characters: [] })
    assert.deepEqual(await libraryJson('/api/library?characters=1'), { characters: [] })
  } finally { globalThis.fetch = original; invalidateLibrary() }
})

test('VFX picker and preview share one session promise and explicit refresh', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return Response.json({ sheets: {} }) }
  try {
    await Promise.all([loadVfxPreviews(true), loadVfxPreviews(), loadVfxPreviews()])
    await loadVfxPreviews()
    assert.equal(calls, 1)
    await loadVfxPreviews(true)
    assert.equal(calls, 2)
  } finally { globalThis.fetch = original }
})
