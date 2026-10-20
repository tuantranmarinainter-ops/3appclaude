import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { FCurveSet } from '@topview/3d-builder/evaluate'
import { executeUnifiedCommand, readUnifiedProject, readUnifiedProjectState, UnifiedStoreError } from '../src/unifiedProjectStore.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-scene-evaluate-test-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => { rmSync(projectsDir, { recursive: true, force: true }) })

test('scene.evaluate reuses Topview evaluator and does not create a project revision', async () => {
  const created = await executeUnifiedCommand({
    requestId: randomUUID(), command: 'project.create',
    args: { name: 'Scene evaluate test', scene: makeEmptyDraft('Scene evaluate test', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }) },
  })
  const projectId = String(created.result.projectId)
  const requestId = randomUUID()
  const response = await executeUnifiedCommand({ requestId, projectId, command: 'scene.evaluate', args: { frame: 12, cameraNodeId: 'camera_1' } })
  assert.equal(response.revision, 0)
  assert.equal(response.result.sourceRevision, 0)
  assert.deepEqual((response.result.transforms as Record<string, unknown>).camera_1 && ((response.result.transforms as Record<string, { position: { x: number; y: number; z: number } }>).camera_1!.position), { x: 1, y: 2, z: 3 })
  assert.equal((await executeUnifiedCommand({ requestId, projectId, command: 'scene.evaluate', args: { frame: 12, cameraNodeId: 'camera_1' } })).revision, 0)

  const withCheck = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 200, checks: ['grounding'] } })
  assert.deepEqual(withCheck.result.issues, [
    { code: 'FRAME_OUTSIDE_TIMELINE', path: 'frame', message: 'Frame is outside the project timeline range.' },
  ])
  assert.equal((withCheck.result.checks as Record<string, { status: string }>).grounding!.status, 'complete')
  assert.deepEqual((await readUnifiedProjectState(projectId)).history, { canUndo: false, canRedo: false })
  assert.equal((await readUnifiedProject(projectId)).revision, 0)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0, cameraNodeId: 'missing' } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  const project = await readUnifiedProject(projectId)
  const fcurves = FCurveSet.persist(null, { camera_1: { position: [{ id: 'saved-camera-key', frame: 12, value: [7, 8, 9], interpolation: 'linear' }] } })
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: project.scene, fcurves }] } })
  const keyed = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 12 } })
  assert.deepEqual((keyed.result.transforms as Record<string, { position: unknown }>).camera_1!.position, { x: 7, y: 8, z: 9 })
  assert.equal((await readUnifiedProject(projectId)).revision, 1)
})

test('scene.evaluate returns Topview grounding, overlap and frustum measurements without writing history', async () => {
  const scene = makeEmptyDraft('Geometry checks', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  for (const [id, x, y] of [['box_a', 0, 0.5], ['box_b', 0.5, 0.5], ['box_c', 3, -0.5]] as const) scene.content.nodes.push({
    id, type: 'primitive', name: id, visible: true, locked: false,
    transform: { position: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
  })
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Geometry checks', scene } })
  const projectId = String(created.result.projectId)
  const response = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0, checks: ['grounding', 'overlap', 'frustum'] } })
  const checks = response.result.checks as Record<string, any>
  assert.equal(checks.grounding.status, 'complete', JSON.stringify(checks))
  assert.deepEqual(checks.grounding.nodes.map((node: { status: string }) => node.status), ['grounded', 'grounded', 'penetrating'])
  assert.equal(checks.overlap.pairs.length, 3)
  assert.equal(checks.overlap.pairs[0].boundsIntersect, true)
  assert.equal(checks.overlap.pairs[1].boundsIntersect, false)
  assert.ok(checks.overlap.pairs[1].boundsGap > 0)
  assert.equal(checks.frustum.status, 'complete')
  assert.equal(checks.frustum.nodes.find((node: { nodeId: string }) => node.nodeId === 'box_a')!.inFrustum, true)
  assert.equal(checks.frustum.nodes.find((node: { nodeId: string }) => node.nodeId === 'box_b')!.inFrustum, true)
  assert.deepEqual((response.result.checkDiagnostics as { blockedRequests: string[] }).blockedRequests, [])
  assert.equal(Array.isArray((response.result.checkDiagnostics as { warnings: string[] }).warnings), true)
  assert.equal(response.revision, 0)
  assert.deepEqual((await readUnifiedProjectState(projectId)).history, { canUndo: false, canRedo: false })
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'scene.evaluate', args: { frame: 0, checks: ['render'] } }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
})
