import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { FCurveSet } from '@topview/3d-builder/evaluate'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-scene-replace-test-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => { rmSync(projectsDir, { recursive: true, force: true }) })

test('scene replacement preserves omitted camera curves and allows explicit clearing', async () => {
  const scene = makeEmptyDraft('Camera preservation', 30, 90, { fov: 50, position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } })
  const fcurves = FCurveSet.persist(null, { camera_1: { position: [{ id: 'camera-user-key', frame: 12, value: [7, 8, 9], interpolation: 'linear' }] } })
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Camera preservation', scene, fcurves } })
  const projectId = String(created.result.projectId)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: scene }] } })
  assert.deepEqual((await readUnifiedProject(projectId)).extensions.topview?.fcurves, fcurves)
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: scene, fcurves: null }] } })
  assert.equal((await readUnifiedProject(projectId)).extensions.topview?.fcurves, null)
})
