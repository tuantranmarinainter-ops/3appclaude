import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { sampleProjectCameraSequence } from '../src/unifiedSkeletonEvaluation.ts'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-camera-motion-test-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => { rmSync(projectsDir, { recursive: true, force: true }) })

async function collectCameraSamples(projectId: string) {
  const project = await readUnifiedProject(projectId)
  const samples = []
  for await (const sample of sampleProjectCameraSequence(project, 'sequence_1', 20, 16 / 9)) samples.push(sample)
  return samples
}

test('camera motion add bakes dolly_in into film samples and supports dry-run, idempotency, remove, undo and stale revisions', async () => {
  const scene = makeEmptyDraft('Camera motion test', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  scene.content.nodes.push({
    id: 'subject_1', type: 'primitive', name: 'Subject', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
  })
  scene.content.nodes[0]!.camera!.subject = {
    nodeId: 'subject_1', distance: 5, offset: { x: 0, y: 2, z: 5 }, lookAtOffset: { x: 0, y: 1, z: 0 },
    follow: true, followRotation: false, overridesMotion: true,
  }
  const created = await executeUnifiedCommand({
    requestId: randomUUID(), command: 'project.create',
    args: { name: 'Camera motion test', scene },
  })
  const projectId = String(created.result.projectId)
  await executeUnifiedCommand({
    requestId: randomUUID(), projectId, expectedRevision: 0, command: 'camera.shot.set',
    args: { sequenceId: 'sequence_1', clip: { id: 'shot_main', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 59 } },
  })

  const before = await collectCameraSamples(projectId)
  const add = {
    requestId: randomUUID(), projectId, expectedRevision: 1, command: 'camera.motion.add',
    args: { cameraNodeId: 'camera_1', presetId: 'dolly_in', frameStart: 0, durationFrames: 30 },
  }
  const preview = await executeUnifiedCommand({ ...add, requestId: randomUUID(), dryRun: true })
  assert.equal(preview.revision, 1)
  assert.equal(preview.result.valid, true)
  assert.equal((await readUnifiedProject(projectId)).scene.content.timeline.animation.cameraMotionClips.length, 0)

  const added = await executeUnifiedCommand(add)
  assert.equal(added.revision, 2)
  assert.deepEqual(await executeUnifiedCommand(add), added)
  const clipId = String(added.result.clipId)
  const project = await readUnifiedProject(projectId)
  assert.equal(project.scene.content.nodes.find((node) => node.id === 'camera_1')?.camera?.subject?.overridesMotion, false)
  const clip = project.scene.content.timeline.animation.cameraMotionClips.find((item) => item.id === clipId)!
  assert.equal(clip.frameEnd, 30)
  const after = await collectCameraSamples(projectId)
  assert.ok(after.some((sample, index) => Math.hypot(...sample.position.map((value, axis) => value - before[index]!.position[axis]!)) > 0.1))
  assert.ok(after.find((sample) => sample.sourceFrame === 30)!.position[2]! < before.find((sample) => sample.sourceFrame === 30)!.position[2]!)

  await assert.rejects(executeUnifiedCommand({ ...add, requestId: randomUUID(), expectedRevision: 2, args: { ...add.args, frameStart: 20 } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ ...add, requestId: randomUUID(), expectedRevision: 2, args: { ...add.args, presetId: 'unknown' } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ ...add, requestId: randomUUID(), expectedRevision: 2, args: { ...add.args, cameraNodeId: 'missing-camera' } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')

  const remove = { requestId: randomUUID(), projectId, expectedRevision: 2, command: 'camera.motion.remove', args: { clipId } }
  await assert.rejects(executeUnifiedCommand({ ...remove, expectedRevision: 1 }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT')
  const removed = await executeUnifiedCommand(remove)
  assert.equal(removed.revision, 3)
  assert.equal((await readUnifiedProject(projectId)).scene.content.timeline.animation.cameraMotionClips.length, 0)
  const undone = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 3, command: 'history.undo', args: {} })
  assert.equal(undone.revision, 4)
  assert.equal((await readUnifiedProject(projectId)).scene.content.timeline.animation.cameraMotionClips.length, 1)
})
