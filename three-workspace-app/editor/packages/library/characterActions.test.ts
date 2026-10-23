import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MIXAMO65_BONE_PARENTS } from '../retarget/src/mixamo65'
import {
  addDraftToCharacter, copyActionToCharacter, coverageMatrix, listCharacterActions, listLibraryCharacters,
  importPack, removeCharacterAction, saveCharacterActionVersion, searchLibrary, setCharacterActionStatus, setCharacterProfile,
} from './index'
import { callLibraryTool } from './mcp'
import { readJsonFile, writeIndex, writeJsonAtomic } from './store'
import type { CharacterMetadata, MotionPackMetadata } from './types'

const rawUuid = '10000000-0000-7000-8000-000000000001'
const extendedUuid = '10000000-0000-8000-8000-000000000002'

function editedGlb(duration: number, marker: string): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0', generator: marker }, accessors: [{ max: [duration] }],
    animations: [{ samplers: [{ input: 0 }], channels: [] }] }))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]), header = Buffer.alloc(20)
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, padded])
}

const sceneExtras = [
  { name: 'X_Head_Jaw', parent: 'Head', rawSourceName: 'Jaw', rest: { position: [0, 0.1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
  { name: 'X_Spine2_Wing_Bone', parent: 'Spine2', rawSourceName: 'Wing_Bone', rest: { position: [0.2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
]

function veritySceneGlb(): Buffer {
  const byName = new Map(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, index]))
  const nodes = MIXAMO65_BONE_PARENTS.map(([name]) => ({ name, children: [] as number[], translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }))
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) if (parent) nodes[byName.get(parent)!]!.children.push(byName.get(name)!)
  for (const extra of sceneExtras) {
    const index = nodes.length
    nodes.push({ name: extra.name, children: [], translation: extra.rest.position, rotation: extra.rest.rotation, scale: extra.rest.scale })
    nodes[byName.get(extra.parent)!]!.children.push(index)
  }
  const jawIndex = nodes.findIndex((node) => node.name === 'X_Head_Jaw')
  const gltf = { asset: { version: '2.0' }, nodes, skins: [{ joints: MIXAMO65_BONE_PARENTS.map((_, index) => index) }],
    accessors: [{ max: [1.5] }], animations: [{ samplers: [{ input: 0 }, { input: 0 }], channels: [
      { sampler: 0, target: { node: jawIndex, path: 'translation' } }, { sampler: 1, target: { node: jawIndex, path: 'rotation' } },
    ] }] }
  const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]), header = Buffer.alloc(20)
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, padded])
}

function normalizedVeritySource(parent: string, name: string, overrides: Record<string, unknown> = {}): string {
  const directory = join(parent, name); mkdirSync(directory)
  const glb = veritySceneGlb(), sha = createHash('sha256').update(glb).digest('hex')
  writeFileSync(join(directory, `${name}.glb`), glb); writeJsonAtomic(join(directory, `${name}.report.json`), { status: 'PASS' })
  writeJsonAtomic(join(directory, `${name}.manifest.json`), { version: '1.1.0', rig: 'mixamo65+verity', extraBoneMode: 'scene-nodes',
    extraBones: sceneExtras, glbSha256: sha, actions: [{ uuid: '20000000-0000-7000-8000-000000000001', name: 'Verity idle', durationSeconds: 1.5, fps: 30, glbAnimationIndex: 0 }],
    ...overrides })
  return directory
}

function fixture(t: { after(fn: () => void): void }) {
  const temporary = mkdtempSync(join(tmpdir(), 'character-action-library-')), root = join(temporary, 'library')
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  for (const folder of ['packs', 'rigs', 'characters', 'models']) mkdirSync(join(root, folder), { recursive: true })
  writeJsonAtomic(join(root, 'library.json'), { version: '1.0.0', rigs: ['mixamo65'] })
  const pack: MotionPackMetadata = {
    kind: 'motion-pack', libraryVersion: '1.1.0', packId: 'a'.repeat(16), glbSha256: 'a'.repeat(64), rig: 'mixamo65',
    createdBy: 'app1', createdAt: '2026-10-23T00:00:00.000Z', license: { id: 'test', commitable: true, source: 'fixture' },
    boundCharacter: null, source: { file: null, sha256: null }, actions: [{ uuid: rawUuid, name: 'Idle source',
      durationSeconds: 1, fps: 30, category: 'idle', tags: ['idle'], loop: true, inPlace: true, parentUuid: null,
      cover: null, glbAnimationIndex: 4 }],
  }
  mkdirSync(join(root, 'packs', pack.packId)); writeFileSync(join(root, 'packs', pack.packId, 'anim.glb'), 'raw immutable glb')
  writeJsonAtomic(join(root, 'packs', pack.packId, 'anim.manifest.json'), { version: '1.0.0', actions: [] })
  writeJsonAtomic(join(root, 'packs', pack.packId, 'meta.json'), pack)
  const character = (charId: string, rig: string): CharacterMetadata => ({
    kind: 'character', charId, libraryVersion: '1.1.0', name: charId, rig, createdAt: '2026-10-23T00:00:00.000Z',
    license: { id: 'test', commitable: false }, model: 'model.glb',
  })
  for (const record of [character('verity-a', 'verity'), character('verity-b', 'verity'), character('steve', 'minecraft20')]) {
    mkdirSync(join(root, 'characters', record.charId)); writeJsonAtomic(join(root, 'characters', record.charId, 'meta.json'), record)
  }
  writeIndex(root)
  return { root, temporary }
}

test('raw to draft to immutable edited versions preserves ancestry and latest selection', (t) => {
  const { root, temporary } = fixture(t)
  const draft = addDraftToCharacter({ root, charId: 'verity-a', actionUuid: rawUuid })
  assert.equal(draft.status, 'draft'); assert.equal(draft.version, 1); assert.equal(draft.variantOf, draft.uuid)
  assert.equal(draft.parentUuid, rawUuid); assert.equal(draft.glbAnimationIndex, 4)
  assert.deepEqual(readJsonFile<MotionPackMetadata>(join(root, 'packs', draft.packId, 'meta.json')).license,
    { id: 'test', commitable: true, source: 'fixture' })
  const editedFile = join(temporary, 'edited.glb'); writeFileSync(editedFile, 'not a glb')
  assert.throws(() => saveCharacterActionVersion({ root, charId: 'verity-a', baseUuid: draft.uuid, glbFile: editedFile, status: 'edited' }), /valid GLB/)
  writeFileSync(editedFile, editedGlb(2, 'edited version 2'))
  const v2 = saveCharacterActionVersion({ root, charId: 'verity-a', baseUuid: draft.uuid, glbFile: editedFile, status: 'edited', notes: 'first pass' })
  setCharacterActionStatus({ root, charId: 'verity-a', actionUuid: v2.uuid, status: 'approved' })
  writeFileSync(editedFile, editedGlb(3, 'edited version 3'))
  const v3 = saveCharacterActionVersion({ root, charId: 'verity-a', baseUuid: v2.uuid, glbFile: editedFile, status: 'edited', notes: 'second pass' })
  assert.deepEqual([v2.version, v3.version], [2, 3]); assert.equal(v3.variantOf, draft.uuid); assert.equal(v3.parentUuid, rawUuid)
  assert.deepEqual(readFileSync(join(root, 'packs', v2.packId, 'anim.glb')), editedGlb(2, 'edited version 2'))
  assert.equal(v2.durationSeconds, 2); assert.equal(v3.durationSeconds, 3)
  assert.deepEqual(listCharacterActions({ root, charId: 'verity-a' }).map((action) => action.version), [1, 2, 3])
  assert.deepEqual(listCharacterActions({ root, charId: 'verity-a', latestOnly: true }).map((action) => action.uuid), [v3.uuid])
  assert.deepEqual(listCharacterActions({ root, charId: 'verity-a', latestOnly: true, status: 'approved' }), [], 'status applies after latest chain selection')
  const approved = setCharacterActionStatus({ root, charId: 'verity-a', actionUuid: v3.uuid, status: 'approved' })
  assert.equal(approved.status, 'approved')
  const approvedSearch = searchLibrary({ root, ownerCharId: 'verity-a', status: 'approved' })
  assert.equal(approvedSearch.total, 2); assert.ok(approvedSearch.items.some((action) => action.uuid === v3.uuid))
  assert.throws(() => setCharacterActionStatus({ root, charId: 'verity-b', actionUuid: v3.uuid, status: 'draft' }), /does not belong/)
  assert.equal(readJsonFile<{ version: string }>(join(root, 'library.json')).version, '1.1.0', '1.0 config migrates in place')
})

test('copy enforces rig view, removal detaches only, and legacy profiles get twelve defaults', (t) => {
  const { root } = fixture(t)
  const draft = addDraftToCharacter({ root, charId: 'verity-a', actionUuid: rawUuid })
  const copy = copyActionToCharacter({ root, actionUuid: draft.uuid, toCharId: 'verity-b' })
  assert.equal(copy.parentUuid, draft.uuid); assert.equal(copy.ownerCharId, 'verity-b'); assert.equal(copy.status, 'draft')
  assert.throws(() => copyActionToCharacter({ root, actionUuid: draft.uuid, toCharId: 'steve' }), /Rig mismatch/)
  const extendedPack: MotionPackMetadata = {
    ...readJsonFile<MotionPackMetadata>(join(root, 'packs', 'a'.repeat(16), 'meta.json')),
    packId: 'b'.repeat(16), glbSha256: 'b'.repeat(64), rig: 'mixamo65+tail',
    actions: [{ ...readJsonFile<MotionPackMetadata>(join(root, 'packs', 'a'.repeat(16), 'meta.json')).actions[0]!, uuid: extendedUuid }],
  }
  mkdirSync(join(root, 'packs', extendedPack.packId)); writeFileSync(join(root, 'packs', extendedPack.packId, 'anim.glb'), 'extended glb')
  writeJsonAtomic(join(root, 'packs', extendedPack.packId, 'meta.json'), extendedPack)
  const wingCharacter: CharacterMetadata = { ...readJsonFile<CharacterMetadata>(join(root, 'characters', 'verity-b', 'meta.json')),
    charId: 'wing', name: 'wing', rig: 'mixamo65+wing' }
  mkdirSync(join(root, 'characters', wingCharacter.charId)); writeJsonAtomic(join(root, 'characters', wingCharacter.charId, 'meta.json'), wingCharacter)
  assert.throws(() => copyActionToCharacter({ root, actionUuid: extendedUuid, toCharId: wingCharacter.charId }), /Rig mismatch/)
  const packPath = join(root, 'packs', copy.packId, 'anim.glb')
  removeCharacterAction({ root, charId: 'verity-b', actionUuid: copy.uuid })
  assert.equal(existsSync(packPath), true); assert.deepEqual(listCharacterActions({ root, charId: 'verity-b' }), [])
  assert.equal(searchLibrary({ root, ownerCharId: 'verity-b' }).total, 1, 'detached immutable versions remain searchable')
  const legacy = listLibraryCharacters({ root }).find((character) => character.charId === 'verity-a')!
  assert.equal(legacy.requiredActions?.length, 12); assert.deepEqual(legacy.personality, { summary: '', traits: [] })
})

test('profiles and coverage use the newest tagged chain version; MCP exposes L1 operations', (t) => {
  const { root, temporary } = fixture(t)
  setCharacterProfile({ root, charId: 'verity-a', personality: { summary: 'Patient', traits: ['calm', 'calm'] },
    requiredActions: [{ key: 'idle', label: 'Stand calmly' }, { key: 'jump', label: 'Jump' }] })
  const draft = callLibraryTool('library.character.action.draft', { charId: 'verity-a', actionUuid: rawUuid }, { root }) as ReturnType<typeof addDraftToCharacter>
  const file = join(temporary, 'edited.glb'); writeFileSync(file, editedGlb(1.25, 'edited'))
  const edited = callLibraryTool('library.character.action.version.save', { charId: 'verity-a', baseUuid: draft.uuid, glbFile: file, status: 'edited' }, { root }) as ReturnType<typeof saveCharacterActionVersion>
  callLibraryTool('library.character.action.status.set', { charId: 'verity-a', actionUuid: edited.uuid, status: 'approved' }, { root })
  const matrix = coverageMatrix({ root, charIds: ['verity-a'] })
  assert.equal(matrix[0]!.cells[0]!.action?.uuid, edited.uuid); assert.equal(matrix[0]!.cells[0]!.status, 'approved')
  assert.equal(matrix[0]!.cells[1]!.action, null)
  assert.deepEqual(listLibraryCharacters({ root }).find((character) => character.charId === 'verity-a')!.personality,
    { summary: 'Patient', traits: ['calm'] })
  const mcp = callLibraryTool('library.character.actions.list', { charId: 'verity-a', latestOnly: true }, { root }) as unknown[]
  assert.equal(mcp.length, 1)
})

test('imports the explicit Verity scene-node contract and preserves it through draft, edit and copy', (t) => {
  const { root, temporary } = fixture(t), source = normalizedVeritySource(temporary, 'verity-scene')
  const imported = importPack({ root, sourceDirectory: source, tags: ['idle'] })
  assert.equal(imported.rig, 'mixamo65+verity')
  for (const charId of ['scene-a', 'scene-b']) {
    const character: CharacterMetadata = { kind: 'character', charId, libraryVersion: '1.1.0', name: charId, rig: 'verity',
      createdAt: '2026-10-23T00:00:00.000Z', license: { id: 'test', commitable: false }, model: 'model.glb' }
    mkdirSync(join(root, 'characters', charId)); writeJsonAtomic(join(root, 'characters', charId, 'meta.json'), character)
  }
  const raw = imported.metadata.actions[0]!, draft = addDraftToCharacter({ root, charId: 'scene-a', actionUuid: raw.uuid })
  const editedFile = join(temporary, 'verity-edited.glb'); writeFileSync(editedFile, editedGlb(1, 'missing scene nodes'))
  assert.throws(() => saveCharacterActionVersion({ root, charId: 'scene-a', baseUuid: draft.uuid, glbFile: editedFile, status: 'edited' }), /skinned rig/)
  writeFileSync(editedFile, veritySceneGlb())
  const edited = saveCharacterActionVersion({ root, charId: 'scene-a', baseUuid: draft.uuid, glbFile: editedFile, status: 'edited' })
  const copied = copyActionToCharacter({ root, actionUuid: edited.uuid, toCharId: 'scene-b' })
  for (const action of [draft, edited, copied]) {
    const manifest = readJsonFile<{ rig: string; extraBoneMode?: string; extraBones?: unknown[] }>(join(root, 'packs', action.packId, 'anim.manifest.json'))
    assert.equal(manifest.rig, 'mixamo65+verity'); assert.equal(manifest.extraBoneMode, 'scene-nodes')
    assert.deepEqual(manifest.extraBones, sceneExtras)
  }

  const legacy = normalizedVeritySource(temporary, 'verity-legacy', { extraBoneMode: undefined })
  assert.throws(() => importPack({ root, sourceDirectory: legacy }), /Extended Mixamo manifest and GLB joint counts/)
  const wrongMode = normalizedVeritySource(temporary, 'verity-wrong-mode', { extraBoneMode: 'skin-joints' })
  assert.throws(() => importPack({ root, sourceDirectory: wrongMode }), /scene-nodes is only supported/)
  const wrongRig = normalizedVeritySource(temporary, 'verity-wrong-rig', { rig: 'mixamo65+tail' })
  assert.throws(() => importPack({ root, sourceDirectory: wrongRig }), /scene-nodes is only supported/)
  const wrongDeclaration = normalizedVeritySource(temporary, 'verity-wrong-node', { extraBones: [{ ...sceneExtras[0], parent: 'Spine2' }, sceneExtras[1]] })
  assert.throws(() => importPack({ root, sourceDirectory: wrongDeclaration }), /metadata|does not match GLB/)
})
