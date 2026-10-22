import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { FILM_SERIES_ARCHIVE_SCRIPT, planFilmSeries, planFilmSeriesWithCameraSamples } from '../src/filmSeries'
import { cancelUnifiedJob, getUnifiedJob, startUnifiedFilmSeriesExport } from '../src/unifiedJobs'

const editor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const temp = mkdtempSync(path.join(tmpdir(), 'film-series-'))
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
test.after(() => rmSync(temp, { recursive: true, force: true }))
const builtin = path.join(editor, '../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')

async function twentyShotProject() {
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: {
    name: 'Twenty shots', scene: makeEmptyDraft('Twenty shots', 30, 1199, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } }),
  } })
  const projectId = String(created.result.projectId)
  const staged = await stageAssetUpload('builtin.glb', new ReadableStream({ start(c) { c.enqueue(readFileSync(builtin)); c.close() } }))
  const model = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [staged.id], format: 'glb' } })
  const assetId = (model.result.assetIds as string[])[0]!, skeletonId = (model.result.skeletonIds as string[])[0]!
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: model.revision, command: 'character.add', args: { assetId, skeletonId, name: 'Actor' } })
  const project = await readUnifiedProject(projectId), scene = structuredClone(project.scene)
  scene.content.editorial = { version: 1, activeSequenceId: 'episode', sequences: [{ id: 'episode', clips: Array.from({ length: 20 }, (_, index) => ({
    id: `shot-${String(index + 1).padStart(2, '0')}`, cameraNodeId: 'camera_1', sourceFrameStart: index * 60, sourceFrameEnd: index * 60 + 59,
  })) }] }
  const applied = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: added.revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: scene, fcurves: project.extensions.topview?.fcurves ?? null }],
  } })
  return { projectId, revision: applied.revision, characterId: String(added.result.characterId) }
}

test('film series groups 20 whole shots into seven worker-sized segments', async () => {
  const { projectId, characterId, revision } = await twentyShotProject()
  const project = await readUnifiedProject(projectId)
  const plan = planFilmSeries(project, { sequenceId: 'episode', characterIds: [characterId], viewportAspect: 16 / 9 })
  assert.equal(plan.length, 7)
  assert.deepEqual(plan.map((segment) => segment.shots.length), [3, 3, 3, 3, 3, 3, 2])
  assert.deepEqual(plan.map((segment) => segment.ticks), [120, 120, 120, 120, 120, 120, 80])
  assert.deepEqual(plan.flatMap((segment) => segment.shots.map((shot) => shot.id)), Array.from({ length: 20 }, (_, index) => `shot-${String(index + 1).padStart(2, '0')}`))
  assert.deepEqual(plan.map((segment) => [segment.range.startFrame, segment.range.endFrame]), [[0, 179], [180, 359], [360, 539], [540, 719], [720, 899], [900, 1079], [1080, 1199]])
  const dry = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, dryRun: true, command: 'scene.export.bbsFilmSeries', args: {
    sequenceId: 'episode', characterIds: [characterId], name: 'episode', content: 'characters',
  } })
  assert.equal(dry.result.valid, true)
  assert.equal(dry.result.content, 'characters')
  assert.equal(dry.result.segmentCount, 7)
  assert.equal((dry.result.series as Array<{ order: number }>).at(-1)?.order, 7)
  const propAdded = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'prop.add', args: {
    assetId: project.characters[characterId]!.assetId, name: 'Episode backdrop',
  } })
  const propId = String(propAdded.result.nodeId)
  const both = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: propAdded.revision, dryRun: true, command: 'scene.export.bbsFilmSeries', args: {
    sequenceId: 'episode', characterIds: [characterId], name: 'episode-both', content: 'both',
  } })
  assert.equal(both.result.content, 'both')
  assert.deepEqual(both.result.characterIds, [characterId])
  assert.deepEqual(both.result.propIds, [propId])
  const backdrops = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: propAdded.revision, dryRun: true, command: 'scene.export.bbsFilmSeries', args: {
    sequenceId: 'episode', name: 'episode-backdrops', content: 'backdrops',
  } })
  assert.equal(backdrops.result.content, 'backdrops')
  assert.deepEqual(backdrops.result.characterIds, [])
  assert.deepEqual(backdrops.result.propIds, [propId])
  assert.equal(backdrops.result.segmentCount, 7)
})

test('film series retains an over-budget whole shot as a segment-level planning issue', async () => {
  const { projectId, characterId } = await twentyShotProject()
  const project = await readUnifiedProject(projectId)
  const sequence = project.scene.content.editorial!.sequences[0]!
  sequence.clips = [{ ...sequence.clips[0]!, sourceFrameStart: 0, sourceFrameEnd: 389 }]
  assert.throws(() => planFilmSeries(project, { sequenceId: 'episode', characterIds: [characterId], propIds: [], viewportAspect: 16 / 9 }), /Shot shot-01 exceeds a single Film worker segment.*cut the shot shorter/)
  const plan = planFilmSeries(project, { sequenceId: 'episode', characterIds: [characterId], propIds: [], viewportAspect: 16 / 9 }, [], new Map(), { retainInvalidSingles: true })
  assert.equal(plan.length, 1)
  assert.equal(plan[0]!.shots[0]!.id, 'shot-01')
  assert.ok(plan[0]!.planningIssues.some((item) => item.code === 'TICK_LIMIT'))
})

test('film series respects the exact 255-tick and bone-sample boundaries', async () => {
  const { projectId, characterId } = await twentyShotProject()
  let project = await readUnifiedProject(projectId)
  project.scene.content.timeline.fps = 20
  const sequence = project.scene.content.editorial!.sequences[0]!
  sequence.clips = [
    { ...sequence.clips[0]!, id: 'max-tick-shot', sourceFrameStart: 0, sourceFrameEnd: 254 },
    { ...sequence.clips[1]!, id: 'over-max-shot', sourceFrameStart: 255, sourceFrameEnd: 255 },
  ]
  const tickBounded = planFilmSeries(project, { sequenceId: 'episode', characterIds: [characterId], propIds: [], viewportAspect: 16 / 9 })
  assert.deepEqual(tickBounded.map((segment) => segment.ticks), [255, 1])

  const original = project.characters[characterId]!
  const characterIds = [characterId]
  const boneCount = () => characterIds.reduce((sum, id) => sum + project.skeletons[project.characters[id]!.skeletonId]!.bones.length, 0)
  let revision = project.revision
  while (boneCount() <= 128) {
    const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'character.add', args: {
      assetId: original.assetId, skeletonId: original.skeletonId, name: `Boundary actor ${characterIds.length + 1}`,
    } })
    characterIds.push(String(added.result.characterId))
    revision = added.revision
    project = await readUnifiedProject(projectId)
  }
  const totalBones = boneCount()
  const maxBoneTicks = Math.floor(32768 / totalBones) - 1
  assert.ok(maxBoneTicks > 0 && maxBoneTicks < 255)
  assert.ok(totalBones * (maxBoneTicks + 1) <= 32768)
  assert.ok(totalBones * (maxBoneTicks + 2) > 32768)
  project.scene.content.timeline.fps = 20
  const boneSequence = project.scene.content.editorial!.sequences[0]!
  boneSequence.clips = [
    { ...boneSequence.clips[0]!, id: 'bone-budget-shot', sourceFrameStart: 0, sourceFrameEnd: maxBoneTicks - 1 },
    { ...boneSequence.clips[1]!, id: 'over-budget-shot', sourceFrameStart: maxBoneTicks, sourceFrameEnd: maxBoneTicks },
  ]
  const boneBounded = planFilmSeries(project, { sequenceId: 'episode', characterIds, propIds: [], viewportAspect: 16 / 9 })
  assert.deepEqual(boneBounded.map((segment) => segment.ticks), [maxBoneTicks, 1])
  const singleOverBudget = structuredClone(project)
  singleOverBudget.scene.content.editorial!.sequences[0]!.clips = [{ ...boneSequence.clips[0]!, id: 'single-over-budget', sourceFrameStart: 0, sourceFrameEnd: maxBoneTicks }]
  const invalidSingle = planFilmSeries(singleOverBudget, { sequenceId: 'episode', characterIds, propIds: [], viewportAspect: 16 / 9 }, [], new Map(), { retainInvalidSingles: true })
  assert.ok(invalidSingle[0]!.planningIssues.some((item) => item.code === 'BONE_BUDGET'), JSON.stringify(invalidSingle[0]!.planningIssues))
})

test('auto selection resolves only actors with segment motion keys or camera targets and preserves explicit overrides', async () => {
  const { projectId } = await twentyShotProject()
  let project = await readUnifiedProject(projectId)
  const actorIds = Object.keys(project.characters)
  let revision = project.revision
  for (let index = 1; index < 7; index++) {
    const first = project.characters[actorIds[0]!]!
    const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'character.add', args: {
      assetId: first.assetId, skeletonId: first.skeletonId, name: `Scene actor ${index + 1}`,
    } })
    actorIds.push(String(added.result.characterId)); revision = added.revision; project = await readUnifiedProject(projectId)
  }
  project.scene.content.editorial!.sequences[0]!.clips = Array.from({ length: 6 }, (_, index) => ({
    id: `scene-${index + 1}`, cameraNodeId: 'camera_1', sourceFrameStart: index * 30, sourceFrameEnd: index * 30 + 29,
  }))
  const camera = project.scene.content.nodes.find((node) => node.id === 'camera_1')!
  camera.camera!.lookAtTarget = { nodeId: project.characters[actorIds[5]!]!.nodeId }
  project.extensions.topview = { ...project.extensions.topview, fcurves: { version: 1, encoding: 'compact-v1', fcurves: [
    ...actorIds.slice(0, 4).flatMap((id, index) => {
      const nodeId = project.characters[id]!.nodeId
      const frame = index * 30 + 12
      return ['transform.position', 'transform.rotation'].map((property, component) => ({ id: `actor-${index}-${property}-${component}`, t: ['node', nodeId], p: property,
        i: component, k: [[frame, component === 1 ? 45 : 0, 'linear', `key-${index}-${property}-${component}`]] }))
    }),
  ], userKeys: { [project.characters[actorIds[4]!]!.nodeId]: { rotation: [{ id: 'sidecar-rotation', frame: 132, value: [0, 25, 0], interpolation: 'linear' }] } } } }
  const auto = planFilmSeries(project, { sequenceId: 'episode', characterIds: 'auto', propIds: [], viewportAspect: 16 / 9 })
  assert.equal(auto.length, 2)
  assert.deepEqual(auto.map((segment) => segment.exportArgs.characterIds), [
    [...actorIds.slice(0, 3), actorIds[5]!], actorIds.slice(3, 6),
  ])
  const explicit = planFilmSeries(project, { sequenceId: 'episode', characterIds: [actorIds[0]!, actorIds[6]!], propIds: [], viewportAspect: 16 / 9 })
  assert.deepEqual(explicit.map((segment) => segment.exportArgs.characterIds), Array.from({ length: auto.length }, () => [actorIds[0], actorIds[6]]))
  const saved = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: project.revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: project.scene, fcurves: project.extensions.topview?.fcurves ?? null }],
  } })
  const preflight = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: saved.revision, command: 'film.preflight', args: {
    mode: 'series', content: 'characters', characterIds: 'auto', propIds: [], sequenceId: 'episode',
  } })
  assert.deepEqual((preflight.result.segments as Array<{ characterIds: string[] }>).map((segment) => segment.characterIds), [
    [...actorIds.slice(0, 3), actorIds[5]!], actorIds.slice(3, 6),
  ])
  assert.equal(preflight.result.valid, true, JSON.stringify((preflight.result.preflight as { errors: unknown[] }).errors))
  const defaultExport = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: saved.revision, dryRun: true, command: 'scene.export.bbsFilmSeries', args: {
    sequenceId: 'episode', name: 'auto-default',
  } })
  assert.equal(defaultExport.result.valid, true)
  assert.deepEqual((defaultExport.result.segments as Array<{ characterIds: string[] }>).map((segment) => segment.characterIds),
    (preflight.result.segments as Array<{ characterIds: string[] }>).map((segment) => segment.characterIds))
  const withMotion = structuredClone(project)
  withMotion.scene.content.timeline.animation.motionClips.push({ id: 'motion-only-auto-actor', source: 'library', sourceDuration: 1,
    frameStart: 150, frameEnd: 160, target: { type: 'character', nodeId: withMotion.characters[actorIds[6]!]!.nodeId },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none' },
    motion: { assetId: 'motion-only-fixture', name: 'Walk', source: 'library', sourceRig: 'mixamorig', url: 'walk.fbx', inPlace: true, loop: false, speed: 1, time: 0 } } as never)
  const motionAuto = planFilmSeries(withMotion, { sequenceId: 'episode', characterIds: 'auto', propIds: [], viewportAspect: 16 / 9 })
  assert.ok(motionAuto[1]!.exportArgs.characterIds.includes(actorIds[6]!))
})

test('auto props use 20 Hz moving camera samples and include the exact 60 m boundary', async () => {
  const { projectId, characterId, revision } = await twentyShotProject()
  let currentRevision = revision
  const propIds: string[] = []
  for (const name of ['inside', 'boundary', 'outside']) {
    const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: currentRevision, command: 'prop.add', args: {
      assetId: (await readUnifiedProject(projectId)).characters[characterId]!.assetId, name,
    } })
    propIds.push(String(added.result.nodeId)); currentRevision = added.revision
  }
  const project = await readUnifiedProject(projectId)
  const scene = structuredClone(project.scene)
  const camera = scene.content.nodes.find((node) => node.id === 'camera_1')!
  const props = scene.content.nodes.filter((node) => propIds.includes(node.id))
  props[0]!.transform.position.x = 159.9
  props[1]!.transform.position.x = 160
  props[2]!.transform.position.x = 160.1
  for (const prop of props) { prop.transform.position.y = 2; prop.transform.position.z = 4 }
  const fcurves = [0, 1, 2].map((component) => ({ id: `camera-pos-${component}`, t: ['node', camera.id], p: 'transform.position', i: component,
    k: [[0, component === 0 ? 1 : component === 1 ? 2 : 4, 'linear', `start-${component}`], [29, component === 0 ? 100 : component === 1 ? 2 : 4, 'linear', `end-${component}`]] }))
  project.scene = scene
  project.extensions.topview = { ...project.extensions.topview, fcurves: { version: 1, encoding: 'compact-v1', fcurves } }
  const plan = await planFilmSeriesWithCameraSamples(project, { sequenceId: 'episode', characterIds: [characterId], propIds: 'auto', content: 'both', viewportAspect: 16 / 9 })
  assert.deepEqual(plan[0]!.exportArgs.propIds, propIds.slice(0, 2), JSON.stringify(plan[0]!.planningIssues))
  assert.ok(!plan[0]!.planningIssues.some((item) => item.code === 'CAMERA_EVALUATION_UNAVAILABLE'))
  const explicit = planFilmSeries(project, { sequenceId: 'episode', characterIds: [characterId], propIds: [propIds[2]!], content: 'both', viewportAspect: 16 / 9 })
  assert.deepEqual(explicit[0]!.exportArgs.propIds, [propIds[2]])
  const all = planFilmSeries(project, { sequenceId: 'episode', characterIds: [characterId], propIds: 'all', content: 'both', viewportAspect: 16 / 9 })
  assert.deepEqual(all[0]!.exportArgs.propIds, propIds)
})

test('series commands reject unknown and duplicate auto-selection values', async () => {
  const { projectId, characterId } = await twentyShotProject()
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilmSeries', args: {
    sequenceId: 'episode', characterIds: 'everything',
  } }), /characterIds must be a unique ID array or "auto"/)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilmSeries', args: {
    sequenceId: 'episode', characterIds: [characterId, characterId],
  } }), /characterIds must be a unique ID array or "auto"/)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilmSeries', args: {
    sequenceId: 'episode', characterIds: [characterId], propIds: 'nearby', content: 'both',
  } }), /propIds must be a unique ID array, "all", or "auto"/)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'film.preflight', args: {
    mode: 'series', sequenceId: 'episode', characterIds: 'nearby',
  } }), /film\.preflight accepts mode/)
})

test('middle segment failure keeps the parent reservation and leaves no partial series ZIP', async () => {
  const { projectId, characterId } = await twentyShotProject()
  const project = await readUnifiedProject(projectId)
  const segments = planFilmSeries(project, { sequenceId: 'episode', characterIds: [characterId], viewportAspect: 16 / 9 })
  const python = process.env.BBS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')
  const zipSource = "import io,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('films/source.dat',b'fake-film'); z.writestr('assets/models/shared/model.bobj',b'same'); z.close(); sys.stdout.buffer.write(b.getvalue())"
  const fakeZip = spawnSync(python, ['-c', zipSource]).stdout
  let release!: () => void
  let startedSecond!: () => void
  const secondReached = new Promise<void>((resolve) => { startedSecond = resolve })
  const holdSecond = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  const runner = async () => {
    calls++
    if (calls === 1) return fakeZip
    if (calls === 2) {
      startedSecond()
      await holdSecond
      throw new Error('fake second segment failure')
    }
    throw new Error('series continued after a failed segment')
  }
  const started = await startUnifiedFilmSeriesExport(project, { name: 'episode', segments }, runner)
  await secondReached
  await assert.rejects(startUnifiedFilmSeriesExport(project, { name: 'other', segments }, runner), /already active/)
  release()
  let job = await getUnifiedJob(started.jobId, projectId)
  for (let attempt = 0; attempt < 20 && (job.state === 'queued' || job.state === 'running'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    job = await getUnifiedJob(started.jobId, projectId)
  }
  assert.equal(job.state, 'failed')
  assert.equal(job.result, undefined)
  assert.equal(calls, 2)
  const root = path.join(process.env.BBS_UNIFIED_PROJECTS_DIR!, projectId, '.jobs', started.jobId)
  assert.equal(existsSync(path.join(root, 'files')), false)
  assert.equal(existsSync(path.join(root, 'film-series-work')), false)
  assert.deepEqual(readdirSync(root), ['job.json'])
})

test('cancelling a series aborts its active segment, releases the reservation, and cleans staging', async () => {
  const { projectId, characterId } = await twentyShotProject()
  const project = await readUnifiedProject(projectId)
  const segments = planFilmSeries(project, { sequenceId: 'episode', characterIds: [characterId], viewportAspect: 16 / 9 })
  let reachedRunner!: () => void
  const runnerReached = new Promise<void>((resolve) => { reachedRunner = resolve })
  const runner = (_project: unknown, _args: unknown, signal: AbortSignal) => new Promise<Buffer>((_resolve, reject) => {
    reachedRunner()
    signal.addEventListener('abort', () => reject(new Error('segment aborted')), { once: true })
  })
  const started = await startUnifiedFilmSeriesExport(project, { name: 'episode', segments }, runner)
  await runnerReached
  const cancelled = await cancelUnifiedJob(started.jobId, projectId)
  assert.deepEqual(cancelled, { state: 'cancelled', committed: false })
  const job = await getUnifiedJob(started.jobId, projectId)
  assert.equal(job.result, undefined)
  const root = path.join(process.env.BBS_UNIFIED_PROJECTS_DIR!, projectId, '.jobs', started.jobId)
  assert.equal(existsSync(path.join(root, 'files')), false)
  assert.equal(existsSync(path.join(root, 'film-series-work')), false)
  assert.deepEqual(readdirSync(root), ['job.json'])

  const next = await startUnifiedFilmSeriesExport(project, { name: 'next', segments }, async () => { throw new Error('reservation was released') })
  assert.ok(next.jobId)
  let nextJob = await getUnifiedJob(next.jobId, projectId)
  for (let attempt = 0; attempt < 20 && (nextJob.state === 'queued' || nextJob.state === 'running'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    nextJob = await getUnifiedJob(next.jobId, projectId)
  }
  assert.equal(nextJob.state, 'failed')
})

test('series ZIP includes ordered films and series metadata, deduplicates identical assets, and rejects conflicting names', () => {
  const python = process.env.BBS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')
  const fixture = path.join(temp, 'fake-package.py')
  writeFileSync(fixture, `import json,sys,zipfile\nfor index,spec in enumerate(json.loads(sys.argv[1])):\n  with zipfile.ZipFile(spec[0], 'w') as z:\n    z.writestr('films/source.dat', spec[1])\n    z.writestr('effects.json', json.dumps([{'effect':'spark','startTick':3+index,'endTick':5+index}]))\n    z.writestr(spec[3] if len(spec)>3 else 'assets/models/shared/model.bobj', b'same' if spec[2] == 'same' else spec[2].encode())\n`)
  const fakeArchives = [path.join(temp, 'first.zip'), path.join(temp, 'second.zip')]
  assert.equal(spawnSync(python, [fixture, JSON.stringify([[fakeArchives[0], 'film1', 'same'], [fakeArchives[1], 'film2', 'same']])]).status, 0)
  const specPath = path.join(temp, 'input.json'), readme = path.join(temp, 'README.txt')
  const output = path.join(temp, 'series-output'), archive = path.join(temp, 'series.zip')
  const segments = fakeArchives.map((zip, index) => ({ zip, film: `episode-0${index + 1}.dat` }))
  writeFileSync(specPath, JSON.stringify({ segments, series: [
    { order: 1, film: 'films/episode-01.dat', shots: ['shot-a'], startFrame: 0, endFrame: 29, ticks: 20 },
    { order: 2, film: 'films/episode-02.dat', shots: ['shot-b'], startFrame: 30, endFrame: 59, ticks: 20 },
  ] }))
  writeFileSync(readme, 'BBS FS 2.7 install instructions')
  const assembled = spawnSync(python, ['-c', FILM_SERIES_ARCHIVE_SCRIPT, specPath, output, readme, archive], { encoding: 'utf8' })
  assert.equal(assembled.status, 0, assembled.stderr)
  const inspect = spawnSync(python, ['-c', "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'names':sorted(z.namelist()),'series':json.loads(z.read('series.json')),'effects':json.loads(z.read('effects.json')),'first':z.read('films/episode-01.dat').decode(),'second':z.read('films/episode-02.dat').decode(),'asset':z.read('assets/models/shared/model.bobj').decode(),'readme':z.read('README.txt').decode()}))", archive], { encoding: 'utf8' })
  assert.equal(inspect.status, 0, inspect.stderr)
  const contents = JSON.parse(inspect.stdout)
  assert.deepEqual(contents.series.map((item: { order: number }) => item.order), [1, 2])
  assert.deepEqual(contents.effects, { 'films/episode-01.dat': [{ effect: 'spark', startTick: 3, endTick: 5 }], 'films/episode-02.dat': [{ effect: 'spark', startTick: 4, endTick: 6 }] })
  assert.deepEqual(contents.names.filter((name: string) => name.endsWith('.dat')), ['films/episode-01.dat', 'films/episode-02.dat'])
  assert.equal(contents.first, 'film1')
  assert.equal(contents.second, 'film2')
  assert.equal(contents.asset, 'same')
  assert.match(contents.readme, /BBS FS 2.7/)
  assert.equal(contents.names.filter((name: string) => name === 'assets/models/shared/model.bobj').length, 1)

  const conflicting = path.join(temp, 'conflicting.json'), failedOutput = path.join(temp, 'conflict-output'), failedZip = path.join(temp, 'conflict.zip')
  writeFileSync(conflicting, JSON.stringify({ segments: fakeArchives.map((zip, index) => ({ zip, film: `take-0${index + 1}.dat` })), series: [] }))
  const conflict = spawnSync(python, [fixture, JSON.stringify([[fakeArchives[0], 'film1', 'same'], [fakeArchives[1], 'film2', 'different', 'assets/Models/SHARED/MODEL.BOBJ']])])
  assert.equal(conflict.status, 0)
  const rejected = spawnSync(python, ['-c', FILM_SERIES_ARCHIVE_SCRIPT, conflicting, failedOutput, readme, failedZip], { encoding: 'utf8' })
  assert.notEqual(rejected.status, 0)
  assert.equal(existsSync(failedZip), false)

  for (const [index, unsafeName] of [
    // Python's zipfile rewrites os.sep to '/' in member names on Windows, so the fixture cannot store a backslash there
    // (and the merger reading such a ZIP sees a plain nested path instead).
    ...(process.platform === 'win32' ? [] : [['single-backslash', 'assets/models\\sneaky/model.bobj'] as const]),
    ['nested-ntfs-stream', 'assets/models/foo:stream.bobj'],
    ['windows-device-name', 'assets/models/CON.bobj'],
  ] as const) {
    const unsafeSpec = path.join(temp, `unsafe-${index}.json`)
    const unsafeOutput = path.join(temp, `unsafe-${index}-output`)
    const unsafeArchive = path.join(temp, `unsafe-${index}.zip`)
    const fixtureResult = spawnSync(python, [fixture, JSON.stringify([
      [fakeArchives[0], 'film1', 'same', unsafeName],
      [fakeArchives[1], 'film2', 'same'],
    ])])
    assert.equal(fixtureResult.status, 0)
    writeFileSync(unsafeSpec, JSON.stringify({ segments, series: [] }))
    const unsafeResult = spawnSync(python, ['-c', FILM_SERIES_ARCHIVE_SCRIPT, unsafeSpec, unsafeOutput, readme, unsafeArchive], { encoding: 'utf8' })
    assert.notEqual(unsafeResult.status, 0, `merger accepted unsafe path ${JSON.stringify(unsafeName)}`)
    assert.match(unsafeResult.stderr, /Unsafe cross-platform Film package path/)
    assert.equal(existsSync(unsafeArchive), false)
  }
})
