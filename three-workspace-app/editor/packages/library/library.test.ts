import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MIXAMO65_BONE_PARENTS } from '../retarget/src/mixamo65'
import { callLibraryTool } from './mcp'
import { getAction, importPack, listLibraryCharacters, registerLibraryCharacter, searchLibrary, setActionMetadata } from './library'
import { defaultLibraryPath, resolveLibraryPath, safeChild, validateRelativeAssetPath } from './store'

const firstUuid = 'df7ac5ff-0000-4000-8000-000000000001'
const secondUuid = 'df7ac5ff-0000-4000-8000-000000000002'

function makeGlb(): Buffer {
  const byName = new Map(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, index]))
  const nodes = MIXAMO65_BONE_PARENTS.map(([name, parent]) => ({ name, ...(parent ? {} : { translation: [0, 1, 0] }), children: [] as number[] }))
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) if (parent) nodes[byName.get(parent)!]!.children.push(byName.get(name)!)
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes, skins: [{ joints: nodes.map((_, index) => index) }] }))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
  const header = Buffer.alloc(20)
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, padded])
}

function makeNormalizedOutput(root: string): string {
  const directory = join(root, 'walk')
  mkdirSync(directory, { recursive: true })
  const glb = makeGlb()
  const glbSha256 = createHash('sha256').update(glb).digest('hex')
  writeFileSync(join(directory, 'walk.glb'), glb)
  writeFileSync(join(directory, 'walk.manifest.json'), JSON.stringify({
    version: '1.0.0', glbSha256, actions: [
      { uuid: firstUuid, name: 'Walk forward', durationSeconds: 2, fps: 30, glbAnimationIndex: 0 },
      { uuid: secondUuid, name: 'Walk turn', durationSeconds: 1.5, fps: 30, glbAnimationIndex: 1 },
    ], source: { file: 'walk.fbx', sha256: 'a'.repeat(64) }, target: { file: 'mixamo65.glb', sha256: 'b'.repeat(64) },
    rootPolicy: { mode: 'preserve' },
  }))
  writeFileSync(join(directory, 'walk.report.json'), JSON.stringify({ status: 'PASS' }))
  writeFileSync(join(directory, 'walk.preview.png'), Buffer.from([137, 80, 78, 71]))
  writeFileSync(join(directory, 'walk.minecraft20.bobj'), 'temporary test fixture')
  return directory
}

test('imports normalized outputs into content-addressed packs and searches rig/category/tags', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'library-test-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const source = makeNormalizedOutput(temporary)
  const root = join(temporary, 'library')
  const imported = importPack({ root, sourceDirectory: source, category: 'locomotion', tags: ['walk', 'happy'] })
  assert.equal(imported.rig, 'mixamo65')
  assert.equal(imported.actions, 2)
  assert.equal(imported.metadata.license.commitable, false)
  assert.equal(imported.metadata.boundCharacter, 'b'.repeat(64))
  assert.equal(imported.metadata.actions[0]!.cover, `covers/${firstUuid}.png`)
  assert.deepEqual([imported.metadata.actions[0]!.nameVi, imported.metadata.actions[0]!.nameViSource], ['Đi về trước', 'glossary'])
  assert.equal(readFileSync(join(root, 'packs', imported.packId, 'anim.bobj'), 'utf8'), 'temporary test fixture', 'App 1 .minecraft20.bobj sidecar is kept')
  assert.equal(importPack({ root, sourceDirectory: source }).created, false)
  const results = searchLibrary({ root, rig: 'mixamo65', category: 'locomotion', tags: ['happy'], text: 'walk' })
  assert.equal(results.total, 2)
  assert.deepEqual(results.items.map((action) => action.uuid).sort(), [firstUuid, secondUuid])
  const action = getAction({ root, actionUuid: firstUuid })
  assert.equal(readFileSync(action.glbPath).length, makeGlb().length)
  assert.ok(action.coverPath?.endsWith(`${firstUuid}.png`))
})

test('metadata updates reindex actions without changing the immutable GLB', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'library-metadata-test-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'library')
  const sourceDirectory = makeNormalizedOutput(temporary)
  const pack = importPack({ root, sourceDirectory })
  const before = readFileSync(join(root, 'packs', pack.packId, 'anim.glb'))
  setActionMetadata({ root, actionUuid: firstUuid, category: 'dance', tags: ['samba', 'loop'], loop: true, nameVi: 'Đi tới trước' })
  const found = searchLibrary({ root, category: 'dance', tags: ['samba'], limit: 1 })
  assert.equal(found.total, 1)
  assert.equal(found.items[0]!.loop, true)
  assert.equal(found.items[0]!.nameVi, 'Đi tới trước')
  assert.equal(found.items[0]!.nameViSource, 'manual')
  assert.equal(searchLibrary({ root, text: 'di toi truoc' }).items[0]!.uuid, firstUuid, 'Vietnamese search is accent insensitive')
  assert.deepEqual(readFileSync(join(root, 'packs', pack.packId, 'anim.glb')), before)
  assert.equal(callLibraryTool('library.search', { category: 'dance', tags: ['samba'] }, { root }).total, 1)
  assert.equal(callLibraryTool('library.get', { actionUuid: firstUuid }, { root }).packId, pack.packId)
  assert.equal(callLibraryTool('library.action.metadata.set', { actionUuid: firstUuid, nameVi: 'Bước tới' }, { root }).nameVi, 'Bước tới')
  assert.equal((callLibraryTool('library.characters', {}, { root }) as unknown[]).length, 0)
})

test('character registration copies into the external library and lists metadata only', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'library-character-test-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const model = join(temporary, 'character.bobj')
  writeFileSync(model, 'temporary test fixture')
  const root = join(temporary, 'library')
  const character = registerLibraryCharacter({ root, name: 'Character A', rig: 'minecraft20', modelFile: model })
  assert.equal(character.license.commitable, false)
  assert.deepEqual(listLibraryCharacters({ root }).map((item) => item.charId), [character.charId])
  assert.equal(searchLibrary({ root }).total, 0)
})

test('path and platform defaults reject unsafe locations', () => {
  assert.equal(defaultLibraryPath('win32'), 'C:\\w01-library')
  assert.throws(() => resolveLibraryPath({ root: 'relative/library' }), /absolute path/)
  assert.throws(() => resolveLibraryPath({ root: '/repo/library', repositoryRoot: '/repo' }), /outside the repository/)
  assert.throws(() => safeChild('/tmp/library', '..', 'escape'), /escapes library root/)
  assert.equal(validateRelativeAssetPath('covers/action.png'), 'covers/action.png')
  for (const value of ['../secret', 'covers\\secret', '/absolute/file', 'C:/secret']) assert.throws(() => validateRelativeAssetPath(value))
})
