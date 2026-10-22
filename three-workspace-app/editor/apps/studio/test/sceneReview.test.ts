import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore.ts'
import { makeSceneReviewShot, planReviewFrames, reviewStatusFor, reviewStatusForSequence } from '../src/sceneReview.ts'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-scene-review-test-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => { rmSync(projectsDir, { recursive: true, force: true }) })

function sceneWithEditorial() {
  const scene = makeEmptyDraft('Scene review', 30, 90)
  scene.content.editorial = { version: 1, activeSequenceId: 'sequence-1', sequences: [{
    id: 'sequence-1', clips: [
      { id: 'clip-1', cameraNodeId: 'camera_1', sourceFrameStart: 10, sourceFrameEnd: 20 },
      { id: 'clip-2', cameraNodeId: 'camera_1', sourceFrameStart: 30, sourceFrameEnd: 40 },
    ],
  }, { id: 'sequence-2', clips: [{ id: 'clip-1', cameraNodeId: 'camera_1', sourceFrameStart: 50, sourceFrameEnd: 60 }] }] }
  return scene
}

function projectFixture(): UnifiedProject {
  const scene = sceneWithEditorial()
  scene.content.nodes.push({
    id: 'review-prop', type: 'primitive', name: 'Review prop', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    primitive: { kind: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } },
  })
  const created = {
    type: 'three-workspace-project' as const, version: 1 as const, projectId: randomUUID(), name: 'Scene review', revision: 0,
    scene, assets: {}, characters: {}, skeletons: {}, mappings: {}, motions: {}, bindings: {}, retargetSessions: {}, extensions: {}, origins: [],
  }
  return created as UnifiedProject
}

test('planReviewFrames picks deterministic 15/50/85 percent source frames', () => {
  const project = projectFixture()
  assert.deepEqual(planReviewFrames(project, 'sequence-1'), [
    { clipId: 'clip-1', frames: [12, 15, 19] },
    { clipId: 'clip-2', frames: [32, 35, 39] },
  ])
  assert.deepEqual(planReviewFrames(project, 'missing'), [])
})

test('reviewStatusFor persists a baseline and only invalidates time-relevant changes', () => {
  const project = projectFixture()
  const track = (keys: unknown[]) => ({ version: 1, encoding: 'compact-v1', fcurves: [{ id: 'prop-track', t: ['node', 'review-prop'], p: 'transform.position', i: 0, k: keys }] })
  project.extensions.topview = { fcurves: track([[0, 0, 'linear', 'a'], [15, 1, 'linear', 'b'], [25, 2, 'linear', 'c'], [50, 3, 'linear', 'd']]) }
  project.extensions.sceneReview = { version: 1, sequenceId: 'sequence-1', shots: {
    'clip-1': makeSceneReviewShot(project, 'sequence-1', 'clip-1', 'ok', ''),
  } }
  assert.equal(reviewStatusFor(project, 'clip-1').status, 'ok')
  assert.equal(reviewStatusForSequence(project, 'sequence-2', 'clip-1').status, 'pending')

  const outside = structuredClone(project)
  outside.extensions.topview = { fcurves: track([[0, 0, 'linear', 'a'], [15, 1, 'linear', 'b'], [25, 2, 'linear', 'c'], [50, 99, 'linear', 'd']]) }
  outside.scene.content.timeline.animation.motionClips.push({ id: 'outside', frameStart: 50, frameEnd: 60, target: { type: 'node', nodeId: 'review-prop' } } as never)
  assert.equal(reviewStatusFor(outside, 'clip-1').status, 'ok')

  const inside = structuredClone(project)
  inside.extensions.topview = { fcurves: track([[0, 0, 'linear', 'a'], [15, 8, 'linear', 'b'], [25, 2, 'linear', 'c'], [50, 3, 'linear', 'd']]) }
  assert.equal(reviewStatusFor(inside, 'clip-1').status, 'pending')
  const boundary = structuredClone(project)
  boundary.extensions.topview = { fcurves: track([[0, 0, 'linear', 'a'], [15, 1, 'linear', 'b'], [25, 8, 'linear', 'c'], [50, 3, 'linear', 'd']]) }
  assert.equal(reviewStatusFor(boundary, 'clip-1').status, 'pending')

  const insideClip = structuredClone(project)
  insideClip.scene.content.timeline.animation.motionClips.push({ id: 'inside', frameStart: 15, frameEnd: 16, target: { type: 'node', nodeId: 'review-prop' } } as never)
  assert.equal(reviewStatusFor(insideClip, 'clip-1').status, 'pending')
  const insideCue = structuredClone(project)
  insideCue.extensions.vfxCues = { version: 1, cues: [{ id: 'fx1', effect: 'aura01', frameStart: 15, frameEnd: 16, position: { x: 0, y: 0, z: 0 }, yaw: 0, scale: 1 }] }
  assert.equal(reviewStatusFor(insideCue, 'clip-1').status, 'pending')
  const outsideCue = structuredClone(project)
  outsideCue.extensions.vfxCues = { version: 1, cues: [{ id: 'fx2', effect: 'aura01', frameStart: 50, frameEnd: 60, position: { x: 0, y: 0, z: 0 }, yaw: 0, scale: 1 }] }
  assert.equal(reviewStatusFor(outsideCue, 'clip-1').status, 'ok')

  const changedNode = structuredClone(project)
  changedNode.scene.content.nodes.find((node) => node.id === 'review-prop')!.transform.position.x += 1
  assert.equal(reviewStatusFor(changedNode, 'clip-1').status, 'pending')
  const withNote = structuredClone(changedNode)
  withNote.extensions.sceneReview = { version: 1, sequenceId: 'sequence-1', shots: {
    'clip-1': makeSceneReviewShot(project, 'sequence-1', 'clip-1', 'note', 'Keep this note'),
  } }
  assert.equal(reviewStatusFor(withNote, 'clip-1').status, 'note')
  assert.equal(reviewStatusFor(withNote, 'clip-1').note, 'Keep this note')
})

test('scene.review commands persist across reload, guard revisions, and support undo', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Review commands', scene: sceneWithEditorial() } })
  const projectId = String(created.result.projectId)
  const dryRun = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'scene.review.set', dryRun: true,
    args: { sequenceId: 'sequence-1', clipId: 'clip-1', status: 'ok', note: '' } })
  assert.equal(dryRun.result.valid, true)
  assert.equal((await readUnifiedProject(projectId)).revision, 0)

  const set = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'scene.review.set',
    args: { sequenceId: 'sequence-1', clipId: 'clip-1', status: 'ok', note: 'Looks good' } })
  assert.equal(set.revision, 1)
  const reloaded = await readUnifiedProject(projectId)
  assert.equal(reviewStatusFor(reloaded, 'clip-1').status, 'ok')
  assert.equal(reviewStatusFor(reloaded, 'clip-1').note, 'Looks good')
  const get = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'scene.review.get', args: { sequenceId: 'sequence-1', clipId: 'clip-1' } })
  assert.equal(get.result.status, 'ok')
  const sequenceGet = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'scene.review.get', args: { sequenceId: 'sequence-1' } })
  assert.deepEqual((sequenceGet.result.shots as Array<{ clipId: string; frames: number[] }>).map(({ clipId, frames }) => [clipId, frames]), [
    ['clip-1', [12, 15, 19]], ['clip-2', [32, 35, 39]],
  ])
  const otherSequenceGet = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'scene.review.get', args: { sequenceId: 'sequence-2', clipId: 'clip-1' } })
  assert.equal(otherSequenceGet.result.status, 'pending')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'scene.review.set',
    args: { sequenceId: 'sequence-1', clipId: 'clip-1', status: 'note', note: 'stale' } }),
  (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT')
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'history.undo', args: {} })
  assert.equal((await readUnifiedProject(projectId)).extensions.sceneReview, undefined)
})

test('scene.review rejects malformed and oversized inputs', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Review validation', scene: sceneWithEditorial() } })
  const projectId = String(created.result.projectId)
  for (const args of [
    { sequenceId: 'sequence-1', clipId: 'missing', status: 'ok', note: '' },
    { sequenceId: 'sequence-1', clipId: 'clip-1', status: 'bad', note: '' },
    { sequenceId: 'sequence-1', clipId: 'clip-1', status: 'note', note: 'x'.repeat(2001) },
  ]) await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'scene.review.set', args }),
    (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
})
