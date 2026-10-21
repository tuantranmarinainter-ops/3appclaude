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
import { safeFilmName } from '../src/sceneBbsFilm'

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
  return { projectId, characterIds, revision: applied.revision, scene }
}

test('safeFilmName folds Vietnamese scene names into BBS-safe ASCII', () => {
  assert.equal(safeFilmName('Cảnh đánh nhau 01'), 'Canh-danh-nhau-01')
  assert.equal(safeFilmName('...'), 'scene')
  assert.equal(safeFilmName('x'.repeat(80)).length, 64)
})

test('scene.export.bbsFilm defaults to every Character and the whole camera sequence, and rejects what Film cannot hold', async () => {
  const { projectId, characterIds, revision, scene } = await twoCharacterScene()
  const dry = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: {} })
  assert.equal(dry.result.valid, true)
  assert.equal(dry.result.archiveName, 'Canh-hai-nguoi.bbs-film.zip')
  assert.equal(dry.result.durationTicks, 20)
  const plan = dry.result.sceneExport as Record<string, unknown>
  assert.deepEqual(plan.characterIds, characterIds)
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
  const twoSequences = structuredClone(scene)
  twoSequences.content.editorial!.sequences.push({ id: 'seq-2', clips: [{ id: 'shot-3', cameraNodeId: 'camera_2', sourceFrameStart: 0, sourceFrameEnd: 29 }] })
  const project = await readUnifiedProject(projectId)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: twoSequences, fcurves: project.extensions.topview?.fcurves ?? null }] } })
  await reject({}, /2 camera sequences; pass sequenceId/)
  const picked = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilm', args: { sequenceId: 'seq-2', name: 'take-2' } })
  assert.deepEqual((picked.result.sceneExport as Record<string, unknown>).cameraNodeIds, ['camera_2'])
  assert.equal(picked.result.archiveName, 'take-2.bbs-film.zip')
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
