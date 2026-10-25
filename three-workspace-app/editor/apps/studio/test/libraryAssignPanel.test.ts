import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { addCharacterActions, createCharacter, rebuildLibraryIndex, registerBaseModel } from '../../../packages/library/index'
import { addLibraryCharacterToProject, placeLibraryActionForNode } from '../src/libraryCommands'
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

test('N1: library.place honors an explicit frameStart and place-for-node routes own/copied Actions', async () => {
  const libraryRoot = mkdtempSync(path.join(tmpdir(), 'w01-n1-library-'))
  process.env.W01_LIBRARY = libraryRoot
  process.env.BBS_UNIFIED_PROJECTS_DIR = mkdtempSync(path.join(tmpdir(), 'w01-n1-projects-'))
  const goXua = await makeLibraryCharacter(libraryRoot, 'go-xua', 'Gỗ Xưa', '2000000000000001')
  const den = await makeLibraryCharacter(libraryRoot, 'den', 'Đen', '2000000000000002')

  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'N1', scene: makeEmptyDraft('N1', 30, 600) } })
  const projectId = created.projectId!
  const added = await addLibraryCharacterToProject({ projectId, expectedRevision: created.revision, charId: 'go-xua' })
  let revision = added.revision
  const nodeId = added.nodeId!
  const characterId = added.characterId!
  assert.ok(nodeId && characterId)

  // Own Draft placed directly at an explicit frame (shot-start style placement).
  const own = await placeLibraryActionForNode({ projectId, actionUuid: goXua.draftUuid, nodeId, frameStart: 10 })
  assert.equal(own.converted, false)
  assert.equal(own.placedActionUuid, goXua.draftUuid)
  assert.equal(own.frameStart, 10)
  revision = own.revision

  // The same explicit window again must be rejected as overlapping, revision untouched.
  await assert.rejects(
    executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'library.place', args: { actionUuid: goXua.draftUuid, characterId, frameStart: 10 } }),
    /đã có clip khác|overlap/i)
  assert.equal((await readUnifiedProject(projectId)).revision, revision)

  // Another character's same-rig Draft is copied into the target's set, then placed (appended).
  const copied = await placeLibraryActionForNode({ projectId, actionUuid: den.draftUuid, nodeId })
  assert.equal(copied.converted, true)
  assert.notEqual(copied.placedActionUuid, den.draftUuid)
  assert.equal(copied.frameStart, own.frameEnd + 1, 'no frameStart appends after the last clip')
  revision = copied.revision

  const project = await readUnifiedProject(projectId)
  const clips = project.scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === nodeId)
  assert.equal(clips.length, 2)
  assert.equal(clips[0]!.frameStart, 10)
  assert.ok(project.motions[goXua.draftUuid], 'own Draft motion is in the project')
  assert.ok(project.motions[copied.placedActionUuid], 'copied Draft motion is in the project')
  assert.equal(project.revision, revision)

  // A node without a library link is refused with the Vietnamese guidance.
  const bare = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'N1 bare', scene: makeEmptyDraft('N1 bare', 30, 300) } })
  await assert.rejects(placeLibraryActionForNode({ projectId: bare.projectId!, actionUuid: goXua.draftUuid, nodeId: 'missing-node' }), /không còn trong project/)
})
