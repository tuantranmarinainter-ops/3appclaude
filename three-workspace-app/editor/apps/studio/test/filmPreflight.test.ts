import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { filmPreflight } from '../src/filmPreflight.ts'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore.ts'
import { makeSceneReviewShot } from '../src/sceneReview.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-film-preflight-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => rmSync(projectsDir, { recursive: true, force: true }))

function projectFixture(): UnifiedProject {
  const scene = makeEmptyDraft('Film preflight', 30, 29)
  scene.content.editorial = { version: 1, activeSequenceId: 'sequence-1', sequences: [{ id: 'sequence-1', clips: [
    { id: 'shot-1', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 29 },
  ] }] }
  scene.content.nodes.push({ id: 'actor-node', type: 'character', name: 'Actor', visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } as never)
  scene.content.nodes.push({ id: 'backdrop-node', type: 'prop', name: 'Backdrop', visible: true, locked: false, metadata: { assetId: 'sha256:backdrop' },
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 1 } } } as never)
  return {
    type: 'three-workspace-project', version: 1, projectId: randomUUID(), name: 'Film preflight', revision: 3,
    scene, assets: {}, characters: { actor: { id: 'actor', assetId: 'sha256:asset', nodeId: 'actor-node', skeletonId: 'skeleton', name: 'Actor' } },
    skeletons: {}, mappings: {}, motions: {}, bindings: {}, retargetSessions: {}, extensions: {}, origins: [],
  } as unknown as UnifiedProject
}

const args = { characterIds: ['actor'], sequenceId: 'sequence-1', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 16 / 9 }

test('pure preflight warns for unapproved shots, unavailable transform validator, VFX, and missing character files', () => {
  const project = projectFixture()
  project.extensions.sceneReview = { version: 1, sequenceId: 'sequence-1', shots: {
    'shot-1': makeSceneReviewShot(project, 'sequence-1', 'shot-1', 'ok', ''),
  } }
  const stale = structuredClone(project)
  stale.scene.content.nodes.find((node) => node.id === 'actor-node')!.transform.position.x = 2
  stale.extensions.vfxCues = { version: 1, cues: [{ id: 'cue-1', effect: 'aura01', frameStart: 1, frameEnd: 8 }] }
  const result = filmPreflight(stale, { ...args, assetAvailability: { 'sha256:asset': false } })
  assert.ok(result.errors.some((entry) => entry.code === 'PREFLIGHT_INCOMPLETE_TRANSFORMS'))
  assert.ok(result.errors.some((entry) => entry.code === 'ASSET_FILE_MISSING'))
  assert.ok(result.warnings.some((entry) => entry.code === 'SHOT_NOT_APPROVED' && entry.clipId === 'shot-1'))
  assert.ok(result.warnings.some((entry) => entry.code === 'VFX_BBS_MISSING' && entry.clipId === 'cue-1'))
  const approved = filmPreflight(project, args)
  assert.ok(!approved.warnings.some((entry) => entry.code === 'SHOT_NOT_APPROVED'))
  const badBackdrop = filmPreflight(project, { ...args, propIds: ['backdrop-node'] })
  assert.ok(badBackdrop.errors.some((entry) => entry.code === 'PROP_TRANSFORM_INVALID'))
})

test('foot warnings use supplied measured foot positions and skip airborne frames', () => {
  const project = projectFixture()
  const floating = filmPreflight(project, { ...args, footSamples: { actor: [{ frame: 4, leftY: 0.42, rightY: 0.51 }] } })
  assert.ok(floating.warnings.some((entry) => entry.code === 'CHARACTER_FLOATING' && entry.frame === 4))
  const airborne = filmPreflight(project, { ...args, footSamples: { actor: [{ frame: 5, leftY: 0.42, rightY: 0.51, airborne: true }] } })
  assert.ok(!airborne.warnings.some((entry) => entry.code === 'CHARACTER_FLOATING'))
  const below = filmPreflight(project, { ...args, footSamples: { actor: [{ frame: 6, leftY: -0.06, rightY: 0 }] } })
  assert.ok(below.warnings.some((entry) => entry.code === 'CHARACTER_BELOW_FLOOR' && entry.frame === 6))
})

test('film.preflight is read only, revision checked, and returns bilingual blocking issues', async () => {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Preflight command', scene: makeEmptyDraft('Preflight command', 30, 29) } })
  const projectId = String(created.projectId)
  const before = await readUnifiedProject(projectId)
  const response = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: before.revision,
    command: 'film.preflight', args: { characterIds: [], sequenceId: 'missing', range: { startFrame: 0, endFrame: 29 } } })
  assert.equal(response.revision, before.revision)
  assert.equal(response.result.sourceRevision, before.revision)
  assert.equal(response.result.viewportAspect, 16 / 9)
  assert.equal(response.result.valid, false)
  const preflight = response.result.preflight as ReturnType<typeof filmPreflight>
  assert.ok(preflight.errors.some((entry) => entry.message.vi && entry.message.en))
  assert.equal((await readUnifiedProject(projectId)).revision, before.revision)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: before.revision + 1,
    command: 'film.preflight', args: {} }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT')
})
