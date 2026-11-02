import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { initializeLibrary } from '../../../packages/library/store'
import { listLibraryCharacterDetails } from '../src/libraryCommands'

test('character details reuse texture hashes on a 300-pack library and refresh changed bytes', async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'studio-library-read-cache-')), root = join(temporary, 'library')
  const previous = process.env.W01_LIBRARY
  process.env.W01_LIBRARY = root
  t.after(() => { if (previous === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previous; rmSync(temporary, { recursive: true, force: true }) })
  initializeLibrary(root)
  for (let id = 0; id < 300; id++) {
    const packId = id.toString(16).padStart(16, '0'), folder = join(root, 'packs', packId)
    mkdirSync(folder)
    writeFileSync(join(folder, 'meta.json'), JSON.stringify({ kind: 'motion-pack', packId, rig: 'minecraft20', createdAt: '2026-01-01', license: { id: 'test' }, actions: [] }))
  }
  const model = join(root, 'models', 'base'), character = join(root, 'characters', 'hero')
  mkdirSync(join(model, 'textures', 'Body'), { recursive: true }); mkdirSync(character)
  writeFileSync(join(model, 'meta.json'), JSON.stringify({ kind: 'base-model', modelId: 'base', model: 'model.bobj', format: 'bobj', objects: ['Body'], sha256: 'synthetic' }))
  writeFileSync(join(character, 'meta.json'), JSON.stringify({ kind: 'character', charId: 'hero', name: 'Hero', baseModelId: 'base', actions: [] }))
  const texture = join(model, 'textures', 'Body', 'default.png'), bytes = Buffer.alloc(8 * 1024 * 1024, 23)
  writeFileSync(texture, bytes)
  const index = join(root, 'index.json'); writeFileSync(index, 'unchanged')
  const stamp = statSync(index).mtimeMs
  let start = performance.now(); const first = await listLibraryCharacterDetails(); const cold = performance.now() - start
  start = performance.now(); const second = await listLibraryCharacterDetails(); const warm = performance.now() - start
  assert.ok(warm < 100, `warm character details ${warm.toFixed(2)}ms`)
  assert.equal(second[0]!.textures[0]!.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(first, second)
  bytes[0] = 42; writeFileSync(texture, bytes)
  assert.notEqual((await listLibraryCharacterDetails())[0]!.textures[0]!.sha256, second[0]!.textures[0]!.sha256)
  assert.equal(readFileSync(index, 'utf8'), 'unchanged'); assert.equal(statSync(index).mtimeMs, stamp)
  t.diagnostic(`300 packs, one 8 MiB texture: cold details ${cold.toFixed(2)}ms; warm details ${warm.toFixed(2)}ms; external texture mutation invalidated`)
})
