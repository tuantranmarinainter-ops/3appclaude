import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore.ts'

const projects = mkdtempSync(path.join(tmpdir(), 'bbs-history-fast-path-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projects
test.after(() => rmSync(projects, { recursive: true, force: true }))
const errorCode = (code: string) => (error: unknown) => error instanceof UnifiedStoreError && error.code === code
async function create() {
  const result = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'History', scene: makeEmptyDraft('History', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }) } })
  return result.projectId
}
const history = (projectId: string, revision: number, command = 'history.undo') => ({ requestId: randomUUID(), projectId, expectedRevision: revision, command, args: {} })
async function edit(projectId: string, revision: number) {
  return executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'camera.shot.set', args: { sequenceId: 'sequence_1', clip: { id: 'shot_main', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 29 } } })
}

test('undo/redo replay, collision, stale revisions and crash recovery preserve monotonic revisions', async () => {
  const id = await create()
  await assert.rejects(executeUnifiedCommand(history(id, 0)), errorCode('VALIDATION_FAILED'))
  await assert.rejects(executeUnifiedCommand(history(id, 0, 'history.redo')), errorCode('VALIDATION_FAILED'))
  await edit(id, 0)
  const undo = history(id, 1), undone = await executeUnifiedCommand(undo)
  assert.equal(undone.revision, 2)
  assert.equal((await readUnifiedProject(id)).scene.content.editorial?.sequences[0]?.clips.length ?? 0, 0)
  // Simulate a crash after durable project/history publication but before request cache publication.
  unlinkSync(path.join(projects, '.requests', `${undo.requestId}.json`))
  assert.deepEqual(await executeUnifiedCommand(undo), undone)
  await assert.rejects(executeUnifiedCommand({ ...undo, command: 'history.redo' }), errorCode('REQUEST_ID_CONFLICT'))
  const redo = history(id, 2, 'history.redo'), redone = await executeUnifiedCommand(redo)
  assert.equal(redone.revision, 3)
  assert.equal((await readUnifiedProject(id)).scene.content.editorial?.sequences[0]?.clips.length, 1)
  assert.deepEqual(await executeUnifiedCommand(redo), redone)
  // A cached response must remain available after later commands have committed.
  const again = history(id, 3)
  await executeUnifiedCommand(again)
  assert.deepEqual(await executeUnifiedCommand(redo), redone)
  await assert.rejects(executeUnifiedCommand(history(id, 3)), errorCode('REVISION_CONFLICT'))
  assert.equal((await readUnifiedProject(id)).revision, 4)
  rmSync(path.join(projects, id), { recursive: true, force: true })
  assert.deepEqual(await executeUnifiedCommand(redo), redone)
  await assert.rejects(executeUnifiedCommand({ ...redo, command: 'history.undo' }), errorCode('REQUEST_ID_CONFLICT'))
})

test('writer exclusion, competing request IDs, dry run and invalid arguments do not mutate history', async () => {
  const id = await create()
  await edit(id, 0)
  const dry = await executeUnifiedCommand({ ...history(id, 1), dryRun: true })
  assert.equal(dry.result.valid, true)
  await assert.rejects(executeUnifiedCommand({ ...history(id, 1), args: { invalid: true } }), errorCode('VALIDATION_FAILED'))
  const lock = path.join(projects, id, '.writer.lock')
  writeFileSync(lock, 'another writer')
  await assert.rejects(executeUnifiedCommand(history(id, 1)), errorCode('WRITER_BUSY'))
  unlinkSync(lock)
  const results = await Promise.allSettled([executeUnifiedCommand(history(id, 1)), executeUnifiedCommand(history(id, 1))])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  assert.ok(rejected.reason instanceof UnifiedStoreError)
  assert.ok(['WRITER_BUSY', 'REVISION_CONFLICT'].includes(rejected.reason.code))
  assert.equal((await readUnifiedProject(id)).revision, 2)
  await assert.rejects(executeUnifiedCommand(history(randomUUID(), 0)), errorCode('NOT_FOUND'))
})
