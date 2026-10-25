import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { addCharacterActions, createCharacter, registerBaseModel, rebuildLibraryIndex } from '../../../packages/library/index'
import { libraryBaseGlb, libraryShotDisplayName } from '../src/libraryModels'
import { addLibraryCharacterToProject, linkStoryboardNodesToLibrary, LibraryCharacterAlreadyInSceneError } from '../src/libraryCommands'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temporary = mkdtempSync(path.join(tmpdir(), 'studio-library-link-'))
const previousProjects = process.env.BBS_UNIFIED_PROJECTS_DIR, previousLibrary = process.env.W01_LIBRARY
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temporary, 'projects')
process.env.W01_LIBRARY = path.join(temporary, 'library')
test.after(() => {
  rmSync(temporary, { recursive: true, force: true })
  if (previousProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = previousProjects
  if (previousLibrary === undefined) delete process.env.W01_LIBRARY; else process.env.W01_LIBRARY = previousLibrary
})

const builtinCharacter = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

function normalizedActions(): { glb: string; manifest: string; names: string[] } {
  const source = path.join(editor, 'apps/studio/public/retarget/v9.12'), out = path.join(temporary, 'actions')
  const run = spawnSync(process.execPath, ['--import', 'tsx', '../retarget/cli/normalize.ts', '--src', path.join(source, 'minecraft-actions.bobj'), '--armature',
    path.join(source, 'minecraft20-armature.bobj'), '--target', builtinCharacter, '--out', out, '--action', '0,1'], { cwd: path.join(editor, 'packages/builder'), encoding: 'utf8', timeout: 180000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const files = readdirSync(out)
  const glb = path.join(out, files.find((name) => name.endsWith('.glb'))!)
  const manifest = path.join(out, files.find((name) => name.endsWith('.manifest.json'))!)
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { actions: Array<{ name: string }> }
  return { glb, manifest, names: parsed.actions.map((action) => action.name) }
}

test('libraryShotDisplayName derives the Shot label from storyboard node names', () => {
  assert.equal(libraryShotDisplayName('Gỗ Xưa', 'go 01_1'), 'Gỗ Xưa · Shot 01')
  assert.equal(libraryShotDisplayName('Gỗ Xưa', 'go 04'), 'Gỗ Xưa · Shot 04')
  assert.equal(libraryShotDisplayName('Hero', 'hero 12_2'), 'Hero · Shot 12')
  assert.equal(libraryShotDisplayName('Hero', 'hero'), 'Hero')
})

// C25 fixture in the shape of Tập 15: storyboard nodes named `go 01_1` / `go 04_1` stand on a
// temporary Mixamo65 model with Mixamo65 clips; the library character uses a different
// (Minecraft20) skeleton and owns a same-name Draft for the first clip only.
test('library.link rebinds storyboard nodes, replaces same-name clips, reports the rest and undoes in one step', { concurrency: false, timeout: 300000 }, async () => {
  const actions = normalizedActions()
  assert.equal(actions.names.length, 2)

  // Library character on the Minecraft20 skeleton with one Draft named like the first clip.
  const armature = readFileSync(path.join(editor, 'apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8')
  const modelSource = armature + '\no Body\no_arm minecraft20\nv 0 0 0\nvw body 1\nv 0 2 0\nvw head 1\nv 1 0 0\nvw body 1\nf 1 2 3\n'
    + 'an idle\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 0 LINEAR\n'
  const modelFile = path.join(temporary, 'link-minecraft20.bobj')
  writeFileSync(modelFile, modelSource)
  const registered = registerBaseModel({ name: 'C25 Minecraft20', rig: 'minecraft20', modelFile })
  const libraryCharacter = createCharacter({ charId: 'go-xua', name: 'Gỗ Xưa', baseModelId: registered.modelId })
  const baseBytes = await libraryBaseGlb(libraryCharacter.charId)
  const glbSha256 = createHash('sha256').update(baseBytes).digest('hex')
  const draftUuid = randomUUID(), packId = '2000000000000001'
  const writeDraftPack = (draftName: string) => {
    const packDir = path.join(process.env.W01_LIBRARY!, 'packs', packId)
    mkdirSync(packDir, { recursive: true })
    writeFileSync(path.join(packDir, 'anim.bobj'), `an ${draftName}\nao body\nag location 0\nkf 0 0 LINEAR\nkf 20 1 LINEAR\n`)
    writeFileSync(path.join(packDir, 'anim.glb'), baseBytes)
    writeFileSync(path.join(packDir, 'meta.json'), JSON.stringify({
      kind: 'motion-pack', libraryVersion: '1.1.0', packId, rig: 'minecraft20', glbSha256, createdAt: new Date().toISOString(),
      license: { id: 'test', commitable: false },
      actions: [{ uuid: draftUuid, name: draftName, durationSeconds: 1, fps: 30, category: 'idle', tags: [], loop: false, inPlace: true, glbAnimationIndex: 0, ownerCharId: libraryCharacter.charId, status: 'draft', version: 1 }],
    }))
    writeFileSync(path.join(packDir, 'anim.manifest.json'), JSON.stringify({
      version: '1.0.0', rig: 'minecraft20', glbSha256,
      actions: [{ uuid: draftUuid, name: draftName, durationSeconds: 1, fps: 30, glbAnimationIndex: 0 }],
    }))
    rebuildLibraryIndex()
    addCharacterActions({ charId: libraryCharacter.charId, actions: [draftUuid] })
  }

  // Project with two storyboard nodes on the temporary Mixamo65 model.
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'C25 Tập 15 fixture', scene: makeEmptyDraft('C25 Tập 15 fixture', 30, 300) } })
  const projectId = created.projectId!
  let revision = created.revision
  const run = async (command: string, args: Record<string, unknown>) => {
    const response = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command, args })
    revision = response.revision
    return response.result as Record<string, any>
  }
  const stage = async (file: string) => (await stageAssetUpload(path.basename(file), new ReadableStream<Uint8Array>({ async start(controller) { controller.enqueue(await readFile(file)); controller.close() } }))).id
  const modelImport = await run('asset.import', { files: [await stage(builtinCharacter)], format: 'glb' })
  const motionImport = await run('asset.import', { files: [await stage(actions.glb)], format: 'glb', manifest: JSON.parse(readFileSync(actions.manifest, 'utf8')) })
  const [motionA, motionB] = motionImport.motionIds as string[]
  // character.add applies Topview's unique-name suffix, so the nodes land as `go 01_1` / `go 04_1` like Tập 15.
  const node1 = await run('character.add', { assetId: modelImport.assetIds[0], skeletonId: modelImport.skeletonIds[0], name: 'go 01', transform: { position: { x: 1, y: 0, z: 2 }, rotation: { x: 0, y: 45, z: 0 }, scale: { x: 1, y: 1, z: 1 } } })
  const node2 = await run('character.add', { assetId: modelImport.assetIds[0], skeletonId: modelImport.skeletonIds[0], name: 'go 04', transform: { position: { x: -3, y: 0, z: 5 }, rotation: { x: 0, y: -90, z: 0 }, scale: { x: 1, y: 1, z: 1 } } })
  const withMotions = await readUnifiedProject(projectId)
  const durationA = withMotions.motions[motionA]!.durationSeconds, durationB = withMotions.motions[motionB]!.durationSeconds
  await run('motion.place', { characterId: node1.characterId, motionId: motionA, frameStart: 0, sourceStartSeconds: 0, sourceLengthSeconds: durationA, speed: 1, loop: false, reverse: false })
  await run('motion.place', { characterId: node1.characterId, motionId: motionB, frameStart: 90, sourceStartSeconds: 0, sourceLengthSeconds: durationB, speed: 1, loop: false, reverse: false })
  await run('motion.place', { characterId: node2.characterId, motionId: motionA, frameStart: 180, sourceStartSeconds: 0, sourceLengthSeconds: durationA, speed: 1, loop: false, reverse: false })

  // The Draft in the character's set is named exactly like node 1's first clip (read back from
  // project metadata, independent of manifest ordering); the second clip has no same-name Draft.
  const placedProject = await readUnifiedProject(projectId)
  const clipNameA = (placedProject.extensions.retargetMotionMetadata?.[motionA] as { name?: string } | undefined)?.name
  const clipNameB = (placedProject.extensions.retargetMotionMetadata?.[motionB] as { name?: string } | undefined)?.name
  assert.ok(clipNameA && clipNameB && clipNameA !== clipNameB, `fixture clip names: ${clipNameA} / ${clipNameB}`)
  writeDraftPack(clipNameA)

  const before = await readUnifiedProject(projectId)
  const beforeJson = JSON.stringify({ ...before, revision: 0 })
  const node1Before = before.scene.content.nodes.find((node) => node.id === node1.nodeId)!
  const clipsBefore = before.scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === node1.nodeId)
  assert.equal(clipsBefore.length, 2)

  const linked = await linkStoryboardNodesToLibrary({ projectId, expectedRevision: revision, charId: libraryCharacter.charId, nodeIds: [node1.nodeId, node2.nodeId] })
  revision = linked.revision
  const linkedNodes = linked.linkedNodes as Array<{ nodeId: string; characterId: string; displayName: string; replacedClips: Array<{ actionUuid: string; frameStart: number; frameEnd: number }>; unconvertedClips: Array<{ name: string; reason: string }> }>
  assert.equal(linkedNodes.length, 2)
  assert.deepEqual(linkedNodes.map((node) => node.displayName), ['Gỗ Xưa · Shot 01', 'Gỗ Xưa · Shot 04'])
  const linkedNode1 = linkedNodes.find((node) => node.nodeId === node1.nodeId)!
  assert.equal(linkedNode1.replacedClips.length, 1)
  assert.equal(linkedNode1.replacedClips[0]!.actionUuid, draftUuid)
  assert.equal(linkedNode1.replacedClips[0]!.frameStart, 0)
  assert.equal(linkedNode1.unconvertedClips.length, 1)
  assert.equal(linkedNode1.unconvertedClips[0]!.name, clipNameB)
  assert.match(linkedNode1.unconvertedClips[0]!.reason, /chưa có Nháp cùng tên/)

  const after = await readUnifiedProject(projectId)
  const node1After = after.scene.content.nodes.find((node) => node.id === node1.nodeId)!
  assert.equal(node1After.name, 'Gỗ Xưa · Shot 01')
  assert.equal(node1After.metadata?.libraryCharacterId, 'go-xua')
  assert.equal(node1After.metadata?.storyboardName, 'go 01_1')
  assert.deepEqual(node1After.transform, node1Before.transform, 'node transform (position/rotation/scale) is preserved')
  const character1 = after.characters[linkedNode1.characterId]!
  assert.equal(character1.name, 'Gỗ Xưa · Shot 01')
  // The imported library base model keeps its preserved native rig (not the temporary Mixamo65).
  assert.equal(after.skeletons[character1.skeletonId]!.family, 'custom-preserved')
  assert.notEqual(after.skeletons[character1.skeletonId]!.family, 'mixamo65')
  assert.ok(after.motions[draftUuid], 'the same-name Draft became a project Motion')
  const clipsAfter = after.scene.content.timeline.animation.motionClips.filter((clip) => clip.target.nodeId === node1.nodeId)
  assert.equal(clipsAfter.length, 2)
  const replacedClip = clipsAfter.find((clip) => clip.motion.assetId === draftUuid)!
  assert.ok(replacedClip, 'node 1 has a clip bound to the Draft Motion')
  assert.equal(replacedClip.frameStart, 0)
  assert.equal(after.bindings[replacedClip.id]?.characterId, linkedNode1.characterId)
  assert.equal(after.bindings[replacedClip.id]?.motionId, draftUuid)
  const keptClip = clipsAfter.find((clip) => clip.motion.assetId === motionB)!
  assert.ok(keptClip, 'the unmatched clip is kept and reported, not dropped')

  // The linked node evaluates on the CPU without SKELETON_EVALUATION_UNAVAILABLE for its Character.
  const evaluated = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0 } })
  const issues = evaluated.result.issues as Array<{ code: string; path: string }>
  assert.ok(!issues.some((issue) => issue.code === 'SKELETON_EVALUATION_UNAVAILABLE' && issue.path === `characters.${linkedNode1.characterId}`), JSON.stringify(issues))
  const samples = evaluated.result.skeletonSamples as Array<{ nodeId: string }>
  assert.ok(samples.some((sample) => sample.nodeId === node1.nodeId), 'linked node produces skeleton samples')

  // One undo restores the exact pre-link project JSON (modulo the revision counter).
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'history.undo', args: {} })
  const undone = await readUnifiedProject(projectId)
  assert.equal(JSON.stringify({ ...undone, revision: 0 }), beforeJson, 'undo restores the pre-link project')

  // "Thêm vào cảnh App 2" must ask when the role already has nodes instead of duplicating.
  const relinked = await linkStoryboardNodesToLibrary({ projectId, expectedRevision: undone.revision, charId: libraryCharacter.charId, nodeIds: [node1.nodeId] })
  await assert.rejects(addLibraryCharacterToProject({ projectId, expectedRevision: relinked.revision, charId: libraryCharacter.charId }),
    (error: unknown) => error instanceof LibraryCharacterAlreadyInSceneError && error.existingNodeIds.includes(node1.nodeId))
  const reused = await addLibraryCharacterToProject({ projectId, expectedRevision: relinked.revision, charId: libraryCharacter.charId, existingNodePolicy: 'reuse' }) as unknown as { reused?: boolean; nodeIds?: string[] }
  assert.equal(reused.reused, true)
  assert.deepEqual(reused.nodeIds, [node1.nodeId])
})
