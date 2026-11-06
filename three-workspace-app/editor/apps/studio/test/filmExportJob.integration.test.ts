import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  const tone = encodeWav16(Float32Array.from({ length: 48000 }, (_, i) => i === 4800 ? 1 : 0.1 + 0.2 * i / 48000))
  const audioUpload = await stageAssetUpload('tone.wav', new ReadableStream({ start(controller) { controller.enqueue(tone); controller.close() } }))
  const importedAudio = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'asset.import', args: { files: [audioUpload.id], format: 'auto' } })
  revision++
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'audio.cue.add', args: { cue: { kind: 'music', assetId: (importedAudio.result.assetIds as string[])[0], frameStart: 0, gainDb: 0 } } })
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

  // Four shots force two native Films (three cameras per Film), with a continuous cue across the boundary.
  const latest = await readUnifiedProject(projectId)
  const seriesScene = structuredClone(latest.scene)
  seriesScene.content.timeline.animation.motionClips = []
  seriesScene.content.editorial!.sequences[0]!.clips = [
    { id: 's1', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 5 },
    { id: 's2', cameraNodeId: 'camera_2', sourceFrameStart: 6, sourceFrameEnd: 11 },
    { id: 's3', cameraNodeId: 'camera_1', sourceFrameStart: 12, sourceFrameEnd: 17 },
    { id: 's4', cameraNodeId: 'camera_2', sourceFrameStart: 18, sourceFrameEnd: 29 },
  ]
  await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.apply', args: {
    operations: [{ type: 'document.replace', document: seriesScene, fcurves: latest.extensions.topview?.fcurves ?? null }],
  } })
  revision++
  const seriesStarted = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'scene.export.bbsFilmSeries', args: {
    characterIds, sequenceId: 'film-e2e-sequence', viewportAspect: 16 / 9, name: 'episode-audio', includeAudioInFilm: true,
  } })
  const seriesJobId = String(seriesStarted.result.jobId)
  let seriesJob = await getUnifiedJob(seriesJobId, projectId)
  for (let attempt = 0; attempt < 900 && (seriesJob.state === 'queued' || seriesJob.state === 'running'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); seriesJob = await getUnifiedJob(seriesJobId, projectId)
  }
  assert.equal(seriesJob.state, 'succeeded', JSON.stringify(seriesJob))
  const seriesArchive = seriesJob.result?.files.find((file) => file.mimeType === 'application/zip')
  assert.ok(seriesArchive)
  const seriesDownloaded = await readUnifiedJobFile(seriesJobId, projectId, seriesArchive.id)
  assert.ok(seriesDownloaded)
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const seriesInspect = spawnSync(python, ['-c', 'import sys,zipfile,io,json,wave,struct; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); series=json.loads(z.read("series.json")); wavs=[]\nfor i in range(1,3):\n w=wave.open(io.BytesIO(z.read("assets/audio/w01/episode-audio-%02d-mix.wav" % i))); wavs.append([w.getframerate(),w.getnchannels(),w.getsampwidth(),w.getnframes(),struct.unpack("<h",w.readframes(1))[0]/32767])\nprint(json.dumps({"series":series,"wavs":wavs,"names":z.namelist()}))'], { input: seriesDownloaded.bytes, encoding: 'utf8' })
  assert.equal(seriesInspect.status, 0, seriesInspect.stderr)
  const seriesInfo = JSON.parse(seriesInspect.stdout) as { series: { startTick: number; ticks: number }[]; wavs: number[][]; names: string[] }
  assert.deepEqual(seriesInfo.series.map((entry) => [entry.startTick, entry.ticks]), [[0, 12], [12, 8]])
  assert.deepEqual(seriesInfo.wavs.map((wav) => wav.slice(0, 4)), [[44100, 1, 2, 26460], [44100, 1, 2, 17640]])
  const sharedGain = 10 ** (-1 / 20)
  assert.ok(Math.abs(seriesInfo.wavs[0]![4]! - 0.1 * sharedGain) < 0.001)
  assert.ok(Math.abs(seriesInfo.wavs[1]![4]! - 0.22 * sharedGain) < 0.001)
  assert.ok(seriesInfo.names.includes('films/episode-audio-01.dat') && seriesInfo.names.includes('films/episode-audio-02.dat'))
  assert.ok(seriesInfo.names.includes('film-audio.json'))

  const split = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: revision, command: 'project.splitShots', args: { shotIds: ['s1', 's2'], episodeName: 'Test episode' } })
  const memberIds = (split.result.projects as Array<{ projectId: string }>).map((item) => item.projectId)
  const episodeStarted = await executeUnifiedCommand({ requestId: randomUUID(), projectId: memberIds[0], expectedRevision: 0, command: 'episode.export', args: { name: 'multi-shot', includeAudioInFilm: true } })
  const episodeJobId = String(episodeStarted.result.jobId)
  let episodeJob = await getUnifiedJob(episodeJobId, memberIds[0]!)
  for (let attempt = 0; attempt < 900 && (episodeJob.state === 'queued' || episodeJob.state === 'running'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); episodeJob = await getUnifiedJob(episodeJobId, memberIds[0]!)
  }
  assert.equal(episodeJob.state, 'succeeded', JSON.stringify(episodeJob))
  const episodeArchive = episodeJob.result?.files.find((file) => file.mimeType === 'application/zip')
  assert.ok(episodeArchive)
  const episodeDownloaded = await readUnifiedJobFile(episodeJobId, memberIds[0]!, episodeArchive.id)
  assert.ok(episodeDownloaded)
  const episodeInspectScript = 'import sys,zipfile,io,json,wave,struct; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); series=json.loads(z.read("series.json")); metadata=json.loads(z.read("film-audio.json")); wavs=[]\nfor i in range(1,3):\n w=wave.open(io.BytesIO(z.read("assets/audio/w01/multi-shot-%02d-mix.wav" % i))); wavs.append([w.getnframes(),struct.unpack("<h",w.readframes(1))[0]/32767])\nprint(json.dumps({"series":series,"wavs":wavs,"metadata":metadata}))'
  const episodeInspect = spawnSync(python, ['-c', episodeInspectScript], { input: episodeDownloaded.bytes, encoding: 'utf8' })
  assert.equal(episodeInspect.status, 0, episodeInspect.stderr)
  const episodeInfo = JSON.parse(episodeInspect.stdout) as { series: { projectId: string; startTick: number; ticks: number }[]; wavs: number[][]; metadata: Record<string, { sha256: string; peakDb: number }[]> }
  assert.deepEqual(episodeInfo.series.map((item) => [item.projectId, item.startTick, item.ticks]), [[memberIds[0], 0, 4], [memberIds[1], 4, 4]])
  assert.deepEqual(episodeInfo.wavs.map((wav) => wav[0]), [8820, 8820])
  assert.ok(Math.abs(episodeInfo.wavs[0]![1]! - 0.1 * sharedGain) < 0.001)
  assert.ok(Math.abs(episodeInfo.wavs[1]![1]! - 0.14 * sharedGain) < 0.001)
  assert.ok(Object.values(episodeInfo.metadata).every((entries) => /^[a-f0-9]{64}$/.test(entries[0]!.sha256) && Number.isFinite(entries[0]!.peakDb)))
  const mutedStarted = await executeUnifiedCommand({ requestId: randomUUID(), projectId: memberIds[0], expectedRevision: 0, command: 'episode.export', args: { name: 'multi-muted', includeAudioInFilm: false } })
  const mutedJobId = String(mutedStarted.result.jobId)
  let mutedJob = await getUnifiedJob(mutedJobId, memberIds[0]!)
  for (let attempt = 0; attempt < 900 && (mutedJob.state === 'queued' || mutedJob.state === 'running'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); mutedJob = await getUnifiedJob(mutedJobId, memberIds[0]!)
  }
  assert.equal(mutedJob.state, 'succeeded', JSON.stringify(mutedJob))
  const mutedArchive = mutedJob.result?.files.find((file) => file.mimeType === 'application/zip')
  assert.ok(mutedArchive)
  const mutedDownloaded = await readUnifiedJobFile(mutedJobId, memberIds[0]!, mutedArchive.id)
  assert.ok(mutedDownloaded)
  const decodeDir = mkdtempSync(path.join(tmpdir(), 'film-series-decode-'))
  try {
    const decoder = path.join(decodeDir, 'Decode.java')
    writeFileSync(decoder, 'import java.nio.file.*; import local.bbsmcp.data.BbsCodec; public class Decode { public static void main(String[] a)throws Exception { System.out.println(BbsCodec.toJson(BbsCodec.read(Files.readAllBytes(Path.of(a[0]))))); }}')
    const vendor = fileURLToPath(new URL('../../../../agent/film_worker/vendor/', import.meta.url))
    const classpath = [path.join(vendor, 'bbs-animation-bridge-0.2.0-mc1.20.1.jar'), path.join(vendor, 'gson-2.10.1.jar')].join(path.delimiter)
    const compile = spawnSync('javac', ['-cp', classpath, decoder], { encoding: 'utf8' })
    assert.equal(compile.status, 0, compile.stderr)
    const unzip = spawnSync(python, ['-c', 'import io,sys,zipfile,pathlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); d=pathlib.Path(sys.argv[1]); [(d / (str(i)+".dat")).write_bytes(z.read("films/multi-shot-%02d.dat" % i)) for i in (1,2)]', decodeDir], { input: episodeDownloaded.bytes, encoding: 'utf8' })
    assert.equal(unzip.status, 0, unzip.stderr)
    for (const i of [1, 2]) {
      const decoded = spawnSync('java', ['-cp', `${classpath}${path.delimiter}${decodeDir}`, 'Decode', path.join(decodeDir, `${i}.dat`)], { encoding: 'utf8' })
      assert.equal(decoded.status, 0, decoded.stderr)
      const clips = (JSON.parse(decoded.stdout) as { camera: Array<Record<string, unknown>> }).camera.filter((clip) => clip.type === 'bbs:audio')
      assert.equal(clips.length, 1)
      assert.equal(clips[0]!.tick, 0)
      assert.equal(clips[0]!.duration, 4)
      assert.equal(clips[0]!.audio, `assets:audio/w01/multi-shot-0${i}-mix.wav`)
      assert.equal(clips[0]!.offset, 0)
    }
    const mutedUnzip = spawnSync(python, ['-c', 'import io,sys,zipfile,pathlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert not any(n.startswith("assets/audio/") or n=="film-audio.json" for n in z.namelist()); (pathlib.Path(sys.argv[1])/"muted.dat").write_bytes(z.read("films/multi-muted-01.dat"))', decodeDir], { input: mutedDownloaded.bytes, encoding: 'utf8' })
    assert.equal(mutedUnzip.status, 0, mutedUnzip.stderr)
    const mutedDecoded = spawnSync('java', ['-cp', `${classpath}${path.delimiter}${decodeDir}`, 'Decode', path.join(decodeDir, 'muted.dat')], { encoding: 'utf8' })
    assert.equal(mutedDecoded.status, 0, mutedDecoded.stderr)
    assert.equal((JSON.parse(mutedDecoded.stdout) as { camera: Array<Record<string, unknown>> }).camera.filter((clip) => clip.type === 'bbs:audio').length, 0)
  } finally { rmSync(decodeDir, { recursive: true, force: true }) }
})
