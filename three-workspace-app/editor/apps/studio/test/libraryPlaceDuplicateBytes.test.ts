import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { createCharacter, registerBaseModel, rebuildLibraryIndex } from '../../../packages/library/index'
import { libraryBaseGlb, libraryNativeAction } from '../src/libraryModels'
import { addLibraryCharacterToProject } from '../src/libraryCommands'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temporary = mkdtempSync(path.join(tmpdir(), 'studio-library-place-duplicate-'))
const previousProjects = process.env.BBS_UNIFIED_PROJECTS_DIR, previousLibrary = process.env.W01_LIBRARY
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temporary, 'projects')
process.env.W01_LIBRARY = path.join(temporary, 'library')
test.after(() => {
  rmSync(temporary, { recursive: true, force: true })
  if (previousProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previousProjects
  if (previousLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previousLibrary
})

// E1 regression: Hero and Den share one Minecraft20 rig and their "walk" Actions are
// byte-identical (same source converted per character). Each Action has its own UUID and
// ownerCharId, so both library.place calls must succeed and each character must end up
// with a clip bound to a Motion carrying its own Action UUID (the Motions share one asset).
test('library.place gives each same-rig character its own Motion for byte-identical Actions', { concurrency: false }, async () => {
  const armature = readFileSync(path.join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
  const modelSource = armature + '\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n'
    + 'an idle\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 0 LINEAR\n'
  const modelFile = path.join(temporary, 'e1-minecraft20.bobj')
  writeFileSync(modelFile, modelSource)
  const registered = registerBaseModel({ name: 'E1 Minecraft20', rig: 'minecraft20', modelFile })
  const hero = createCharacter({ charId: 'e1-hero', name: 'E1 Hero', baseModelId: registered.modelId })
  const den = createCharacter({ charId: 'e1-den', name: 'E1 Den', baseModelId: registered.modelId })

  const heroModel = await libraryBaseGlb(hero.charId), denModel = await libraryBaseGlb(den.charId)
  assert.ok(heroModel.equals(denModel), 'both characters resolve to the same base model bytes')
  const glbSha256 = createHash('sha256').update(heroModel).digest('hex')
  const walkSidecar = 'an walk\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 1 LINEAR\n'

  const packs = new Map<string, { packId: string; actionUuid: string }>()
  for (const [index, character] of [hero, den].entries()) {
    const packId = `100000000000000${index + 1}`, actionUuid = randomUUID(), directory = path.join(process.env.W01_LIBRARY!, 'packs', packId)
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'anim.bobj'), walkSidecar)
    writeFileSync(path.join(directory, 'anim.glb'), heroModel)
    writeFileSync(path.join(directory, 'meta.json'), JSON.stringify({
      kind: 'motion-pack', libraryVersion: '1.1.0', packId, rig: 'minecraft20', glbSha256, createdAt: new Date().toISOString(),
      license: { id: 'test', commitable: false },
      actions: [{ uuid: actionUuid, name: 'walk', durationSeconds: 1, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, ownerCharId: character.charId, status: 'draft', version: 1 }],
    }))
    writeFileSync(path.join(directory, 'anim.manifest.json'), JSON.stringify({
      version: '1.0.0', rig: 'minecraft20', glbSha256,
      actions: [{ uuid: actionUuid, name: 'walk', durationSeconds: 1, fps: 30, glbAnimationIndex: 0 }],
    }))
    packs.set(character.charId, { packId, actionUuid })
  }
  rebuildLibraryIndex()

  // Precondition of the bug: the composed native Action GLBs are byte-identical.
  const composed = new Map<string, string>()
  for (const character of [hero, den]) {
    const bytes = await libraryNativeAction(character.charId, path.join(process.env.W01_LIBRARY!, 'packs', packs.get(character.charId)!.packId, 'anim.bobj'))
    composed.set(character.charId, createHash('sha256').update(bytes).digest('hex'))
  }
  assert.equal(composed.get(hero.charId), composed.get(den.charId), 'native Action GLBs are byte-identical')

  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'E1 duplicate bytes', scene: makeEmptyDraft('E1 duplicate bytes', 30, 180) } })
  const heroPlaced = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: created.revision, charId: hero.charId })
  const denPlaced = await addLibraryCharacterToProject({ projectId: created.projectId, expectedRevision: heroPlaced.revision, charId: den.charId })

  const heroWalk = packs.get(hero.charId)!, denWalk = packs.get(den.charId)!
  const heroResult = await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: denPlaced.revision, command: 'library.place', args: { actionUuid: heroWalk.actionUuid, characterId: heroPlaced.characterId } })
  assert.equal(heroResult.result.libraryPlacement.actionUuid, heroWalk.actionUuid)
  const denResult = await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: heroResult.revision, command: 'library.place', args: { actionUuid: denWalk.actionUuid, characterId: denPlaced.characterId } })
  assert.equal(denResult.result.libraryPlacement.actionUuid, denWalk.actionUuid)
  assert.equal(denResult.result.libraryPlacement.motionId, denWalk.actionUuid)

  const project = await readUnifiedProject(created.projectId)
  const heroMotion = project.motions[heroWalk.actionUuid], denMotion = project.motions[denWalk.actionUuid]
  assert.ok(heroMotion, 'Hero keeps a Motion under its own Action UUID')
  assert.ok(denMotion, 'Den keeps a Motion under its own Action UUID instead of folding into Hero')
  assert.equal(heroMotion!.assetId, denMotion!.assetId, 'both Motions share the byte-identical asset')
  assert.equal(heroMotion!.skeletonId, denMotion!.skeletonId)

  const clips = project.scene.content.timeline.animation.motionClips
  assert.equal(clips.length, 2)
  for (const [placed, walk] of [[heroPlaced, heroWalk], [denPlaced, denWalk]] as const) {
    const character = project.characters[placed.characterId]!
    const clip = clips.find((item) => item.target.nodeId === character.nodeId)
    assert.ok(clip, 'each character has its own clip')
    assert.equal(project.bindings[clip!.id]?.characterId, placed.characterId)
    assert.equal(project.bindings[clip!.id]?.motionId, walk.actionUuid, 'each clip binds to the Motion of its own Action')
  }

  // Undoing the second placement removes only Den's Motion and clip.
  await executeUnifiedCommand({ requestId: randomUUID(), projectId: created.projectId, expectedRevision: denResult.revision, command: 'history.undo', args: {} })
  const afterUndo = await readUnifiedProject(created.projectId)
  assert.ok(afterUndo.motions[heroWalk.actionUuid])
  assert.equal(afterUndo.motions[denWalk.actionUuid], undefined)
  assert.equal(afterUndo.scene.content.timeline.animation.motionClips.length, 1)
})
