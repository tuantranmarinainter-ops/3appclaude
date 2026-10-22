import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { getUnifiedJob, readUnifiedJobFile } from '../src/unifiedJobs'
import { resolveSceneBbsFilmArgs, safeFilmName } from '../src/sceneBbsFilm'
import { filmSourceBones, preflightProjectFilm, sampleProjectFilm } from '../src/unifiedFilmSampling'
import { appendFilmBackdropActors } from '../src/unifiedJobs'
import { buildFilmExportManifest, FILM_MODEL_FACING_OFFSET, type ConvertedFilmModelProfile } from '../src/filmManifest'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temp = mkdtempSync(path.join(tmpdir(), 'scene-bbs-film-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
test.after(() => rmSync(temp, { recursive: true, force: true }))
const builtin = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

/** Scene "Cảnh hai người": two builtin GLB Characters, camera_1 for frames 0-14 and camera_2 for 15-29. */
async function twoCharacterScene() {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Cảnh hai người', scene: makeEmptyDraft('Cảnh hai người', 30, 29, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } })
  const projectId = String(created.projectId)
  const staged = await stageAssetUpload('builtin.glb', new ReadableStream({ start(c) { c.enqueue(readFileSync(builtin)); c.close() } }))
  const model = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [staged.id], format: 'glb' } })
  const assetId = (model.result.assetIds as string[])[0], skeletonId = (model.result.skeletonIds as string[])[0]
  let revision = model.revision
  const characterIds: string[] = []
  for (const name of ['A', 'B']) {
    const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'character.add', args: { assetId, skeletonId, name } })
    characterIds.push(String(added.result.characterId)); revision = added.revision
  }
  const project = await readUnifiedProject(projectId)
  const scene = structuredClone(project.scene)
  const second = structuredClone(scene.content.nodes.find((node) => node.id === 'camera_1')!)
  second.id = 'camera_2'; second.name = 'Camera 2'; second.camera!.isPrimary = false; second.transform.position.x += 2
  scene.content.nodes.push(second)
  scene.content.editorial = { version: 1, activeSequenceId: 'seq', sequences: [{ id: 'seq', clips: [
    { id: 'shot-1', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 14 },
    { id: 'shot-2', cameraNodeId: 'camera_2', sourceFrameStart: 15, sourceFrameEnd: 29 },
  ] }] }
  const applied = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: scene, fcurves: project.extensions.topview?.fcurves ?? null }] } })
  const prop = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: applied.revision, command: 'prop.add', args: { assetId, name: 'Backdrop', transform: { position: { x: 2, y: 0, z: -3 }, rotation: { x: 0, y: 27, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } })
  const finalProject = await readUnifiedProject(projectId)
  return { projectId, assetId, characterIds, propId: String(prop.result.nodeId), revision: prop.revision, scene: finalProject.scene }
}

async function backdropOnlyScene() {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Backdrop only', scene: makeEmptyDraft('Backdrop only', 30, 29, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } })
  const projectId = String(created.projectId)
  const staged = await stageAssetUpload('builtin.glb', new ReadableStream({ start(c) { c.enqueue(readFileSync(builtin)); c.close() } }))
  const model = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [staged.id], format: 'glb' } })
  const assetId = (model.result.assetIds as string[])[0]!
  const prop = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: model.revision, command: 'prop.add', args: { assetId, name: 'Only backdrop', transform: { position: { x: 4, y: 1, z: 2 }, rotation: { x: 0, y: 35, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } })
  const project = await readUnifiedProject(projectId)
  const scene = structuredClone(project.scene)
  scene.content.editorial = { version: 1, activeSequenceId: 'seq', sequences: [{ id: 'seq', clips: [{ id: 'shot', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 29 }] }] }
  const applied = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: prop.revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: scene, fcurves: project.extensions.topview?.fcurves ?? null }] } })
  return { projectId, propId: String(prop.result.nodeId), revision: applied.revision }
}

test('safeFilmName folds Vietnamese scene names into BBS-safe ASCII', () => {
  assert.equal(safeFilmName('Cảnh đánh nhau 01'), 'Canh-danh-nhau-01')
  assert.equal(safeFilmName('...'), 'scene')
  assert.equal(safeFilmName('x'.repeat(80)).length, 64)
})

test('scene.export.bbsFilm defaults to every Character and the whole camera sequence, and rejects what Film cannot hold', async () => {
  const { projectId, characterIds, propId, revision, scene } = await twoCharacterScene()
  const dry = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: {} })
  assert.equal(dry.result.valid, true)
  assert.equal(dry.result.archiveName, 'Canh-hai-nguoi.bbs-film.zip')
  assert.equal(dry.result.durationTicks, 20)
  const plan = dry.result.sceneExport as Record<string, unknown>
  assert.deepEqual(plan.characterIds, characterIds)
  assert.equal(plan.content, 'characters')
  assert.deepEqual(plan.propIds, [])
  assert.deepEqual(plan.cameraNodeIds, ['camera_1', 'camera_2'])
  assert.deepEqual(plan.range, { startFrame: 0, endFrame: 29 })
  assert.deepEqual(plan.rootMotion, { actorPath: 'replay-transform', actionRoot: 'pose-track' })
  const reject = (args: Record<string, unknown>, pattern: RegExp) => assert.rejects(
    executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args }), pattern)
  await reject({ mode: 'playback' }, /editable/)
  await reject({ frameEnd: 28 }, /20 Hz grid/)
  await reject({ frameEnd: 26 }, /cover the selected source range exactly/)
  await reject({ characterIds: ['missing'] }, /Characters/)
  await reject({ name: '../x' }, /safe ASCII/)
  await reject({ cameras: [] }, /accepts only/)
  await reject({ content: 'other' }, /content must be/)
  await reject({ content: 'characters', propIds: [propId] }, /cannot include backdrops/)
  await reject({ content: 'backdrops', characterIds }, /cannot include Characters/)
  const twoSequences = structuredClone(scene)
  twoSequences.content.editorial!.sequences.push({ id: 'seq-2', clips: [{ id: 'shot-3', cameraNodeId: 'camera_2', sourceFrameStart: 0, sourceFrameEnd: 29 }] })
  const project = await readUnifiedProject(projectId)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: twoSequences, fcurves: project.extensions.topview?.fcurves ?? null }] } })
  await reject({}, /2 camera sequences; pass sequenceId/)
  const picked = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: { sequenceId: 'seq-2', name: 'take-2' } })
  assert.deepEqual((picked.result.sceneExport as Record<string, unknown>).cameraNodeIds, ['camera_2'])
  assert.equal(picked.result.archiveName, 'take-2.bbs-film.zip')
  const both = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: { content: 'both', sequenceId: 'seq' } })
  const bothPlan = both.result.sceneExport as Record<string, unknown>
  assert.equal(bothPlan.content, 'both')
  assert.deepEqual(bothPlan.characterIds, characterIds)
  assert.deepEqual(bothPlan.propIds, [propId])
  const bothSeries = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilmSeries', args: { content: 'both', sequenceId: 'seq', name: 'series-both' } })
  assert.equal(bothSeries.result.valid, true)
  assert.equal(bothSeries.result.content, 'both')
  assert.deepEqual(bothSeries.result.characterIds, characterIds)
  assert.deepEqual(bothSeries.result.propIds, [propId])
  const backdrops = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: { content: 'backdrops', sequenceId: 'seq' } })
  const backdropPlan = backdrops.result.sceneExport as Record<string, unknown>
  assert.equal(backdropPlan.content, 'backdrops')
  assert.deepEqual(backdropPlan.characterIds, [])
  assert.deepEqual(backdropPlan.propIds, [propId])
  const backdropSeries = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilmSeries', args: { content: 'backdrops', sequenceId: 'seq', name: 'series-backdrops' } })
  assert.equal(backdropSeries.result.valid, true)
  assert.equal(backdropSeries.result.content, 'backdrops')
  assert.deepEqual(backdropSeries.result.characterIds, [])
  assert.deepEqual(backdropSeries.result.propIds, [propId])
  const legacyProps = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: { sequenceId: 'seq', propIds: [propId] } })
  assert.equal((legacyProps.result.sceneExport as Record<string, unknown>).content, 'both')
  assert.deepEqual((legacyProps.result.sceneExport as Record<string, unknown>).propIds, [propId])
  const current = await readUnifiedProject(projectId)
  const badScale = structuredClone(current)
  badScale.scene.content.nodes.find((node) => node.id === propId)!.transform.scale.x = 2
  assert.throws(() => resolveSceneBbsFilmArgs(badScale, { content: 'backdrops', sequenceId: 'seq' }), /unit scale/)
  const tilted = structuredClone(current)
  tilted.scene.content.nodes.find((node) => node.id === propId)!.transform.rotation.x = 1
  assert.throws(() => resolveSceneBbsFilmArgs(tilted, { content: 'backdrops', sequenceId: 'seq' }), /vertical axis/)
})

test('backdrop-only Film exports sample cameras without Characters and budget imported backdrop bones', async () => {
  const { projectId, propId } = await backdropOnlyScene()
  const project = await readUnifiedProject(projectId)
  const args = { content: 'backdrops' as const, characterIds: [], propIds: [propId], sequenceId: 'seq', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 16 / 9 }
  const plan = preflightProjectFilm(project, args)
  const fingerprintMap = project.extensions.assetSkeletonFingerprints as Record<string, string[]>
  const prop = project.scene.content.nodes.find((node) => node.id === propId)!
  const assetId = prop.metadata!.assetId as string
  const profile = Object.values(project.skeletons).find((item) => item.fingerprint === fingerprintMap[assetId]![0])!
  const exportedBoneCount = filmSourceBones(profile.bones).length
  assert.equal(plan.content, 'backdrops')
  assert.deepEqual(plan.characterIds, [])
  assert.deepEqual(plan.propIds, [propId])
  assert.equal(plan.models.length, 0)
  assert.equal(plan.boneSampleCount, exportedBoneCount * 21)
  const sample = await sampleProjectFilm(project, args)
  assert.equal(sample.frames.length, 21)
  assert.ok(sample.frames.every((frame) => frame.skeletons.length === 0))
  const dry = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: { content: 'backdrops' } })
  assert.equal(dry.result.valid, true)
  assert.deepEqual((dry.result.sceneExport as Record<string, unknown>).characterIds, [])
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: { content: 'backdrops', propIds: [] } }), /requires at least one backdrop/)
})

test('film.export and film.preflight broker all content modes with normalized actor and prop selections', async () => {
  const { projectId, characterIds, propId } = await twoCharacterScene()
  const common = { sequenceId: 'seq', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 16 / 9 }
  const characters = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'film.export', args: {
    ...common, filmName: 'characters-only', content: 'characters', characterIds,
  } })
  assert.equal(characters.result.valid, true)
  assert.equal(characters.result.content, 'characters')
  assert.deepEqual(characters.result.characterIds, characterIds)
  assert.deepEqual(characters.result.propIds, [])

  const both = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'film.export', args: {
    ...common, filmName: 'characters-and-backdrops', content: 'both', characterIds,
  } })
  assert.equal(both.result.valid, true)
  assert.equal(both.result.content, 'both')
  assert.deepEqual(both.result.characterIds, characterIds)
  assert.deepEqual(both.result.propIds, [propId], 'both defaults to every prop when propIds is omitted')

  const { projectId: backdropProjectId, propId: onlyPropId } = await backdropOnlyScene()
  const preflight = await executeUnifiedCommand({ requestId: randomUUID(), projectId: backdropProjectId, dryRun: true, command: 'film.preflight', args: {
    ...common, content: 'backdrops', characterIds: [], propIds: [onlyPropId],
  } })
  assert.equal(preflight.result.valid, true, JSON.stringify(preflight.result.preflight))
  const backdrops = await executeUnifiedCommand({ requestId: randomUUID(), projectId: backdropProjectId, dryRun: true, command: 'film.export', args: {
    ...common, filmName: 'backdrops-only', content: 'backdrops', characterIds: [], propIds: [onlyPropId],
  } })
  assert.equal(backdrops.result.valid, true)
  assert.equal(backdrops.result.content, 'backdrops')
  assert.deepEqual(backdrops.result.characterIds, [])
  assert.deepEqual(backdrops.result.propIds, [onlyPropId])
})

function convertedProfile(sourceSha256: string, modelId: string, bones: Array<{ id: string; name: string; parentId: string | null }>): ConvertedFilmModelProfile {
  const names = new Map(bones.map((bone) => [bone.id, bone.name]))
  return { schemaVersion: 1, sourceSha256, modelId: `unified/${modelId}`, metersPerUnit: 1,
    bones: bones.map((bone) => ({ name: bone.name, parent: bone.parentId === null ? null : names.get(bone.parentId)!, bobjRestMatrixRowMajor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })),
    actions: [], textureRequired: false, files: [{ sourcePath: '/tmp/model.bobj', targetPath: 'model.bobj', sha256: 'a'.repeat(64) }] }
}

test('all three content modes produce the expected Film manifest actors, static backdrop yaw and samples', async () => {
  const withActors = await twoCharacterScene()
  const project = await readUnifiedProject(withActors.projectId)
  const characterArgs = { content: 'characters' as const, characterIds: withActors.characterIds, propIds: [], sequenceId: 'seq', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 16 / 9 }
  const characterInput = await sampleProjectFilm(project, characterArgs)
  const characterModel = characterInput.models[0]!
  const characterProfile = convertedProfile(characterModel.source.sha256, 'character-model', characterModel.sourceBones)
  const charactersManifest = buildFilmExportManifest(characterInput, new Map([[characterModel.assetId, characterProfile]]), 'characters')
  assert.equal(charactersManifest.actors.length, withActors.characterIds.length)
  assert.equal(charactersManifest.models.length, 1)
  assert.equal(charactersManifest.cameras.length, 2)

  const bothArgs = { ...characterArgs, content: 'both' as const, propIds: [withActors.propId] }
  const bothInput = await sampleProjectFilm(project, bothArgs)
  const bothManifest = buildFilmExportManifest(bothInput, new Map([[characterModel.assetId, characterProfile]]), 'both')
  const prop = project.scene.content.nodes.find((node) => node.id === withActors.propId)!
  const propAssetId = prop.metadata!.assetId as string
  const backdropProfile = characterProfile
  appendFilmBackdropActors(bothManifest, project, [withActors.propId], new Map([[propAssetId, backdropProfile]]), bothInput.durationTicks)
  assert.equal(bothManifest.actors.length, withActors.characterIds.length + 1)
  assert.equal(bothManifest.models.length, 1, 'the same source model should be represented once even when used as both Character and backdrop')
  const backdropActor = bothManifest.actors.find((actor) => actor.characterId === `prop:${withActors.propId}`)!
  assert.deepEqual(backdropActor.transformSamples, [
    { tick: 0, x: prop.transform.position.x, y: prop.transform.position.y, z: prop.transform.position.z, pitch: 0, yaw: FILM_MODEL_FACING_OFFSET - prop.transform.rotation.y },
    { tick: bothInput.durationTicks, x: prop.transform.position.x, y: prop.transform.position.y, z: prop.transform.position.z, pitch: 0, yaw: FILM_MODEL_FACING_OFFSET - prop.transform.rotation.y },
  ])
  assert.deepEqual(backdropActor.poseTracks, [])

  const only = await backdropOnlyScene()
  const onlyProject = await readUnifiedProject(only.projectId)
  const backdropArgs = { content: 'backdrops' as const, characterIds: [], propIds: [only.propId], sequenceId: 'seq', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 16 / 9 }
  const backdropInput = await sampleProjectFilm(onlyProject, backdropArgs)
  assert.equal(backdropInput.models.length, 0)
  const backdropManifest = buildFilmExportManifest(backdropInput, new Map(), 'backdrops')
  const onlyNode = onlyProject.scene.content.nodes.find((node) => node.id === only.propId)!
  const onlyAssetId = onlyNode.metadata!.assetId as string
  const onlyFingerprint = (onlyProject.extensions.assetSkeletonFingerprints as Record<string, string[]>)[onlyAssetId]![0]
  const onlySourceBones = filmSourceBones(Object.values(onlyProject.skeletons).find((item) => item.fingerprint === onlyFingerprint)!.bones)
  const onlyProfile = convertedProfile(onlyProject.assets[onlyAssetId as keyof typeof onlyProject.assets]!.source.sha256, 'only-backdrop-model', onlySourceBones)
  appendFilmBackdropActors(backdropManifest, onlyProject, [only.propId], new Map([[onlyAssetId, onlyProfile]]), backdropInput.durationTicks)
  assert.equal(backdropManifest.actors.length, 1)
  assert.equal(backdropManifest.models.length, 1)
  assert.ok(backdropManifest.models[0]!.bones.length > 0)
  assert.equal(backdropManifest.models[0]!.bones.length, onlySourceBones.length)
  assert.equal(backdropManifest.cameras.length, 1)
  assert.equal(backdropManifest.actors[0]!.characterId, `prop:${only.propId}`)
  assert.equal(backdropManifest.actors[0]!.transformSamples[0]!.yaw, FILM_MODEL_FACING_OFFSET - onlyNode.transform.rotation.y)
  assert.deepEqual(backdropManifest.actors[0]!.poseTracks, [])
})

test('film exports use the saved frame aspect unless an explicit numeric override is supplied', async () => {
  const { projectId, revision } = await twoCharacterScene()
  const saved = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'film.frame.set', args: { aspect: '1:1' } })
  const bbsDefault = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: {} })
  assert.equal((bbsDefault.result.sceneExport as Record<string, unknown>).viewportAspect, 1)
  const bbsOverride = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: { viewportAspect: 9 / 16 } })
  assert.equal((bbsOverride.result.sceneExport as Record<string, unknown>).viewportAspect, 9 / 16)

  const common = { sequenceId: 'seq', range: { startFrame: 0, endFrame: 29 }, filmName: 'frame-check' }
  const project = await readUnifiedProject(projectId)
  const characterIds = Object.keys(project.characters)
  const filmDefault = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'film.export', args: { ...common, characterIds } })
  assert.equal(filmDefault.result.viewportAspect, 1)
  const filmOverride = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'film.export', args: { ...common, characterIds, viewportAspect: 9 / 16 } })
  assert.equal(filmOverride.result.viewportAspect, 9 / 16)
  assert.equal(saved.revision, revision + 1)
})

const toolsReady = [process.env.BBS_JAVA_HOME, process.env.BBS_BLENDER_EXE].every((item) => item && existsSync(item))
test('scene.export.bbsFilm writes <scene>.bbs-film.zip with both actors, both cameras and scene-export.json', { timeout: 900_000,
  skip: toolsReady ? false : 'Set BBS_JAVA_HOME (JDK 17) and BBS_BLENDER_EXE (Blender 4.2+) to run the native Film export' }, async () => {
  const { projectId, characterIds, revision } = await twoCharacterScene()
  const started = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.export.bbsFilm', args: {} })
  const jobId = String(started.result.jobId)
  let job = await getUnifiedJob(jobId, projectId)
  while (job.state === 'queued' || job.state === 'running') { await new Promise((resolve) => setTimeout(resolve, 1000)); job = await getUnifiedJob(jobId, projectId) }
  assert.equal(job.state, 'succeeded', JSON.stringify(job.error))
  const archive = job.result!.files.find((file) => file.name === 'Canh-hai-nguoi.bbs-film.zip')
  assert.ok(archive, JSON.stringify(job.result!.files))
  const zipPath = path.join(temp, archive.name)
  writeFileSync(zipPath, (await readUnifiedJobFile(jobId, projectId, archive.id))!.bytes)
  const listed = spawnSync(process.env.BBS_PYTHON || 'python', ['-I', '-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"names": sorted(z.namelist()), "manifest": json.loads(z.read("export-manifest.json")), "report": json.loads(z.read("export-report.json")), "scene": json.loads(z.read("scene-export.json"))}))', zipPath], { encoding: 'utf8' })
  assert.equal(listed.status, 0, listed.stderr)
  const { names, manifest, report, scene } = JSON.parse(listed.stdout)
  assert.ok(names.includes('films/Canh-hai-nguoi.dat'), names.join(', '))
  assert.ok(names.some((name: string) => /^assets\/models\/unified\/[^/]+\/model\.bobj$/.test(name)), names.join(', '))
  assert.equal(report.nativeReadback, true)
  assert.deepEqual(manifest.actors.map((actor: { characterId: string }) => actor.characterId), characterIds)
  assert.equal(manifest.cameras.length, 2)
  assert.deepEqual(scene.cameraNodeIds, ['camera_1', 'camera_2'])
  console.log('scene.export.bbsFilm', JSON.stringify({ archiveBytes: archive.sizeBytes, names, actors: report.actors, cameras: report.cameras, poseTracks: report.poseTracks }))
})
