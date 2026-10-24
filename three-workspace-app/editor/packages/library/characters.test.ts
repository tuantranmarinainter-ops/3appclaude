import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createCharacter, createCharacterWithOwnBase, rebuildLibraryIndex, registerBaseModel, registerLibraryCharacter, resolveCharacter, searchLibrary, setCharacterSkin } from './library'
import { callLibraryTool } from './mcp'
import { LIBRARY_VERSION, type MotionPackMetadata } from './types'
import { readJsonFile, writeJsonAtomic } from './store'
const uuid = 'df7ac5ff-0000-4000-8000-000000000001'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
function texture(directory: string, object: string, data = png) {
  const path = join(directory, object, 'default.png')
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data)
  return path
}
function fixture(t: { after(fn: () => void): void }) {
  const temporary = mkdtempSync(join(tmpdir(), 'library-characters-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'library'), modelFile = join(temporary, 'source.bobj')
  writeFileSync(modelFile, '# BBSFix motion_scale=0.5\r\narm_bone Root 0 0 0\r\narm_bone Jaw Root 0 1 0\r\no verity.mdl/Body.smd\r\nv 0 0 0\r\nv 0 4 0\r\no Hair\r\no Missing\r\n')
  const texturesDir = join(temporary, 'textures')
  texture(texturesDir, 'verity.mdl/Body.smd'); texture(texturesDir, 'Hair')
  return { temporary, root, modelFile, texturesDir }
}
function pack(root: string) {
  const meta: MotionPackMetadata = { kind: 'motion-pack', libraryVersion: LIBRARY_VERSION, packId: 'a'.repeat(16), glbSha256: 'a'.repeat(64), rig: 'mixamo65', createdBy: 'app1', createdAt: new Date().toISOString(), license: { id: 'internal-only', commitable: false }, boundCharacter: null, source: { file: null, sha256: null }, actions: [{ uuid, name: 'Idle', durationSeconds: 1, fps: 30, category: 'idle', tags: [], loop: true, inPlace: true, parentUuid: null, cover: null, glbAnimationIndex: 0 }] }
  writeJsonAtomic(join(root, 'packs', meta.packId, 'meta.json'), meta)
}
function glb(value: unknown) {
  const json = Buffer.from(JSON.stringify(value)), padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]), header = Buffer.alloc(20)
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, padded])
}
test('one immutable base serves two characters; nested skin overrides merge with defaults', (t) => {
  const options = fixture(t), { root, temporary, modelFile } = options
  const base = registerBaseModel({ ...options, name: 'Verity', rig: 'verity' })
  assert.equal(base.created, true); assert.equal(base.metadata.heightMeters, 2)
  assert.deepEqual(base.metadata.bones, ['Root', 'Jaw']); assert.deepEqual(base.metadata.extraBones, ['Jaw'])
  assert.deepEqual(base.warnings.map((warning) => warning.object), ['Missing'])
  const again = registerBaseModel({ ...options, name: 'same bytes', rig: 'verity' })
  assert.equal(again.created, false); assert.equal(again.modelId, base.modelId)
  const skinDir = join(temporary, 'skin'); const override = texture(skinDir, 'verity.mdl/Body.smd', Buffer.concat([png, Buffer.from('skin')]))
  texture(skinDir, 'Hair') // Identical defaults do not consume a skin copy.
  const first = createCharacter({ root, name: 'First', baseModelId: base.modelId, skinDir })
  const second = createCharacter({ root, name: 'Second', baseModelId: base.modelId })
  const a = resolveCharacter({ root, charId: first.charId }), b = resolveCharacter({ root, charId: second.charId })
  assert.equal(a.modelPath, b.modelPath); assert.deepEqual(readFileSync(a.modelPath), readFileSync(modelFile))
  assert.deepEqual(readFileSync(a.textures['verity.mdl/Body.smd']!), readFileSync(override))
  assert.equal(existsSync(join(root, 'characters', first.charId, 'skin', 'textures', 'Hair', 'default.png')), false)
  assert.equal(a.textures.Hair, b.textures.Hair); assert.notEqual(a.textures['verity.mdl/Body.smd'], b.textures['verity.mdl/Body.smd'])
  assert.equal(readdirSync(join(root, 'models')).length, 1)
  assert.equal(existsSync(join(root, 'characters', first.charId, base.metadata.model)), false)
  const replacement = join(temporary, 'replacement')
  texture(replacement, 'Hair', Buffer.concat([png, Buffer.from('hair')]))
  setCharacterSkin({ root, charId: first.charId, skinDir: replacement })
  const replaced = resolveCharacter({ root, charId: first.charId })
  assert.equal(replaced.textures['verity.mdl/Body.smd'], b.textures['verity.mdl/Body.smd'])
  assert.notEqual(replaced.textures.Hair, b.textures.Hair)
  setCharacterSkin({ root, charId: first.charId })
  assert.equal(resolveCharacter({ root, charId: first.charId }).textures['verity.mdl/Body.smd'], b.textures['verity.mdl/Body.smd'])
  assert.deepEqual(rebuildLibraryIndex({ root }).characters.map((item) => item.actionCount), [0, 0])
})
test('membership drives search and MCP; removing default clears it; legacy records resolve', (t) => {
  const options = fixture(t), { root } = options
  const base = registerBaseModel({ ...options, name: 'synthetic', rig: 'verity' }); pack(root)
  const character = createCharacter({ root, name: 'A', baseModelId: base.modelId })
  assert.equal(searchLibrary({ root, boundCharacter: character.charId }).total, 0)
  const changed = callLibraryTool('library.character.actions.add', { charId: character.charId, actions: [uuid, uuid], defaultAction: uuid }, { root })
  assert.deepEqual(changed.actions, [uuid]); assert.equal(changed.defaultAction, uuid)
  assert.equal(searchLibrary({ root, boundCharacter: character.charId }).items[0]!.uuid, uuid)
  assert.equal(resolveCharacter({ root, charId: character.charId }).actions[0]!.name, 'Idle')
  assert.equal(callLibraryTool('library.characters', {}, { root })[0]!.baseModelId, base.modelId)
  assert.equal(rebuildLibraryIndex({ root }).characters[0]!.actionCount, 1)
  const removed = callLibraryTool('library.character.actions.remove', { charId: character.charId, actions: [uuid] }, { root })
  assert.deepEqual(removed.actions, []); assert.equal(removed.defaultAction, undefined)
  assert.equal(searchLibrary({ root, boundCharacter: character.charId }).total, 0)
  assert.throws(() => callLibraryTool('library.character.actions.add', { charId: character.charId, actions: ['unknown'] }, { root }), /not found/)
  assert.throws(() => callLibraryTool('library.character.actions.add', { charId: character.charId, actions: [], defaultAction: uuid }, { root }), /defaultAction/)
  const legacy = registerLibraryCharacter({ root, name: 'Legacy', rig: 'minecraft20', modelFile: options.modelFile })
  assert.deepEqual(readFileSync(resolveCharacter({ root, charId: legacy.charId }).modelPath), readFileSync(options.modelFile))
  const packPath = join(root, 'packs', 'a'.repeat(16), 'meta.json')
  const metadata = readJsonFile<MotionPackMetadata>(packPath)
  metadata.boundCharacter = legacy.charId
  writeJsonAtomic(packPath, metadata)
  assert.equal(searchLibrary({ root, boundCharacter: legacy.charId }).total, 1)
  assert.equal(resolveCharacter(legacy.charId, { root }).actions.length, 1)
  assert.equal(rebuildLibraryIndex({ root }).characters.find((item) => item.charId === legacy.charId)!.actionCount, 1)
  const legacySecond = 'df7ac5ff-0000-4000-8000-000000000002'
  metadata.actions.push({ ...metadata.actions[0]!, uuid: legacySecond, name: 'Walk' })
  writeJsonAtomic(packPath, metadata)
  assert.deepEqual(callLibraryTool('library.characters', {}, { root }).find((item) => item.charId === legacy.charId)!.actions, [uuid, legacySecond])
  // First mutation upgrades legacy memberships without discarding unrequested actions.
  const upgraded = callLibraryTool('library.character.actions.remove', { charId: legacy.charId, actions: [uuid] }, { root })
  assert.deepEqual(upgraded.actions, [legacySecond])
  assert.equal(searchLibrary({ root, boundCharacter: legacy.charId }).total, 1)
  const added = callLibraryTool('library.character.actions.add', { charId: legacy.charId, actions: [uuid] }, { root })
  assert.deepEqual(added.actions, [legacySecond, uuid])
  // An explicit empty action set overrides a pack's historical binding.
  metadata.boundCharacter = character.charId
  writeJsonAtomic(packPath, metadata)
  assert.equal(searchLibrary({ root, boundCharacter: character.charId }).total, 0)

  assert.throws(() => callLibraryTool('library.character.actions.add', { charId: character.charId, actions: [5] }, { root }), /actions/)
})
test('GLB metadata records named objects, bones, extras and world-space height', (t) => {
  const { root, temporary } = fixture(t), modelFile = join(temporary, 'model.glb')
  writeFileSync(modelFile, glb({ asset: { version: '2.0' }, nodes: [{ name: 'Body', mesh: 0, scale: [1, 2, 1] }, { name: 'Hips' }, { name: 'X_Head_Jaw' }], skins: [{ joints: [1, 2] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ min: [0, 0, 0], max: [1, 1, 1] }] }))
  const result = registerBaseModel({ root, name: 'GLB', rig: 'mixamo65+face', modelFile })
  assert.equal(result.metadata.heightMeters, 2); assert.deepEqual(result.metadata.objects, ['Body']); assert.deepEqual(result.metadata.extraBones, ['X_Head_Jaw'])
  assert.equal(result.warnings[0]!.object, 'Body')
})
test('unsafe object paths fail before creating partial records', (t) => {
  const options = fixture(t)
  writeFileSync(options.modelFile, 'arm_bone Root 0 0 0\no ../escape\nv 0 0 0')
  assert.throws(() => registerBaseModel({ ...options, name: 'bad', rig: 'verity' }), /unsafe/)
})
test('owned base models are unique per character even for identical files; foreign characters cannot adopt them', (t) => {
  const options = fixture(t), { root, modelFile, texturesDir } = options
  const a = createCharacterWithOwnBase({ root, charId: 'char-a', name: 'A', rig: 'verity', modelFile, texturesDir })
  const b = createCharacterWithOwnBase({ root, charId: 'char-b', name: 'B', rig: 'verity', modelFile, texturesDir })
  assert.notEqual(a.baseModelId, b.baseModelId)
  const resolvedA = resolveCharacter({ root, charId: 'char-a' })
  assert.equal(resolvedA.baseModel?.ownerCharId, 'char-a'); assert.equal(resolvedA.baseModel?.sha256, resolveCharacter({ root, charId: 'char-b' }).baseModel?.sha256)
  assert.ok(resolvedA.textures['verity.mdl/Body.smd']!.includes(a.baseModelId!), 'textures live in the own base')
  assert.throws(() => createCharacter({ root, charId: 'char-c', name: 'C', baseModelId: a.baseModelId! }), /belongs to character char-a/)
  assert.throws(() => createCharacterWithOwnBase({ root, charId: 'char-a', name: 'A', rig: 'verity', modelFile, texturesDir }), /already exists/)
  assert.equal(registerBaseModel({ root, name: 'A', rig: 'verity', modelFile, texturesDir, ownerCharId: 'char-a' }).created, false, 'same owner is idempotent')
  assert.equal(registerBaseModel({ root, name: 'shared', rig: 'verity', modelFile, texturesDir }).metadata.ownerCharId, undefined, 'no owner keeps content addressing')
})
