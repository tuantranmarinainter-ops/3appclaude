import assert from 'node:assert/strict'
import { sampleProjectCameraSequence } from '../src/unifiedSkeletonEvaluation.ts'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-camera-shot-test-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => { rmSync(projectsDir, { recursive: true, force: true }) })

test('camera.shot.set inserts, updates, deduplicates and undoes native editorial clips', async () => {
  const created = await executeUnifiedCommand({
    requestId: randomUUID(), command: 'project.create',
    args: { name: 'Camera shot test', scene: makeEmptyDraft('Camera shot test', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }) },
  })
  const projectId = String(created.result.projectId)
  const shot = {
    requestId: randomUUID(), projectId, expectedRevision: 0, command: 'camera.shot.set',
    args: { sequenceId: 'sequence_1', clip: { id: 'shot_main', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 29 } },
  } as const
  const inserted = await executeUnifiedCommand(shot)
  assert.equal(inserted.revision, 1)
  assert.equal(inserted.result.shotId, 'shot_main')
  assert.equal((await executeUnifiedCommand(shot)).revision, 1)

  const updated = await executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 1, command: 'camera.shot.set',
    args: { sequenceId: 'sequence_1', clip: { id: 'shot_main', cameraNodeId: 'camera_1', sourceFrameStart: 15, sourceFrameEnd: 44 } },
  })
  assert.equal(updated.revision, 2)
  const beforeUndo = await readUnifiedProject(projectId)
  const sampled = []
  for await (const sample of sampleProjectCameraSequence(beforeUndo, 'sequence_1', 20, 16 / 9)) sampled.push(sample)
  assert.equal(sampled.length, 21)
  assert.equal(sampled[0]!.sourceFrame, 15)
  assert.equal(sampled.at(-1)!.sourceFrame, 45)
  assert.equal(sampled.at(-1)!.side, 'left')
  assert.ok(sampled.every((sample) => sample.sourceRevision === 2 && sample.cameraNodeId === 'camera_1'))
  assert.equal((await readUnifiedProject(projectId)).revision, 2)
  assert.deepEqual(beforeUndo.scene.content.editorial?.sequences[0]?.clips[0], { id: 'shot_main', cameraNodeId: 'camera_1', sourceFrameStart: 15, sourceFrameEnd: 44 })

  const undone = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 2, command: 'history.undo', args: {} })
  assert.equal(undone.revision, 3)
  const afterUndo = await readUnifiedProject(projectId)
  assert.deepEqual(afterUndo.scene.content.editorial?.sequences[0]?.clips[0], { id: 'shot_main', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 29 })

  await assert.rejects(executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 3, command: 'camera.shot.set',
    args: { sequenceId: 'sequence_1', clip: { id: 'bad-shot', cameraNodeId: 'missing-camera', sourceFrameStart: 0, sourceFrameEnd: 9 } },
  }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  assert.equal((await readUnifiedProject(projectId)).revision, 3)
})
