import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { addCharacterActions, createCharacter, rebuildLibraryIndex, registerBaseModel } from '../../../packages/library/index'
import { addLibraryCharacterToProject, placeLibraryActionForNode } from "../src/libraryCommands"
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// N1 fixture: two Minecraft20 library characters, each owning one Draft.
async function makeLibraryCharacter(libraryRoot: string, charId: string, name: string, packId: string) {
  const armature = readFileSync(path.join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
  const modelSource = armature + '\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n'
    + 'an idle\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 0 LINEAR\n'
  const modelFile = path.join(libraryRoot, `${charId}-model.bobj`)
  mkdirSync(libraryRoot, { recursive: true })
  writeFileSync(modelFile, modelSource)
  const registered = registerBaseModel({ name, rig: 'minecraft20', modelFile })
  const character = createCharacter({ charId, name, baseModelId: registered.modelId })
  const { libraryNativeAction } = await import('../src/libraryModels')
  const draftUuid = randomUUID()
  const packDir = path.join(libraryRoot, 'packs', packId)
  mkdirSync(packDir, { recursive: true })
  // The pack GLB is produced by the native pipeline itself (model + animation-only sidecar),
  // like real library packs, so its animation carries a valid time accessor.
  const sidecar = path.join(packDir, 'anim.bobj')
  writeFileSync(sidecar, 'an Idle\nao body\nag location 0\nkf 0 0 LINEAR\nkf 10 0.5 LINEAR\nkf 20 1 LINEAR\n')
  const baseBytes = await libraryNativeAction(charId, sidecar)
  const glbSha256 = createHash('sha256').update(baseBytes).digest('hex')
  writeFileSync(path.join(packDir, 'anim.glb'), baseBytes)
  writeFileSync(path.join(packDir, 'meta.json'), JSON.stringify({
    kind: 'motion-pack', libraryVersion: '1.1.0', packId, rig: 'minecraft20', glbSha256, createdAt: new Date().toISOString(),
    license: { id: 'test', commitable: false },
    actions: [{ uuid: draftUuid, name: 'Idle', durationSeconds: 1, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, ownerCharId: charId, status: 'draft', version: 1 }],
  }))
  writeFileSync(path.join(packDir, 'anim.manifest.json'), JSON.stringify({
    version: '1.0.0', rig: 'minecraft20', glbSha256,
    actions: [{ uuid: draftUuid, name: 'Idle', durationSeconds: 1, fps: 30, glbAnimationIndex: 0 }],
  }))
  rebuildLibraryIndex()
  addCharacterActions({ charId, actions: [draftUuid] })
  return { character, draftUuid }
}

test('B7: place-for-node with replaceClipId swaps the clip in one revision and undo restores it', async () => {
  const libraryRoot = mkdtempSync(path.join(tmpdir(), 'w01-b7-library-'))
  const previousLibrary = process.env.W01_LIBRARY, previousProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.W01_LIBRARY = libraryRoot
  process.env.BBS_UNIFIED_PROJECTS_DIR = mkdtempSync(path.join(tmpdir(), 'w01-b7-projects-'))
  try {
    const goXua = await makeLibraryCharacter(libraryRoot, 'go-xua', 'Gỗ Xưa', '2000000000000001')
    const den = await makeLibraryCharacter(libraryRoot, 'den', 'Đen', '2000000000000002')
    const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'B7', scene: makeEmptyDraft('B7', 30, 600) } })
    const projectId = created.projectId!
    const added = await addLibraryCharacterToProject({ projectId, expectedRevision: created.revision, charId: 'go-xua' })
    const nodeId = added.nodeId!, characterId = added.characterId!
    const first = await placeLibraryActionForNode({ projectId, actionUuid: goXua.draftUuid, nodeId, frameStart: 10 })
    const second = await placeLibraryActionForNode({ projectId, actionUuid: goXua.draftUuid, nodeId, frameStart: 100 })

    const before = await readUnifiedProject(projectId)
    const beforeJson = JSON.stringify({ ...before, revision: 0 })
    const clipsBefore = before.scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === nodeId)
    assert.equal(clipsBefore.length, 2)

    // Same-length replacement starts at the old clip's frame and overlaps it, which must not count as a conflict.
    const replaced = await placeLibraryActionForNode({ projectId, actionUuid: den.draftUuid, nodeId, replaceClipId: first.clipId })
    assert.equal(replaced.frameStart, 10)
    assert.notEqual(replaced.clipId, first.clipId)
    assert.equal(replaced.revision, before.revision + 1, 'one revision for remove + place')
    const after = await readUnifiedProject(projectId)
    const clipsAfter = after.scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === nodeId)
    assert.equal(clipsAfter.length, 2)
    const oldSpan = clipsBefore.find((clip) => clip.id === first.clipId)!
    const newClip = clipsAfter.find((clip) => clip.id === replaced.clipId)!
    assert.deepEqual([newClip.frameStart, newClip.frameEnd], [oldSpan.frameStart, oldSpan.frameEnd], 'replacement keeps the old span')
    const neighbourBefore = clipsBefore.find((clip) => clip.id === second.clipId)!
    const neighbourAfter = clipsAfter.find((clip) => clip.id === second.clipId)!
    assert.deepEqual([neighbourAfter.frameStart, neighbourAfter.frameEnd], [neighbourBefore.frameStart, neighbourBefore.frameEnd], 'neighbour clip does not move')
    assert.ok(!clipsAfter.some((clip) => clip.id === first.clipId), 'old clip removed')
    assert.equal(after.bindings[first.clipId], undefined, 'old binding removed')
    assert.equal(after.bindings[replaced.clipId]?.motionId, den.draftUuid)
    assert.ok(clipsAfter.some((clip) => clip.id === second.clipId), 'other clips untouched')

    // Without a replace, the same occupied start is still refused.
    await assert.rejects(placeLibraryActionForNode({ projectId, actionUuid: den.draftUuid, nodeId, frameStart: 10 }), /đã có clip khác/)
    // A clip that is not on this node (or does not exist) cannot be replaced.
    await assert.rejects(placeLibraryActionForNode({ projectId, actionUuid: den.draftUuid, nodeId, replaceClipId: 'no-such-clip' }), /Clip cần thay/)
    await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: replaced.revision, command: 'library.place', args: { actionUuid: den.draftUuid, characterId, replaceClipId: 'no-such-clip' } }), /Clip cần thay/)

    await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: replaced.revision, command: 'history.undo', args: {} })
    const undone = await readUnifiedProject(projectId)
    assert.equal(JSON.stringify({ ...undone, revision: 0 }), beforeJson, 'undo restores the replaced clip and its binding')
  } finally {
    if (previousLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previousLibrary
    if (previousProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previousProjects
  }
})
