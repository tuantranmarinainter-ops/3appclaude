import assert from 'node:assert/strict'
import test from 'node:test'
import { selectExportShots, planExportCameraRepair } from '../src/exportShotSelection.ts'

const shot = (id: string, start: number, end: number) => ({ id, cameraNodeId: `camera-${id}`, sourceFrameStart: start, sourceFrameEnd: end })
const shots = [shot('Shot01', 0, 149), shot('Shot02', 150, 224), shot('Shot03', 225, 299), shot('Shot04', 300, 374)]

test('Shot01 export ignores >3 cameras elsewhere and does not mutate authored shots', () => {
  const original = structuredClone(shots)
  const selection = selectExportShots(shots, { startFrame: 0, endFrame: 149 }, 30)
  assert.deepEqual(selection, { clips: [shots[0]], issues: [] })
  assert.deepEqual(shots, original)
  selection.clips[0]!.sourceFrameEnd = 2
  assert.deepEqual(shots, original)
})
test('Shot02 and a partial interval clip only intersecting shots', () => {
  assert.deepEqual(selectExportShots(shots, { startFrame: 150, endFrame: 224 }, 30), { clips: [shots[1]], issues: [] })
  assert.deepEqual(selectExportShots(shots, { startFrame: 120, endFrame: 179 }, 30), {
    clips: [shot('Shot01', 120, 149), shot('Shot02', 150, 179)], issues: [],
  })
})
test('inclusive endpoints, gaps, overlap, missing coverage and camera limit are validated', () => {
  assert.ok(selectExportShots(shots, { startFrame: 0, endFrame: 374 }, 30).issues.includes('CAMERA_LIMIT'))
  assert.ok(selectExportShots([shot('a', 0, 29), shot('b', 33, 59)], { startFrame: 0, endFrame: 59 }, 30).issues.includes('SEQUENCE_GAP'))
  assert.ok(selectExportShots([shot('a', 0, 32), shot('b', 30, 59)], { startFrame: 0, endFrame: 59 }, 30).issues.includes('SEQUENCE_GAP'))
  assert.ok(selectExportShots([shot('a', 3, 26)], { startFrame: 0, endFrame: 29 }, 30).issues.includes('SEQUENCE_COVERAGE'))
  assert.ok(selectExportShots(shots, { startFrame: 400, endFrame: 429 }, 30).issues.includes('SEQUENCE_COVERAGE'))
})
test('cuts use 20Hz grid relative to export start, including final endpoint', () => {
  assert.deepEqual(selectExportShots([shot('a', 1, 30), shot('b', 31, 60)], { startFrame: 1, endFrame: 60 }, 30).issues, [])
  assert.ok(selectExportShots([shot('a', 0, 30), shot('b', 31, 59)], { startFrame: 0, endFrame: 59 }, 30).issues.includes('CAMERA_CUT_GRID'))
  assert.ok(selectExportShots(shots, { startFrame: 0, endFrame: 148 }, 30).issues.includes('CAMERA_CUT_GRID'))
  assert.deepEqual(selectExportShots(shots, { startFrame: NaN, endFrame: 29 }, 30).issues, ['RANGE_INVALID'])
})

test('backend inspection and camera sampling use the same detached selection', async () => {
  const { makeEmptyDraft } = await import('@topview/3d-builder')
  const { inspectProjectFilm, sampleProjectFilm } = await import('../src/unifiedFilmSampling.ts')
  const { executeUnifiedCommand, readUnifiedProject } = await import('../src/unifiedProjectStore.ts')
  const { stageAssetUpload } = await import('../src/unifiedAssetFiles.ts')
  const { randomUUID } = await import('node:crypto')
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { fileURLToPath } = await import('node:url')
  const path = await import('node:path')
  const temp = await mkdtemp(path.join(tmpdir(), 'a12-export-shots-'))
  const previousProjectsDir = process.env.BBS_UNIFIED_PROJECTS_DIR
  process.env.BBS_UNIFIED_PROJECTS_DIR = temp
  try {
    const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'A12', scene: makeEmptyDraft('A12', 30, 374, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }) } })
    const projectId = String(created.projectId)
    const bytes = await readFile(fileURLToPath(new URL('../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb', import.meta.url)))
    const upload = await stageAssetUpload('actor.glb', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
    const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'glb' } })
    const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: imported.revision, command: 'character.add', args: { assetId: (imported.result.assetIds as string[])[0], skeletonId: (imported.result.skeletonIds as string[])[0], name: 'Actor' } })
    const project = await readUnifiedProject(projectId)
    project.scene.content.editorial = { version: 1, activeSequenceId: 'seq', sequences: [{ id: 'seq', clips: shots.map((clip, index) => {
      if (index) {
        const camera = structuredClone(project.scene.content.nodes.find((node) => node.id === 'camera_1')!)
        camera.id = clip.cameraNodeId; camera.camera!.isPrimary = false
        project.scene.content.nodes.push(camera)
      }
      return { ...clip, cameraNodeId: index ? clip.cameraNodeId : 'camera_1' }
    }) }] }
    const before = structuredClone(project)
    for (const range of [{ startFrame: 0, endFrame: 149 }, { startFrame: 150, endFrame: 224 }, { startFrame: 120, endFrame: 179 }]) {
      const args = { sequenceId: 'seq', characterIds: [String(added.result.characterId)], viewportAspect: 16 / 9, range }
      assert.deepEqual(inspectProjectFilm(project, args).issues, [])
      const sampled = await sampleProjectFilm(project, args)
      assert.equal(sampled.durationTicks, (range.endFrame - range.startFrame + 1) * 20 / 30)
      assert.equal(sampled.cameras.length, range.startFrame === 120 ? 2 : 1)
      assert.deepEqual(project, before)
    }
    const storedBeforeRepair = await readUnifiedProject(projectId)
    const document = planExportCameraRepair(project, 'seq', { startFrame: 0, endFrame: 149 }, 'repaired', 'repair-shot')
    assert.deepEqual(document.content.editorial!.sequences[0], project.scene.content.editorial!.sequences[0])
    assert.deepEqual(project, before)
    const repaired = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: project.revision,
      command: 'scene.apply', args: { operations: [{ type: 'document.replace', document, fcurves: project.extensions.topview?.fcurves ?? null }] } })
    assert.equal((await readUnifiedProject(projectId)).scene.content.editorial!.sequences.length, 2)
    await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: project.revision,
      command: 'history.undo', args: {} }), /revision/i)
    await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: repaired.revision, command: 'history.undo', args: {} })
    assert.deepEqual((await readUnifiedProject(projectId)).scene, storedBeforeRepair.scene)
  } finally {
    if (previousProjectsDir === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR
    else process.env.BBS_UNIFIED_PROJECTS_DIR = previousProjectsDir
    await rm(temp, { recursive: true, force: true })
  }
})

test('one-click repair ranges exclude overlapping footage and always pass shot selection', async () => {
  const { exportShotRepairRanges } = await import('../src/exportShotSelection.ts')
  const overlap = [shot('a', 0, 32), shot('b', 30, 59)]
  const before = structuredClone(overlap)
  const repairs = exportShotRepairRanges(overlap, { startFrame: 0, endFrame: 59 }, 30)
  assert.deepEqual(repairs, [{ shotId: 'a', range: { startFrame: 0, endFrame: 29 } }, { shotId: 'b', range: { startFrame: 33, endFrame: 59 } }])
  for (const repair of repairs) assert.deepEqual(selectExportShots(overlap, repair.range, 30).issues, [])
  assert.deepEqual(overlap, before)
})
