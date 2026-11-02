import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readLibraryCharacterHeight } from '../src/libraryCharacterProfiles'

test('height reads use current profile JSON without requiring models, actions, or an index', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'b26-height-'))
  const prior = process.env.W01_LIBRARY
  process.env.W01_LIBRARY = root
  try {
    const directory = path.join(root, 'characters', 'hero')
    await mkdir(directory, { recursive: true })
    const file = path.join(directory, 'meta.json')
    const metadata = { kind: 'character', charId: 'hero', name: 'Hero', rig: 'minecraft20', heightBlocks: 1.8 }
    await writeFile(file, JSON.stringify(metadata))
    assert.deepEqual(await readLibraryCharacterHeight('hero'), { charId: 'hero', heightBlocks: 1.8 })
    await writeFile(file, JSON.stringify({ ...metadata, heightBlocks: 2.4 }))
    assert.deepEqual(await readLibraryCharacterHeight('hero'), { charId: 'hero', heightBlocks: 2.4 })
    assert.equal(JSON.parse(await readFile(file, 'utf8')).heightBlocks, 2.4)
    await assert.rejects(readLibraryCharacterHeight('../hero'))
    await writeFile(file, JSON.stringify({ ...metadata, charId: 'other' }))
    await assert.rejects(readLibraryCharacterHeight('hero'), /Invalid character metadata/)
  } finally {
    if (prior === undefined) delete process.env.W01_LIBRARY
    else process.env.W01_LIBRARY = prior
    await rm(root, { recursive: true, force: true })
  }
})
