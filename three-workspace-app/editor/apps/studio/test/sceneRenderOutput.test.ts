import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { parseRenderFrames, saveJob } from '../app/workbench/components/scene-render/utils.ts'

test('render frame input rejects empty, duplicate and out-of-range entries', () => {
  assert.deepEqual(parseRenderFrames(' 0, 45, 89 ', 0, 89), [0, 45, 89])
  for (const text of ['', ' ', ',1', '0,', '0,,1', '0,0', '-1', '90', '1.5', '1e1']) {
    assert.equal(parseRenderFrames(text, 0, 89), null, text)
  }
})

test('browser render saving rejects corrupt downloads before creating files and preserves existing folders', async () => {
  const originalFetch = globalThis.fetch
  const bytes = new Blob(['png content'])
  const job = { jobId: randomUUID(), state: 'succeeded' as const, sourceRevision: 0, progress: 1,
    result: { files: [{ id: '0', name: 'image.png', mimeType: 'image/png', sizeBytes: bytes.size, sha256: createHash('sha256').update('different').digest('hex') }], provenance: {}, warnings: [], blockedRequests: [] } }
  let created = false
  const directory = {
    queryPermission: async () => 'granted',
    getDirectoryHandle: async (_name: string, options?: { create: boolean }) => {
      if (!options?.create) throw new DOMException('Missing', 'NotFoundError')
      created = true
      throw new Error('Must not create before verification')
    },
  } as unknown as Parameters<typeof saveJob>[2]
  globalThis.fetch = async () => new Response(bytes)
  try {
    await assert.rejects(saveJob(randomUUID(), job, directory), /SHA-256/)
    assert.equal(created, false)
    directory.getDirectoryHandle = async () => directory
    await assert.rejects(saveJob(randomUUID(), job, directory), /đã tồn tại/)
  } finally { globalThis.fetch = originalFetch }
})

test('browser Film saving writes the verified archive into a new film job folder', async () => {
  const originalFetch = globalThis.fetch
  const bytes = new Blob(['zip content'])
  const name = `film-${randomUUID()}`
  const expected = createHash('sha256').update('zip content').digest('hex')
  const writes: string[] = []
  const output = {
    getFileHandle: async (fileName: string) => ({ createWritable: async () => ({
      write: async (blob: Blob) => { assert.equal(await blob.text(), 'zip content'); writes.push(fileName) },
      close: async () => undefined, abort: async () => undefined,
    }) }),
  }
  const directory = {
    queryPermission: async () => 'granted',
    getDirectoryHandle: async (folder: string, options?: { create: boolean }) => {
      assert.equal(folder, name)
      if (!options?.create) throw new DOMException('Missing', 'NotFoundError')
      return output
    },
  } as unknown as Parameters<typeof saveJob>[2]
  const job = { jobId: name.slice('film-'.length), state: 'succeeded' as const, sourceRevision: 3, progress: 1,
    result: { files: [{ id: '0', name: 'sample-film.zip', mimeType: 'application/zip', sizeBytes: bytes.size, sha256: expected }], provenance: {}, warnings: [], blockedRequests: [] } }
  globalThis.fetch = async () => new Response(bytes)
  try {
    await saveJob(randomUUID(), job, directory, 'film')
    assert.deepEqual(writes, ['sample-film.zip'])
  } finally { globalThis.fetch = originalFetch }
})
