import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { characterHeightBlocks, createCharacter, registerBaseModel, setCharacterProfile } from '../../../packages/library/index'
import { libraryHeightSnapshot, scaleHeightCurvePayload } from '../src/libraryHeight'
import { packLibraryGlb } from '../src/libraryModels'
import { addLibraryCharacterToProject, updateLibraryCharacterHeights } from '../src/libraryCommands'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'

const metadata = { charId: 'synthetic', name: 'Synthetic', rig: 'minecraft20' }
test('explicit user height overrides rig/group defaults and rejects invalid values', () => {
  assert.equal(characterHeightBlocks(metadata), 1.8)
  assert.equal(characterHeightBlocks({ ...metadata, rig: 'verity' }), 3.6)
  assert.equal(characterHeightBlocks({ ...metadata, rig: 'mixamo65', name: 'Gỗ Xưa' }), 3.6)
  assert.equal(characterHeightBlocks({ ...metadata, heightBlocks: 2.4 }), 2.4)
  for (const heightBlocks of [0, -1, Infinity, NaN]) assert.throws(() => characterHeightBlocks({ ...metadata, heightBlocks }))
})

test('synthetic transformed GLB bounds map both targets exactly without changing source bytes', () => {
  const bytes = packLibraryGlb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ scale: [2, 2, 2], children: [1] }, { mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ min: [-1, -0.5, -1], max: [1, 0.5, 1] }], buffers: [{ byteLength: 0 }] }, Buffer.alloc(0))
  const before = Buffer.from(bytes)
  for (const rig of ['minecraft20', 'verity']) {
    const snapshot = libraryHeightSnapshot({ ...metadata, rig } as any, bytes)
    assert.equal(snapshot.librarySourceHeightMeters, 2)
    assert.equal(snapshot.libraryHeightScale * 2, rig === 'minecraft20' ? 1.8 : 3.6)
  }
  assert.deepEqual(bytes, before)
})

test('profile edits preserve existing scene until explicit undoable height update', { concurrency: false }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'library-height-'))
  const beforeLibrary = process.env.W01_LIBRARY, beforeProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.W01_LIBRARY = path.join(dir, 'library'); process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(dir, 'projects')
  try {
    const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
    const modelFile = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
    const base = registerBaseModel({ name: 'Synthetic MC20 size test', rig: 'minecraft20', modelFile })
    const character = createCharacter({ charId: 'height-test', name: 'Height test', baseModelId: base.modelId })
    const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Height', scene: makeEmptyDraft('Height', 30, 60) } })
    const added = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: character.charId })
    const original = await readUnifiedProject(created.projectId)
    const node = original.scene.content.nodes.find(n => n.id === added.nodeId)!
    const snapshot = libraryHeightSnapshot(character, readFileSync(modelFile))
    assert.equal(node.transform.scale.y * snapshot.librarySourceHeightMeters, 1.8)
    for (const heightBlocks of [0, -1, Infinity]) assert.throws(() => setCharacterProfile({ charId: character.charId, heightBlocks }))
    setCharacterProfile({ charId: character.charId, heightBlocks: 3.6 })
    assert.deepEqual(await readUnifiedProject(created.projectId), original)
    const updated = await updateLibraryCharacterHeights(created.projectId, original.revision)
    const current = await readUnifiedProject(created.projectId)
    const resized = current.scene.content.nodes.find(n => n.id === added.nodeId)!
    assert.equal(resized.transform.scale.y * snapshot.librarySourceHeightMeters, 3.6)
    assert.equal(resized.metadata?.libraryHeightBlocks, 3.6)
    await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: updated.revision, command: 'history.undo', args: {} })
    assert.deepEqual((await readUnifiedProject(created.projectId)).scene, original.scene)
  } finally {
    if (beforeLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = beforeLibrary
    if (beforeProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = beforeProjects
    rmSync(dir, { recursive: true, force: true })
  }
})


test('opt-in curve scaling preserves relative scale, Bezier handles, unrelated curves and original payload', () => {
  const payload = { version: 1, encoding: 'compact-v1', fcurves: [
    { t: ['node', 'actor'], p: 'transform.scale', k: [[0, 1, 'bezier', 'a', { x: -1, y: 0.8 }, { x: 1, y: 1.2 }], [10, 2, 'linear', 'b']] },
    { t: ['node', 'actor'], p: 'transform.position', k: [[0, 7, 'linear', 'p']] },
  ], userKeys: { actor: { scale: [{ frame: 5, value: [1, 2, 1], interpolation: 'linear' }], position: [{ frame: 5, value: [4, 5, 6] }] } } }
  const original = structuredClone(payload)
  const scaled = scaleHeightCurvePayload(payload, new Map([['actor', 2]])) as typeof payload
  assert.deepEqual(payload, original)
  assert.equal(scaled.fcurves[0]!.k[0]![1], 2)
  assert.deepEqual(scaled.fcurves[0]!.k[0]![4], { x: -1, y: 1.6 })
  assert.deepEqual(scaled.fcurves[0]!.k[0]![5], { x: 1, y: 2.4 })
  assert.deepEqual(scaled.fcurves[1], payload.fcurves[1])
  assert.deepEqual(scaled.userKeys.actor.scale[0]!.value, [2, 4, 2])
  assert.deepEqual(scaled.userKeys.actor.position, payload.userKeys.actor.position)
})
