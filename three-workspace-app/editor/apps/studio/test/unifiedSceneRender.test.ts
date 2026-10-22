import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProjectState, UnifiedStoreError } from '../src/unifiedProjectStore.ts'
import { cancelUnifiedJob, getUnifiedJob, readUnifiedJobFile, startUnifiedSceneRender } from '../src/unifiedJobs.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-scene-render-test-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => { rmSync(projectsDir, { recursive: true, force: true }) })

test('film.frame.set persists through revisioned history and scene.render fits the saved aspect', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: {
    name: 'Film frame command', scene: makeEmptyDraft('Film frame command', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }),
  } })
  const projectId = String(created.result.projectId)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'film.frame.set', args: { aspect: '9:16' } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'film.frame.set', args: { aspect: 0 } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'film.frame.set', args: { aspect: '9:16' } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT')

  const dry = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, dryRun: true, command: 'film.frame.set', args: { aspect: '9:16' } })
  assert.equal(dry.result.valid, true)
  const set = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'film.frame.set', args: { aspect: '9:16' } })
  assert.equal(set.revision, 1)
  assert.equal(set.result.viewportAspect, 9 / 16)
  const rendered = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.render', args: {
    frames: [0], cameraNodeIds: ['camera_1'], width: 1000, height: 1000, outputDirectory: { kind: 'client-directory', id: randomUUID() },
  } })
  assert.deepEqual([rendered.result.width, rendered.result.height, rendered.result.actualAspect, rendered.result.aspectError], [558, 992, 9 / 16, 0])
  const overridden = await executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.render', args: {
    frames: [0], cameraNodeIds: ['camera_1'], width: 1000, height: 1000, viewportAspect: 1, outputDirectory: { kind: 'client-directory', id: randomUUID() },
  } })
  assert.deepEqual([overridden.result.width, overridden.result.height, overridden.result.viewportAspect], [1000, 1000, 1])
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.render', args: {
    frames: [0], cameraNodeIds: ['camera_1'], width: 64, height: 64, outputDirectory: { kind: 'client-directory', id: randomUUID() },
  } }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  const undone = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'history.undo', args: {} })
  assert.equal(undone.revision, 2)
  const project = await readUnifiedProjectState(projectId)
  assert.equal(project.project.extensions.filmFrame, undefined)
  assert.equal(project.history.canRedo, true)
})

test('scene.render requires an opaque browser directory capability and valid snapshot inputs', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: {
    name: 'Scene render validation', scene: makeEmptyDraft('Scene render validation', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }),
  } })
  const projectId = String(created.result.projectId)
  for (const outputDirectory of ['/arbitrary/path/renders/output', { kind: 'client-directory', id: 'forged' }]) {
    await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.render', args: {
      frames: [0], cameraNodeIds: ['camera_1'], width: 64, height: 64, outputDirectory,
    } }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  }
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.render', args: {
    frames: [0], cameraNodeIds: ['missing'], width: 64, height: 64, outputDirectory: { kind: 'client-directory', id: randomUUID() },
  } }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 7, command: 'scene.render', args: {
    frames: [0], cameraNodeIds: ['camera_1'], width: 64, height: 64, outputDirectory: { kind: 'client-directory', id: randomUUID() },
  } }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT' && error.status === 409)
})

test('film.export validates names and sampling through the project command broker', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: {
    name: 'Film export validation', scene: makeEmptyDraft('Film export validation', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }),
  } })
  const projectId = String(created.result.projectId)
  const args = { characterIds: ['character'], sequenceId: 'sequence', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 16 / 9, filmName: 'film-01' }
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'film.export', args: { ...args, filmName: '../unsafe' }, dryRun: true }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'film.export', args: { ...args, filmName: 'unsafe.' }, dryRun: true }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 7, command: 'film.export', args, dryRun: true }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT' && error.status === 409)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'film.export', args, dryRun: true }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
})

test('scene.render runs an immutable Topview snapshot and exposes only verified output files', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: {
    name: 'Scene render job', scene: makeEmptyDraft('Scene render job', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }),
  } })
  const projectId = String(created.result.projectId)
  const request = {
    requestId: randomUUID(), projectId, command: 'scene.render', args: {
      frames: [0], cameraNodeIds: ['camera_1'], width: 64, height: 64, viewportAspect: 1,
      outputDirectory: { kind: 'client-directory', id: randomUUID() },
    },
  }
  const started = await executeUnifiedCommand(request)
  const duplicate = await executeUnifiedCommand(request)
  assert.equal(duplicate.result.jobId, started.result.jobId)
  assert.equal(started.revision, 0)

  let job = await getUnifiedJob(String(started.result.jobId), projectId)
  for (let attempt = 0; attempt < 120 && !['succeeded', 'failed', 'cancelled'].includes(job.state); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    job = await getUnifiedJob(String(started.result.jobId), projectId)
  }
  assert.equal(job.state, 'succeeded', JSON.stringify(job))
  assert.equal(job.sourceRevision, 0)
  assert.equal(job.result?.files.filter((file) => file.mimeType === 'image/png').length, 2)
  const frame = job.result?.files.find((file) => file.name === 'camera-0-frame-0.png')
  assert.ok(frame)
  const downloaded = await readUnifiedJobFile(job.jobId, projectId, frame.id)
  assert.ok(downloaded)
  assert.deepEqual([...downloaded.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(await readUnifiedJobFile(job.jobId, projectId, '../0'), null)
  const status = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'job.get', args: { jobId: job.jobId } })
  assert.equal((status.result.job as { state: string }).state, 'succeeded')
  const cancelled = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'job.cancel', args: { jobId: job.jobId } })
  assert.deepEqual(cancelled.result, { state: 'succeeded', committed: true })
  const cancellable = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.render', args: {
    frames: [0], cameraNodeIds: ['camera_1'], width: 64, height: 64, viewportAspect: 1, outputDirectory: { kind: 'client-directory', id: randomUUID() },
  } })
  const previewCancel = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'job.cancel', args: { jobId: cancellable.result.jobId }, dryRun: true })
  assert.equal(previewCancel.result.valid, true)
  assert.notEqual((await getUnifiedJob(String(cancellable.result.jobId), projectId)).state, 'cancelled')
  const cancellation = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'job.cancel', args: { jobId: cancellable.result.jobId } })
  assert.equal(cancellation.result.state, 'cancelled')
  assert.equal((await readUnifiedProjectState(projectId)).history.canUndo, false)
})

test('concurrent render starts reserve one slot until cancellation finishes', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: {
    name: 'Concurrent render', scene: makeEmptyDraft('Concurrent render', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }),
  } })
  const { project } = await readUnifiedProjectState(String(created.result.projectId))
  const args = { frames: [0], cameraNodeIds: ['camera_1'], width: 64, height: 64 }
  const attempts = await Promise.allSettled([startUnifiedSceneRender(project, args), startUnifiedSceneRender(project, args)])
  const accepted = attempts.filter((attempt) => attempt.status === 'fulfilled')
  try {
    assert.equal(accepted.length, 1)
    const rejected = attempts.find((attempt) => attempt.status === 'rejected')
    assert.equal((rejected?.reason as { code: string }).code, 'JOB_BUSY')
  } finally {
    for (const attempt of accepted) await cancelUnifiedJob(attempt.value.jobId, project.projectId)
  }
})
