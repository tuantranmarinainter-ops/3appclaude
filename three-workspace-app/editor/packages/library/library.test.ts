import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MIXAMO65_BONE_PARENTS } from '../retarget/src/mixamo65'
import { callLibraryTool } from './mcp'
import { getAction, importPack, listLibraryCharacters, rebuildLibraryIndex, registerLibraryCharacter, searchLibrary, setActionMetadata, setActionPreview } from './library'
import { readdirSync } from 'node:fs'
import { defaultLibraryPath, resolveLibraryPath, safeChild, validateRelativeAssetPath } from './store'

const firstUuid = 'df7ac5ff-0000-4000-8000-000000000001'
const secondUuid = 'df7ac5ff-0000-4000-8000-000000000002'

function makeGlb(nonce = ''): Buffer {
  const byName = new Map(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, index]))
  const nodes = MIXAMO65_BONE_PARENTS.map(([name, parent]) => ({ name, ...(parent ? {} : { translation: [0, 1, 0] }), children: [] as number[] }))
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) if (parent) nodes[byName.get(parent)!]!.children.push(byName.get(name)!)
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0', ...(nonce ? { extras: { nonce } } : {}) }, nodes, skins: [{ joints: nodes.map((_, index) => index) }] }))
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
  const originalName = found.items[0]!.sourceName
  setActionMetadata({ root, actionUuid: firstUuid, name: 'Renamed English', nameVi: 'Đổi tên' })
  assert.equal(getAction({ root, actionUuid: firstUuid }).name, 'Renamed English')
  assert.equal(getAction({ root, actionUuid: firstUuid }).sourceName, originalName)
  setActionMetadata({ root, actionUuid: firstUuid, favorite: true })
  assert.equal(getAction({ root, actionUuid: firstUuid }).favorite, true, 'favorite pin is stored on the action')
  assert.equal(searchLibrary({ root }).items.find((item) => item.uuid === firstUuid)?.favorite, true, 'favorite survives reindexing')
  setActionMetadata({ root, actionUuid: firstUuid, favorite: false })
  assert.equal(getAction({ root, actionUuid: firstUuid }).favorite, undefined, 'clearing favorite removes the flag')
  assert.equal(callLibraryTool('library.action.metadata.set', { actionUuid: firstUuid, favorite: true }, { root }).favorite, true, 'MCP metadata tool toggles favorite')
  assert.deepEqual(readFileSync(join(root, 'packs', pack.packId, 'anim.glb')), before)
  assert.equal(callLibraryTool('library.search', { category: 'dance', tags: ['samba'] }, { root }).total, 1)
  assert.equal(callLibraryTool('library.get', { actionUuid: firstUuid }, { root }).packId, pack.packId)
  const video = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])
  mkdirSync(join(root, 'packs', pack.packId, 'previews'), { recursive: true })
  writeFileSync(join(root, 'packs', pack.packId, 'previews', `${firstUuid}.webm`), video)
  const preview = { file: `previews/${firstUuid}.webm`, sha256: createHash('sha256').update(video).digest('hex'), width: 320, height: 320, fps: 15, seconds: 2.5 }
  setActionPreview({ root, actionUuid: firstUuid, preview })
  assert.deepEqual(getAction({ root, actionUuid: firstUuid }).preview, preview)
  assert.equal(readFileSync(getAction({ root, actionUuid: firstUuid }).previewPath!).length, video.length)
  assert.throws(() => setActionPreview({ root, actionUuid: firstUuid, preview: { ...preview, file: '../outside.webm' } }), /unsafe|relative/i)
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

test('rig topology comparison ignores joint order but not parents', async () => {
  const { sameRigTopology } = await import('./importPack')
  const a = [{ name: 'Hips', parent: null }, { name: 'Spine', parent: 'Hips' }, { name: 'LeftUpLeg', parent: 'Hips' }]
  assert.equal(sameRigTopology(a, [a[2]!, a[0]!, a[1]!]), true)
  assert.equal(sameRigTopology(a, [a[0]!, a[1]!, { name: 'LeftUpLeg', parent: 'Spine' }]), false)
  assert.equal(sameRigTopology(a, a.slice(0, 2)), false)
})

function makeRun(root: string, name: string, uuids: string[], nonce: string): string {
  const directory = join(root, name), glb = makeGlb(nonce)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'run.glb'), glb)
  writeFileSync(join(directory, 'run.manifest.json'), JSON.stringify({
    version: '1.0.0', glbSha256: createHash('sha256').update(glb).digest('hex'),
    actions: uuids.map((uuid, index) => ({ uuid, name: `Action ${uuid.slice(-1)}`, durationSeconds: 1, fps: 30, glbAnimationIndex: index })),
    source: { file: 'soldier.glb', sha256: 'c'.repeat(64) }, target: { file: 'mixamo65.glb', sha256: 'b'.repeat(64) }, rootPolicy: { mode: 'preserve' },
  }))
  writeFileSync(join(directory, 'run.report.json'), JSON.stringify({ status: 'PASS' }))
  return directory
}

test('an Action uuid lives in one pack: a second run of the same source keeps only new Actions', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'library-dup-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'library')
  const [a, b] = [firstUuid, secondUuid]
  const first = importPack({ root, sourceDirectory: makeRun(temporary, 'r1', [a], 'one') })
  assert.equal(first.created, true)
  const again = importPack({ root, sourceDirectory: makeRun(temporary, 'r2', [a], 'two') })
  assert.deepEqual([again.created, again.packId, again.actions, again.reusedActionUuids], [false, first.packId, 0, [a]])
  assert.equal(again.metadata.actions[0]!.uuid, a)
  const partial = importPack({ root, sourceDirectory: makeRun(temporary, 'r3', [a, b], 'three') })
  assert.equal(partial.created, true)
  assert.deepEqual(partial.metadata.actions.map((x) => [x.uuid, x.glbAnimationIndex]), [[b, 1]])
  assert.deepEqual(partial.reusedActionUuids, [a])
  assert.equal(getAction({ root, actionUuid: a }).packId, first.packId)
  const uuids = searchLibrary({ root, limit: 100 }).items.map((x) => x.uuid)
  assert.deepEqual([...uuids].sort(), [a, b])
  assert.equal(readdirSync(join(root, 'packs')).filter((n) => /^[a-f0-9]{16}$/.test(n)).length, 2)
})

test('old data with one uuid in two packs rebuilds an index with unique uuids and a warning', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'library-old-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'library')
  const first = importPack({ root, sourceDirectory: makeRun(temporary, 'r1', [firstUuid], 'one') })
  const second = importPack({ root, sourceDirectory: makeRun(temporary, 'r2', [secondUuid], 'two') })
  // Recreate old duplicated data: the later pack also claims the first pack's uuid.
  const metaPath = join(root, 'packs', second.packId, 'meta.json'), meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  meta.actions.push({ ...meta.actions[0], uuid: firstUuid, glbAnimationIndex: 5 }); meta.createdAt = '2999-01-01T00:00:00.000Z'
  writeFileSync(metaPath, JSON.stringify(meta))
  const index = rebuildLibraryIndex({ root })
  assert.deepEqual(index.actions.map((x) => x.uuid).sort(), [firstUuid, secondUuid])
  assert.equal(index.actions.find((x) => x.uuid === firstUuid)!.packId, first.packId)
  assert.equal(index.warnings?.length, 1)
})
