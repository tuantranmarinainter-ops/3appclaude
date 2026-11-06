import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore.ts'
import { stageAssetUpload } from '../src/unifiedAssetFiles.ts'
import { getUnifiedJob, readUnifiedJobFile } from '../src/unifiedJobs.ts'
import { sampleProjectFilm } from '../src/unifiedFilmSampling.ts'
import { encodeWav16 } from '../src/audioCues.ts'

const sourcePath = process.env.BBS_FILM_E2E_FBX
const sourceBasis = [1, 0, 0, 0, 0, 1, 0, -1, 0]

test('film.export converts animated project Characters and reads back a native Film ZIP', { skip: sourcePath && existsSync(sourcePath) ? false : 'External FBX fixture missing; set BBS_FILM_E2E_FBX to an existing file' }, async () => {
  const bytes = await readFile(sourcePath!)
  const created = await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: {
    name: 'Film export integration', scene: makeEmptyDraft('Film export integration', 30, 29, { fov: 50, position: { x: 1, y: 2, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } }),
  } })
  const projectId = String(created.result.projectId)
  const upload = await stageAssetUpload('film-e2e.fbx', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'fbx', unitMeters: 1, basis: sourceBasis } })
  const assetId = String((imported.result.assetIds as string[])[0])
  const skeletonId = String((imported.result.skeletonIds as string[])[0])
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 1, command: 'character.add', args: { assetId, skeletonId, name: 'Film Actor' } })
  let revision = 2
  const second = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'character.add', args: { assetId, skeletonId, name: 'Film Actor 2' } })
  revision += 1
  const motionId = (imported.result.motionIds as string[] | undefined)?.[0]
  if (motionId) {
    for (const characterId of [String(added.result.characterId), String(second.result.characterId)]) {
      await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'motion.place', args: { motionId, characterId } })
      revision += 1
    }
  }
  const project = await readUnifiedProject(projectId)
  const scene = structuredClone(project.scene)
  const secondCamera = structuredClone(scene.content.nodes.find((node) => node.id === 'camera_1')!)
  secondCamera.id = 'camera_2'; secondCamera.name = 'Camera 2'; secondCamera.camera!.isPrimary = false
  secondCamera.transform.position.x += 2
  scene.content.nodes.push(secondCamera)
  scene.content.editorial = { version: 1, activeSequenceId: 'film-e2e-sequence', sequences: [{ id: 'film-e2e-sequence', clips: [
    { id: 'film-e2e-shot-1', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 14 },
    { id: 'film-e2e-shot-2', cameraNodeId: 'camera_2', sourceFrameStart: 15, sourceFrameEnd: 29 },
  ] }] }
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: scene, fcurves: project.extensions.topview?.fcurves ?? null }],
  } })
  revision += 1
  const characterIds = [String(added.result.characterId), String(second.result.characterId)]
  const args = { characterIds, sequenceId: 'film-e2e-sequence', range: { startFrame: 0, endFrame: 29 }, viewportAspect: 16 / 9 }
  if (motionId) {
    const sample = await sampleProjectFilm(await readUnifiedProject(projectId), args)
    assert.deepEqual(sample.models.map((model) => model.basisToScene), characterIds.map(() => sourceBasis))
    assert.equal(sample.cameras.length, 2, 'both camera cuts should produce worker shots')
    for (const characterId of characterIds) {
      const nodeId = project.characters[characterId]!.nodeId
      const first = sample.frames[0]!.skeletons.find((item) => item.nodeId === nodeId)!.bones
      const last = sample.frames.at(-1)!.skeletons.find((item) => item.nodeId === nodeId)!.bones
      assert.ok(first.some((bone, index) => bone.worldMatrix.some((value, element) => Math.abs(value - last[index]!.worldMatrix[element]!) > 1e-5)), 'placed source motion should change each sampled Character pose')
    }
  }
  const started = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'film.export', args: { ...args, filmName: 'film-e2e' } })
  const jobId = String(started.result.jobId)
  let job = await getUnifiedJob(jobId, projectId)
  for (let attempt = 0; attempt < 900 && (job.state === 'queued' || job.state === 'running'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    job = await getUnifiedJob(jobId, projectId)
  }
  assert.equal(job.state, 'succeeded', JSON.stringify(job))
  assert.equal(job.result?.provenance.durationTicks, 20)
  assert.equal(job.result?.provenance.filmAudioIncluded, false)
  const archive = job.result?.files.find((file) => file.mimeType === 'application/zip')
  assert.ok(archive)
  const downloaded = await readUnifiedJobFile(jobId, projectId, archive.id)
  assert.ok(downloaded)
  assert.deepEqual([...downloaded.bytes.subarray(0, 2)], [0x50, 0x4b])
  const inspect = (bytes: Buffer) => {
    const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import sys,zipfile,io,json,hashlib,wave; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); names=z.namelist(); m=json.loads(z.read("export-manifest.json")); a=m.get("audio",[]); w=wave.open(io.BytesIO(z.read(a[0]["path"]))) if a else None; print(json.dumps({"names":names,"audio":a,"hash":hashlib.sha256(z.read(a[0]["path"])).hexdigest() if a else None,"wav":[w.getframerate(),w.getnchannels(),w.getsampwidth(),w.getnframes()] if w else None}))'], { input: bytes, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout) as { names: string[]; audio: { path: string; sha256: string }[]; hash: string; wav: number[] }
  }
  assert.deepEqual(inspect(downloaded.bytes).audio, [])
  const tone = encodeWav16(Float32Array.from({ length: 48000 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / 48000)))
  const audioUpload = await stageAssetUpload('tone.wav', new ReadableStream({ start(controller) { controller.enqueue(tone); controller.close() } }))
  const importedAudio = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'asset.import', args: { files: [audioUpload.id], format: 'auto' } })
  revision++
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'audio.cue.add', args: { cue: { kind: 'sfx', assetId: (importedAudio.result.assetIds as string[])[0], frameStart: 0, gainDb: 0 } } })
  revision++
  const audioStarted = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'film.export', args: { ...args, filmName: 'film-e2e-audio' } })
  const audioJobId = String(audioStarted.result.jobId)
  let audioJob = await getUnifiedJob(audioJobId, projectId)
  for (let attempt = 0; attempt < 900 && (audioJob.state === 'queued' || audioJob.state === 'running'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); audioJob = await getUnifiedJob(audioJobId, projectId)
  }
  assert.equal(audioJob.state, 'succeeded', JSON.stringify(audioJob))
  assert.equal(audioJob.result?.provenance.filmAudioIncluded, true)
  const audioArchive = audioJob.result?.files.find((file) => file.mimeType === 'application/zip')
  assert.ok(audioArchive)
  const audioDownloaded = await readUnifiedJobFile(audioJobId, projectId, audioArchive.id)
  assert.ok(audioDownloaded)
  const info = inspect(audioDownloaded.bytes)
  assert.equal(info.audio[0]?.path, 'assets/audio/w01/film-e2e-audio-mix.wav')
  assert.ok(info.names.includes(info.audio[0]!.path))
  assert.equal(info.audio[0]!.sha256, info.hash)
  assert.deepEqual(info.wav, [44100, 1, 2, 44100])
})
