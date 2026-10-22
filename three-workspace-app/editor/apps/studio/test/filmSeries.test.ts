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
import { FILM_SERIES_ARCHIVE_SCRIPT, planFilmSeries } from '../src/filmSeries'
import { getUnifiedJob, startUnifiedFilmSeriesExport } from '../src/unifiedJobs'

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
  assert.equal(dry.result.segmentCount, 7)
  assert.equal((dry.result.series as Array<{ order: number }>).at(-1)?.order, 7)
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, dryRun: true, command: 'scene.export.bbsFilmSeries', args: {
    sequenceId: 'episode', characterIds: [characterId], name: 'episode', content: 'backdrops',
  } }), /not available yet/)
})

test('film series rejects a shot that exceeds one worker segment without splitting it', async () => {
  const { projectId, characterId } = await twentyShotProject()
  const project = await readUnifiedProject(projectId)
  const sequence = project.scene.content.editorial!.sequences[0]!
  sequence.clips = [{ ...sequence.clips[0]!, sourceFrameStart: 0, sourceFrameEnd: 389 }]
  assert.throws(() => planFilmSeries(project, { sequenceId: 'episode', characterIds: [characterId], viewportAspect: 16 / 9 }), /Shot shot-01 exceeds a single Film worker segment.*cut the shot shorter/)
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
})
