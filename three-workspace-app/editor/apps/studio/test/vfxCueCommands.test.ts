import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-vfx-cue-commands-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => rmSync(projectsDir, { recursive: true, force: true }))

function sceneFixture() {
  const scene = makeEmptyDraft('VFX command scene', 30, 90, { fov: 50, position: { x: 0, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  scene.content.nodes.push({ id: 'vfx-anchor', type: 'primitive', name: 'VFX Anchor', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } } })
  return scene
}

const cue = { effect: 'aura01', frameStart: 10, frameEnd: 30, position: { x: 0, y: 1, z: 0 }, yaw: 20, scale: 1 }
const send = (projectId: string, revision: number | undefined, command: string, args: Record<string, unknown>, dryRun = false) =>
  executeUnifiedCommand({ requestId: randomUUID(), projectId, ...(revision === undefined ? {} : { expectedRevision: revision }), command, args, ...(dryRun ? { dryRun: true } : {}) })

test('VFX cue CRUD is revisioned, undoable, and validates inputs before commit', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'VFX command scene', scene: sceneFixture() } })
  const projectId = String(created.result.projectId)
  const dryRun = await send(projectId, 0, 'vfx.cue.add', { cue }, true)
  assert.equal(dryRun.result.valid, true)
  assert.equal((await readUnifiedProject(projectId)).revision, 0)

  await assert.rejects(send(projectId, 0, 'vfx.cue.add', { cue: { ...cue, effect: '../../escape' } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  await assert.rejects(send(projectId, undefined, 'vfx.cue.add', { cue }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')

  const added = await send(projectId, 0, 'vfx.cue.add', { cue })
  const cueId = (added.result.cue as { id: string }).id
  assert.equal(added.revision, 1)
  assert.match(cueId, /^[0-9a-f-]{36}$/i)
  const persisted = await readUnifiedProject(projectId)
  assert.deepEqual(persisted.extensions.vfxCues, { version: 1, cues: [{ ...cue, id: cueId }] })
  const list = await send(projectId, 1, 'vfx.cue.list', { frameStart: 20, frameEnd: 25 })
  assert.equal((list.result.cues as unknown[]).length, 1)
  const outside = await send(projectId, 1, 'vfx.cue.list', { frameStart: 31, frameEnd: 40 })
  assert.equal((outside.result.cues as unknown[]).length, 0)

  await assert.rejects(send(projectId, 0, 'vfx.cue.update', { id: cueId, patch: { scale: 2 } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT')
  const updated = await send(projectId, 1, 'vfx.cue.update', { id: cueId, patch: { scale: 2, position: { x: 4, y: 0, z: -1 } } })
  assert.equal(updated.revision, 2)
  assert.equal((updated.result.cue as { id: string }).id, cueId)
  await assert.rejects(send(projectId, 2, 'vfx.cue.update', { id: cueId, patch: { id: 'replace', scale: 3 } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')

  await send(projectId, 2, 'vfx.cue.update', { id: cueId, patch: { attachNodeId: 'vfx-anchor' } })
  const attached = (await readUnifiedProject(projectId)).extensions.vfxCues as { cues: Array<Record<string, unknown>> }
  assert.equal(attached.cues[0]?.attachNodeId, 'vfx-anchor')
  const detached = await send(projectId, 3, 'vfx.cue.update', { id: cueId, patch: { attachNodeId: null } })
  assert.equal(detached.revision, 4)
  const detachedCue = ((await readUnifiedProject(projectId)).extensions.vfxCues as { cues: Array<Record<string, unknown>> }).cues[0]
  assert.equal(Object.hasOwn(detachedCue!, 'attachNodeId'), false)

  const removed = await send(projectId, 4, 'vfx.cue.remove', { id: cueId })
  assert.equal(removed.revision, 5)
  assert.deepEqual((await readUnifiedProject(projectId)).extensions.vfxCues, { version: 1, cues: [] })
  await send(projectId, 5, 'history.undo', {})
  assert.deepEqual((await readUnifiedProject(projectId)).extensions.vfxCues, { version: 1, cues: [{ ...cue, id: cueId, scale: 2, position: { x: 4, y: 0, z: -1 } }] })
  await send(projectId, 6, 'history.undo', {})
  assert.deepEqual((await readUnifiedProject(projectId)).extensions.vfxCues, { version: 1, cues: [{ ...cue, id: cueId, scale: 2, position: { x: 4, y: 0, z: -1 }, attachNodeId: 'vfx-anchor' }] })
  await send(projectId, 7, 'history.undo', {})
  assert.deepEqual((await readUnifiedProject(projectId)).extensions.vfxCues, { version: 1, cues: [{ ...cue, id: cueId, scale: 2, position: { x: 4, y: 0, z: -1 } }] })
  await send(projectId, 8, 'history.undo', {})
  assert.deepEqual((await readUnifiedProject(projectId)).extensions.vfxCues, { version: 1, cues: [{ ...cue, id: cueId }] })
  await send(projectId, 9, 'history.undo', {})
  assert.equal((await readUnifiedProject(projectId)).extensions.vfxCues, undefined)
})
