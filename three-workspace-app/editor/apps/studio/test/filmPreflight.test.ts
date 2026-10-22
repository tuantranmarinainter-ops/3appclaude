import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Matrix4 } from 'three'
import { makeEmptyDraft } from '@topview/3d-builder'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { filmPreflight, filmSeriesPreflight } from '../src/filmPreflight.ts'
import type { FilmSeriesSegment } from '../src/filmSeries.ts'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore.ts'
import { stageAssetUpload } from '../src/unifiedAssetFiles.ts'
import { inspectProjectFilm, preflightProjectFilm } from '../src/unifiedFilmSampling.ts'
import { makeSceneReviewShot } from '../src/sceneReview.ts'

const projectsDir = mkdtempSync(path.join(tmpdir(), 'bbs-film-preflight-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = projectsDir
test.after(() => rmSync(projectsDir, { recursive: true, force: true }))
const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const builtin = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

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

test('pure preflight reports unapproved shots, missing files, selected backdrop transforms, and overlapping VFX', () => {
  const project = projectFixture()
  project.extensions.sceneReview = { version: 1, sequenceId: 'sequence-1', shots: {
    'shot-1': makeSceneReviewShot(project, 'sequence-1', 'shot-1', 'ok', ''),
  } }
  const stale = structuredClone(project)
  stale.scene.content.nodes.find((node) => node.id === 'actor-node')!.transform.position.x = 2
  stale.extensions.vfxCues = { version: 1, cues: [{ id: 'cue-1', effect: 'aura01', frameStart: 1, frameEnd: 8 }] }
  const result = filmPreflight(stale, { ...args, assetAvailability: { 'sha256:asset': false } })
  assert.ok(result.errors.some((entry) => entry.code === 'CHARACTER_TRANSFORM_UNAVAILABLE'))
  assert.ok(result.errors.some((entry) => entry.code === 'ASSET_FILE_MISSING'))
  assert.ok(result.warnings.some((entry) => entry.code === 'SHOT_NOT_APPROVED' && entry.clipId === 'shot-1'))
  assert.ok(result.warnings.some((entry) => entry.code === 'VFX_BBS_MISSING' && entry.clipId === 'cue-1'))
  const approved = filmPreflight(project, { ...args, footSamples: { actor: [{ frame: 0, leftY: 0, rightY: 0, actorWorldMatrix: new Matrix4().toArray() }] } })
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

test('transform preflight reports shear and scale separately for one actor', () => {
  const project = projectFixture()
  const matrix = new Matrix4().makeScale(2, 1, 1); matrix.elements[4] = 0.25
  const report = filmPreflight(project, { ...args, footSamples: { actor: [{ frame: 2, actorWorldMatrix: matrix.toArray() }] } })
  assert.ok(report.errors.some((entry) => entry.code === 'CHARACTER_TRANSFORM_SHEAR' && entry.frame === 2))
  assert.ok(report.errors.some((entry) => entry.code === 'CHARACTER_TRANSFORM_SCALE' && entry.frame === 2))
})

async function validProject(options: { endFrame: number; cameraCount: number; characterCount: number }) {
  const scene = makeEmptyDraft('Film preflight valid', 30, options.endFrame, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Film preflight valid', scene } })
  const projectId = String(created.projectId)
  const staged = await stageAssetUpload('preflight.glb', new ReadableStream({ start(controller) { controller.enqueue(readFileSync(builtin)); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [staged.id], format: 'glb' } })
  const assetId = (imported.result.assetIds as string[])[0]!, skeletonId = (imported.result.skeletonIds as string[])[0]!
  let revision = imported.revision
  const characterIds: string[] = []
  for (let index = 0; index < options.characterCount; index++) {
    const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'character.add', args: { assetId, skeletonId, name: `Actor ${index + 1}` } })
    characterIds.push(String(added.result.characterId)); revision = added.revision
  }
  const current = await readUnifiedProject(projectId)
  const updatedScene = structuredClone(current.scene)
  const clips = []
  const segmentLength = (options.endFrame + 1) / options.cameraCount
  for (let index = 0; index < options.cameraCount; index++) {
    let camera = structuredClone(updatedScene.content.nodes.find((node) => node.id === 'camera_1')!)
    if (index > 0) { camera.id = `camera_${index + 1}`; camera.name = `Camera ${index + 1}`; camera.camera!.isPrimary = false; updatedScene.content.nodes.push(camera) }
    clips.push({ id: `shot-${index + 1}`, cameraNodeId: camera.id, sourceFrameStart: index * segmentLength, sourceFrameEnd: (index + 1) * segmentLength - 1 })
  }
  updatedScene.content.editorial = { version: 1, activeSequenceId: 'sequence-valid', sequences: [{ id: 'sequence-valid', clips }] }
  const applied = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: updatedScene, fcurves: current.extensions.topview?.fcurves ?? null }] } })
  return { project: await readUnifiedProject(projectId), characterIds, revision: applied.revision }
}

test('clean valid project has no blocking preflight issues and limits aggregate together', async () => {
  const clean = await validProject({ endFrame: 29, cameraCount: 1, characterCount: 1 })
  const actor = clean.project.characters[clean.characterIds[0]!]!
  const good = filmPreflight(clean.project, { characterIds: clean.characterIds, sequenceId: 'sequence-valid', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 16 / 9,
    assetAvailability: { [actor.assetId]: true }, footSamples: { [actor.id]: [{ frame: 0, leftY: 0, rightY: 0, actorWorldMatrix: new Matrix4().toArray() }] } })
  assert.deepEqual(good.errors, [])

  const overloaded = await validProject({ endFrame: 599, cameraCount: 4, characterCount: 2 })
  const report = filmPreflight(overloaded.project, { characterIds: overloaded.characterIds, sequenceId: 'sequence-valid', range: { startFrame: 0, endFrame: 599 }, viewportAspect: 16 / 9 })
  assert.ok(report.errors.some((entry) => entry.code === 'FILM_TICK_LIMIT'))
  assert.ok(report.errors.some((entry) => entry.code === 'FILM_CAMERA_LIMIT'))
  assert.ok(report.errors.some((entry) => entry.code === 'FILM_BONE_BUDGET'))
})

test('selected prop bone budget uses supplied source-profile evidence and blocks unknown counts', async () => {
  const clean = await validProject({ endFrame: 362, cameraCount: 1, characterCount: 1 })
  const project = structuredClone(clean.project)
  const character = project.characters[clean.characterIds[0]!]!
  project.scene.content.nodes.push({ id: 'prop-budget', type: 'prop', name: 'Backdrop', visible: true, locked: false,
    metadata: { assetId: character.assetId }, prop: { category: 'user' }, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } as never)
  const args = { characterIds: clean.characterIds, sequenceId: 'sequence-valid', range: { startFrame: 0, endFrame: 362 }, viewportAspect: 16 / 9,
    propIds: ['prop-budget'], assetAvailability: { [character.assetId]: true }, footSamples: { [character.id]: [{ frame: 0, leftY: 0, rightY: 0, actorWorldMatrix: new Matrix4().toArray() }] } }
  assert.equal(preflightProjectFilm(project, args).models.length, 1)
  assert.ok(filmPreflight(project, args).errors.some((entry) => entry.code === 'FILM_PROP_BONE_COUNT_UNAVAILABLE'))
  const withKnownCount = filmPreflight(project, { ...args, propBoneCounts: { [character.assetId]: 500 } })
  assert.ok(withKnownCount.errors.some((entry) => entry.code === 'FILM_BONE_BUDGET'), JSON.stringify(withKnownCount.errors))
})

test('invalid backdrop transforms do not suppress valid Character models or aggregate bone-budget errors', async () => {
  const clean = await validProject({ endFrame: 599, cameraCount: 4, characterCount: 2 })
  const project = structuredClone(clean.project)
  const character = project.characters[clean.characterIds[0]!]!
  project.scene.content.nodes.push({ id: 'invalid-backdrop', type: 'prop', name: 'Scaled backdrop', visible: true, locked: false,
    metadata: { assetId: character.assetId }, prop: { category: 'user' }, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 1 } } } as never)
  const args = { content: 'both', characterIds: clean.characterIds, propIds: ['invalid-backdrop'], sequenceId: 'sequence-valid',
    range: { startFrame: 0, endFrame: 599 }, viewportAspect: 16 / 9 }
  const inspection = inspectProjectFilm(project, args)
  assert.equal(inspection.models.length, clean.characterIds.length)
  assert.ok(!inspection.issues.some((entry) => entry.code === 'CHARACTER_SELECTION_INVALID'))
  const report = filmPreflight(project, args)
  assert.ok(report.errors.some((entry) => entry.code === 'PROP_TRANSFORM_INVALID'))
  assert.ok(report.errors.some((entry) => entry.code === 'FILM_BONE_BUDGET'))
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

test('single film preflight with an omitted range stays structured when selected actors have motion clips', async () => {
  const clean = await validProject({ endFrame: 29, cameraCount: 1, characterCount: 1 })
  const character = clean.project.characters[clean.characterIds[0]!]!
  const scene = structuredClone(clean.project.scene)
  scene.content.timeline.animation.motionClips.push({ id: 'range-regression-motion', source: 'library', sourceDuration: 1,
    frameStart: 0, frameEnd: 20, target: { type: 'character', nodeId: character.nodeId },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none' },
    motion: { assetId: 'range-regression-motion-asset', name: 'Walk', source: 'library', sourceRig: 'mixamorig', url: 'walk.fbx', inPlace: true, loop: false, speed: 1, time: 0 } } as never)
  const saved = await executeUnifiedCommand({ requestId: randomUUID(), projectId: clean.project.projectId, expectedRevision: clean.revision,
    command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: scene, fcurves: clean.project.extensions.topview?.fcurves ?? null }] } })
  const response = await executeUnifiedCommand({ requestId: randomUUID(), projectId: clean.project.projectId, expectedRevision: saved.revision,
    command: 'film.preflight', args: { characterIds: clean.characterIds, sequenceId: 'sequence-valid' } })
  assert.equal(response.result.valid, false)
  assert.ok((response.result.preflight as FilmPreflightResult).errors.some((entry) => entry.code === 'FILM_RANGE_INVALID'))
})

test('series preflight checks each planned segment and tags a single oversized shot with its segment', async () => {
  const long = await validProject({ endFrame: 599, cameraCount: 1, characterCount: 1 })
  const bad = await executeUnifiedCommand({ requestId: randomUUID(), projectId: long.project.projectId, expectedRevision: long.revision,
    command: 'film.preflight', args: { mode: 'series', content: 'characters', characterIds: long.characterIds, propIds: [], sequenceId: 'sequence-valid' } })
  const badResult = bad.result.preflight as FilmPreflightResult
  assert.equal(bad.result.valid, false)
  assert.ok(badResult.errors.some((entry) => entry.code === 'FILM_TICK_LIMIT' && entry.segment === 1 && entry.nodeId === undefined))
  assert.ok(!badResult.errors.some((entry) => entry.code === 'FILM_SERIES_PLAN_INVALID'))

  const split = await validProject({ endFrame: 599, cameraCount: 4, characterCount: 1 })
  const good = await executeUnifiedCommand({ requestId: randomUUID(), projectId: split.project.projectId, expectedRevision: split.revision,
    command: 'film.preflight', args: { mode: 'series', content: 'characters', characterIds: split.characterIds, propIds: [], sequenceId: 'sequence-valid' } })
  const goodResult = good.result.preflight as FilmPreflightResult
  assert.equal(good.result.valid, true, JSON.stringify(goodResult.errors))
  assert.equal((good.result.segments as Array<{ segment: number }>).length, 2)
  assert.ok(!goodResult.errors.some((entry) => entry.code === 'FILM_TICK_LIMIT'))
  assert.equal(goodResult.warnings.every((entry) => entry.segment === 1 || entry.segment === 2), true)
})

test('series preflight keeps a middle planning failure and a later independent segment error', () => {
  const project = projectFixture()
  const segments: FilmSeriesSegment[] = [1, 2, 3].map((order) => ({
    order,
    range: { startFrame: 0, endFrame: 29 },
    ticks: 20,
    shots: [],
    project,
    exportArgs: { ...args, content: 'characters', propIds: [] },
    planningIssues: order === 2 ? [{ code: 'CAMERA_EVALUATION_UNAVAILABLE', message: 'camera samples unavailable' }] : [],
  }))
  const report = filmSeriesPreflight(segments, new Map([[3, { assetAvailability: { 'sha256:asset': false } }]]))
  assert.ok(report.errors.some((entry) => entry.code === 'FILM_SERIES_CAMERA_EVALUATION_UNAVAILABLE' && entry.segment === 2))
  assert.ok(report.errors.some((entry) => entry.code === 'ASSET_FILE_MISSING' && entry.segment === 3))
})
