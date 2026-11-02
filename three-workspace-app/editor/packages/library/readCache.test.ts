import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { getAction, listLibraryCharacters, searchLibrary } from './library'
import { resolveCharacter } from './characters'
import { initializeLibrary, readIndex, withLibraryLock, writeIndex } from './store'
import { coverageMatrix, listCharacterActions } from './characterActions'

function snapshot(root: string): unknown[] {
  return readdirSync(root, { recursive: true, withFileTypes: true }).map(entry => {
    const file = join(entry.parentPath, entry.name), info = statSync(file)
    return [relative(root, file), info.mtimeMs, info.size, info.isFile() ? readFileSync(file).toString('base64') : null]
  })
}
function pack(root: string, id: number) {
  const packId = id.toString(16).padStart(16, '0'), directory = join(root, 'packs', packId)
  mkdirSync(directory)
  writeFileSync(join(directory, 'meta.json'), JSON.stringify({ kind: 'motion-pack', packId, rig: 'minecraft20', createdAt: '2026-01-01',
    license: { id: 'test', commitable: false, source: 'synthetic' }, actions: [{ uuid: `action-${id}`, name: `Walk ${id}`, category: 'locomotion', tags: [], cover: null }] }))
}

test('300-pack reads preserve every filesystem entry and invalidate additions and metadata edits', t => {
  const root = mkdtempSync(join(tmpdir(), 'library-read-cache-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  initializeLibrary(root)
  for (let id = 0; id < 300; id++) pack(root, id)
  mkdirSync(join(root, 'characters', 'hero'))
  writeFileSync(join(root, 'characters', 'hero', 'meta.json'), JSON.stringify({ kind: 'character', charId: 'hero', name: 'Hero', model: 'hero.glb', rig: 'minecraft20', actions: [] }))
  const baselineStart = performance.now()
  withLibraryLock(root, () => { initializeLibrary(root); writeIndex(root) })
  const baseline = performance.now() - baselineStart
  writeFileSync(join(root, 'index.json'), 'existing index must remain byte-identical')
  const before = snapshot(root)
  let start = performance.now()
  assert.equal(searchLibrary({ root }).total, 300)
  const cold = performance.now() - start
  start = performance.now()
  assert.equal(searchLibrary({ root }).total, 300)
  const warm = performance.now() - start
  assert.ok(warm < 20, `warm search ${warm.toFixed(2)}ms`)
  assert.equal(getAction({ root, actionUuid: 'action-299' }).name, 'Walk 299')
  assert.equal(listLibraryCharacters({ root })[0]!.charId, 'hero')
  assert.equal(resolveCharacter({ root, charId: 'hero' }).character.name, 'Hero')
  assert.deepEqual(listCharacterActions({ root, charId: 'hero' }), [])
  assert.equal(coverageMatrix({ root }).length, 1)
  assert.deepEqual(snapshot(root), before)
  pack(root, 300)
  assert.equal(searchLibrary({ root }).total, 301)
  const meta = join(root, 'packs', '0000000000000000', 'meta.json')
  const changed = JSON.parse(readFileSync(meta, 'utf8'))
  changed.actions[0].name = 'Edited externally'
  writeFileSync(meta, JSON.stringify(changed))
  assert.equal(getAction({ root, actionUuid: 'action-0' }).name, 'Edited externally')
  const cached = readIndex(root)
  mkdirSync(join(root, 'models', 'new-model'))
  assert.notEqual(readIndex(root), cached)
  const heroMeta = join(root, 'characters', 'hero', 'meta.json')
  const hero = JSON.parse(readFileSync(heroMeta, 'utf8')); hero.name = 'Updated hero'; writeFileSync(heroMeta, JSON.stringify(hero))
  assert.equal(listLibraryCharacters({ root })[0]!.name, 'Updated hero')
  rmSync(join(root, 'packs', '000000000000012c'), { recursive: true })
  assert.equal(searchLibrary({ root }).total, 300)
  t.diagnostic(`300 synthetic packs: previous lock/init/rebuild path ${baseline.toFixed(2)}ms; cold search ${cold.toFixed(2)}ms; warm search ${warm.toFixed(2)}ms; read filesystem unchanged; add pack 300 → 301`)
})

test('reading an absent library does not initialize it', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'library-absent-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  assert.equal(searchLibrary({ root: join(temporary, 'missing') }).total, 0)
  assert.deepEqual(readdirSync(temporary), [])
})
