import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import { decodeWav, encodeWav16, filmAudioSchedule, mixAudio, MIX_RATE, type AudioCue } from '../src/audioCues'
import { bbsFilmAudio, mixdownProjectAudio } from '../src/audioMix'
import { activeSubtitle, audioCuesToStart } from '../app/workbench/components/audio-cues/playback'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { executeUnifiedCommand, readUnifiedProject, UnifiedStoreError } from '../src/unifiedProjectStore'

const temp = mkdtempSync(path.join(tmpdir(), 'audio-cues-'))
const priorProjects = process.env.BBS_UNIFIED_PROJECTS_DIR
process.env.BBS_UNIFIED_PROJECTS_DIR = path.join(temp, 'projects')
test.after(() => { rmSync(temp, { recursive: true, force: true }); if (priorProjects === undefined) delete process.env.BBS_UNIFIED_PROJECTS_DIR; else process.env.BBS_UNIFIED_PROJECTS_DIR = priorProjects })

const tone = (seconds: number, amplitude: number, hz = 440) => Float32Array.from({ length: Math.round(seconds * MIX_RATE) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / MIX_RATE))
const rms = (samples: Float32Array, from: number, to: number) => Math.sqrt(samples.slice(from, to).reduce((sum, v) => sum + v * v, 0) / (to - from))
const cue = (patch: Partial<AudioCue>): AudioCue => ({ id: randomUUID(), kind: 'sfx', assetId: 'a', frameStart: 0, gainDb: 0, ...patch })

test('WAV round trip and decoding of 16-bit stereo', () => {
  const samples = tone(0.1, 0.5)
  const decoded = decodeWav(new Uint8Array(encodeWav16(samples)))!
  assert.equal(decoded.rate, MIX_RATE)
  assert.equal(decoded.samples.length, samples.length)
  assert.ok(Math.abs(decoded.samples[100]! - samples[100]!) < 1e-4)
  assert.equal(decodeWav(new Uint8Array([1, 2, 3])), null)
})

test('BBS Film WAV is mono PCM16 at 44100 Hz, film length and at most -1 dBFS', () => {
  const result = bbsFilmAudio([cue({})], new Map([['a', tone(8, 1)]]), 0, 30, 150)
  assert.equal(result.wav.readUInt16LE(20), 1)
  assert.equal(result.wav.readUInt16LE(22), 1)
  assert.equal(result.wav.readUInt32LE(24), 44100)
  assert.equal(result.wav.readUInt16LE(34), 16)
  const decoded = decodeWav(result.wav)!
  assert.equal(decoded.samples.length, 44100 * 7.5)
  const peak = decoded.samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
  assert.ok(20 * Math.log10(peak) <= -1)
  assert.ok(Math.abs(decoded.samples[4410]! - decoded.samples[0]!) < 0.001)
  assert.throws(() => bbsFilmAudio([], new Map(), 0, 30, 0), /Invalid/)
})

test('BBS Film mix preserves relative cue gains during overlap without ducking', () => {
  const voice = cue({ kind: 'voice', assetId: 'voice', gainDb: 0 })
  const music = cue({ kind: 'music', assetId: 'music', gainDb: -6, frameStart: 30 })
  const source = new Float32Array(MIX_RATE * 3).fill(0.8)
  const decoded = decodeWav(bbsFilmAudio([voice, music], new Map([['voice', source], ['music', source]]), 0, 30, 60).wav)!.samples
  const single = decoded[22050]!, overlap = decoded[66150]!
  assert.ok(Math.abs(overlap / single - (1 + 10 ** (-6 / 20))) < 0.001)
})

test('plays the right cues from the right offset and shows the latest voice subtitle', () => {
  const durations = new Map([['v', 2], ['m', 10]])
  const voice = cue({ kind: 'voice', assetId: 'v', frameStart: 30, speaker: 'Hero', text: 'Xin chào' })
  const music = cue({ kind: 'music', assetId: 'm', frameStart: 0 })
  assert.deepEqual(audioCuesToStart([voice, music], durations, 45, 30).map((item) => [item.cue.kind, item.offset]), [['voice', 0.5], ['music', 1.5]])
  assert.deepEqual(audioCuesToStart([voice], durations, 90, 30), []) // 2 s voice ended at frame 90
  assert.equal(activeSubtitle([voice, music], durations, 45, 30)?.text, 'Xin chào')
  assert.equal(activeSubtitle([voice, music], durations, 10, 30), null)
})

test('Film schedule keeps cues heard in the range with 20 Hz ticks and offsets for earlier starts', () => {
  const durations = new Map([['v', 1], ['m', 10]])
  const schedule = filmAudioSchedule([cue({ kind: 'music', assetId: 'm', frameStart: 0 }), cue({ kind: 'voice', assetId: 'v', frameStart: 75, text: 'A' }),
    cue({ assetId: 'v', frameStart: 200 })], durations, 60, 119, 30, (id) => `${id}-name`)
  assert.deepEqual(schedule.map((item) => [item.source, item.kind, item.startTick, item.offsetSeconds]), [['m-name', 'music', 0, 2], ['v-name', 'voice', 10, 0]])
})

test('mixdown ducks music by at least 6 dB while a voice speaks', () => {
  const decoded = new Map([['m', tone(4, 0.2, 220)], ['v', tone(1, 0.3, 880)]])
  const mixed = mixAudio([cue({ kind: 'music', assetId: 'm' }), cue({ kind: 'voice', assetId: 'v', frameStart: 60 })], decoded, 0, 119, 30)
  assert.equal(mixed.length, 4 * MIX_RATE)
  const musicOnly = mixAudio([cue({ kind: 'music', assetId: 'm' })], decoded, 0, 119, 30)
  // Music level inside the voice window (2.3-2.9 s), from the mix minus the voice's own contribution, versus no voice.
  const voiceOnly = mixAudio([cue({ kind: 'voice', assetId: 'v', frameStart: 60 })], decoded, 0, 119, 30)
  const a = Math.round(2.3 * MIX_RATE), b = Math.round(2.9 * MIX_RATE)
  const ducked = Float32Array.from(mixed.slice(a, b), (v, i) => v - voiceOnly[a + i]!)
  const ratio = rms(ducked, 0, ducked.length) / rms(musicOnly, a, b)
  assert.ok(20 * Math.log10(ratio) <= -6, `ducking ${(20 * Math.log10(ratio)).toFixed(1)} dB`)
})

test('audio assets, cue commands with revision checks, and a project mixdown', async () => {
  const scene = makeEmptyDraft('Audio', 30, 120, { fov: 45, position: { x: 0, y: 1.5, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 1, z: 0 } })
  const projectId = (await executeUnifiedCommand({ requestId: randomUUID(), command: 'project.create', args: { name: 'Audio', scene } }) as { projectId: string }).projectId
  const bytes = encodeWav16(tone(1, 0.3))
  const upload = await stageAssetUpload('line.wav', new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }))
  const imported = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: 0, command: 'asset.import', args: { files: [upload.id], format: 'auto' } }) as { revision: number; result: { assetIds: string[] } }
  const assetId = imported.result.assetIds[0]!
  const added = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: imported.revision, command: 'audio.cue.add',
    args: { cue: { kind: 'voice', assetId, frameStart: 30, gainDb: -3, speaker: 'Hero', text: 'Xin chào' } } }) as { revision: number; result: { cue: AudioCue } }
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: imported.revision, command: 'audio.cue.add',
    args: { cue: { kind: 'voice', assetId, frameStart: 0 } } }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'REVISION_CONFLICT')
  await assert.rejects(executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: added.revision, command: 'audio.cue.add',
    args: { cue: { kind: 'shout', assetId, frameStart: 0 } } }), (error: unknown) => error instanceof UnifiedStoreError && error.code === 'VALIDATION_FAILED')
  const listed = await executeUnifiedCommand({ requestId: randomUUID(), projectId, command: 'audio.cue.list', args: {} }) as { result: { cues: AudioCue[] } }
  assert.deepEqual(listed.result.cues.map((item) => [item.kind, item.frameStart, item.gainDb, item.text]), [['voice', 30, -3, 'Xin chào']])
  const project = await readUnifiedProject(projectId)
  const mix = decodeWav(new Uint8Array(await mixdownProjectAudio(project, 0, 119)))!
  assert.equal(mix.samples.length, 4 * MIX_RATE)
  assert.ok(rms(mix.samples, 0, MIX_RATE) < 1e-4 && rms(mix.samples, Math.round(1.2 * MIX_RATE), Math.round(1.8 * MIX_RATE)) > 0.05)
  const removed = await executeUnifiedCommand({ requestId: randomUUID(), projectId, expectedRevision: added.revision, command: 'audio.cue.remove', args: { id: added.result.cue.id } }) as { result: { removed: boolean } }
  assert.equal(removed.result.removed, true)
})
