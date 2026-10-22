import { spawn } from 'node:child_process'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

/**
 * B16 voice / SFX / music lane of an App 2 project. Cues reference imported audio assets (WAV/MP3/OGG) and start at a
 * timeline frame; App 2 plays them with the timeline, the Film package carries them as `audio/` + `audio.json`, and
 * `mixdownAudio` renders one ducked WAV (music drops while a voice speaks, as in the Tap 15 dub).
 */

export type AudioCueKind = 'voice' | 'sfx' | 'music'
export interface AudioCue { id: string; kind: AudioCueKind; assetId: string; frameStart: number; gainDb: number; speaker?: string; text?: string }
export interface AudioCueExtension { version: 1; cues: AudioCue[] }

export const AUDIO_FORMATS: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' }
const CUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_CUES = 4096
const KINDS: readonly AudioCueKind[] = ['voice', 'sfx', 'music']

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isAudioAsset(project: Pick<UnifiedProject, 'assets'>, assetId: string): boolean {
  const asset = project.assets[assetId as keyof UnifiedProject['assets']]
  return !!asset && Object.values(AUDIO_FORMATS).includes(asset.source.mediaType)
}

function validCue(value: unknown, project: Pick<UnifiedProject, 'assets' | 'scene'>): value is AudioCue {
  if (!record(value) || Object.keys(value).some((key) => !['id', 'kind', 'assetId', 'frameStart', 'gainDb', 'speaker', 'text'].includes(key))) return false
  const { frameStart, frameEnd } = project.scene.content.timeline
  return typeof value.id === 'string' && CUE_ID.test(value.id) && KINDS.includes(value.kind as AudioCueKind) &&
    typeof value.assetId === 'string' && isAudioAsset(project, value.assetId) &&
    Number.isSafeInteger(value.frameStart) && (value.frameStart as number) >= frameStart && (value.frameStart as number) <= frameEnd &&
    typeof value.gainDb === 'number' && Number.isFinite(value.gainDb) && value.gainDb >= -60 && value.gainDb <= 24 &&
    (value.speaker === undefined || typeof value.speaker === 'string' && value.speaker.length <= 64) &&
    (value.text === undefined || typeof value.text === 'string' && value.text.length <= 2000)
}

export function readAudioCueExtension(project: Pick<UnifiedProject, 'extensions' | 'assets' | 'scene'>): AudioCueExtension {
  const raw = project.extensions.audioCues
  if (raw === undefined) return { version: 1, cues: [] }
  if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.cues) || raw.cues.length > MAX_CUES ||
      !raw.cues.every((cue) => validCue(cue, project)) || new Set(raw.cues.map((cue) => (cue as AudioCue).id)).size !== raw.cues.length) {
    throw new TypeError('project.extensions.audioCues must be version 1 with valid, unique cues on audio assets')
  }
  return structuredClone(raw) as unknown as AudioCueExtension
}

export function makeAudioCue(project: UnifiedProject, input: unknown, id: string): AudioCue {
  if (!record(input) || Object.keys(input).some((key) => !['kind', 'assetId', 'frameStart', 'gainDb', 'speaker', 'text'].includes(key))) throw new TypeError('Audio cue fields are invalid')
  const cue = { gainDb: 0, ...input, id }
  if (!validCue(cue, project)) throw new TypeError('Audio cue values are invalid: kind voice|sfx|music, an imported audio asset, a frame inside the timeline, gainDb -60..24')
  return structuredClone(cue as AudioCue)
}

export function updateAudioCue(project: UnifiedProject, current: AudioCue, patch: unknown): AudioCue {
  if (!record(patch) || !Object.keys(patch).length || Object.keys(patch).some((key) => !['kind', 'assetId', 'frameStart', 'gainDb', 'speaker', 'text'].includes(key))) {
    throw new TypeError('Audio cue update requires one or more editable fields')
  }
  const next = { ...current, ...patch, id: current.id }
  for (const key of ['speaker', 'text'] as const) if ((patch as Record<string, unknown>)[key] === null) delete next[key]
  if (!validCue(next, project)) throw new TypeError('Audio cue values are invalid')
  return next as AudioCue
}

/** Cues whose sound covers `frame`, given each cue's decoded duration in seconds. */
export function audibleAudioCues(cues: readonly AudioCue[], durations: ReadonlyMap<string, number>, frame: number, fps: number): AudioCue[] {
  return cues.filter((cue) => {
    const duration = durations.get(cue.assetId)
    return duration !== undefined && frame >= cue.frameStart && (frame - cue.frameStart) / fps < duration
  })
}

export interface FilmAudioEntry { file: string; kind: AudioCueKind; startTick: number; offsetSeconds: number; gainDb: number; speaker?: string; text?: string }

/** Film sidecar: cues heard inside [startFrame, endFrame], ticks at 20 Hz from the Film start; earlier starts get an offset. */
export function filmAudioSchedule(cues: readonly AudioCue[], durations: ReadonlyMap<string, number>, startFrame: number, endFrame: number, fps: number,
  fileOf: (assetId: string) => string): FilmAudioEntry[] {
  const out: FilmAudioEntry[] = []
  for (const cue of cues) {
    const duration = durations.get(cue.assetId) ?? 0
    const cueEnd = cue.frameStart + duration * fps
    if (cue.frameStart > endFrame || cueEnd <= startFrame) continue
    const offsetSeconds = Math.max(0, (startFrame - cue.frameStart) / fps)
    out.push({ file: fileOf(cue.assetId), kind: cue.kind, startTick: Math.max(0, Math.round((cue.frameStart - startFrame) * 20 / fps)), offsetSeconds,
      gainDb: cue.gainDb, ...(cue.speaker ? { speaker: cue.speaker } : {}), ...(cue.text ? { text: cue.text } : {}) })
  }
  return out.sort((a, b) => a.startTick - b.startTick)
}

export const MIX_RATE = 48000

/** Decode PCM WAV (8/16/24/32-bit integer or 32-bit float) to mono float samples; null when not a plain WAV. */
export function decodeWav(bytes: Uint8Array): { rate: number; samples: Float32Array } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let format = 0, channels = 0, rate = 0, bits = 0, data: Uint8Array | null = null
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = tag(offset), size = view.getUint32(offset + 4, true), body = offset + 8
    if (id === 'fmt ') { format = view.getUint16(body, true); channels = view.getUint16(body + 2, true); rate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true) }
    if (id === 'data') data = bytes.subarray(body, Math.min(bytes.length, body + size))
    offset = body + size + (size & 1)
  }
  if (format === 0xfffe) format = bits === 32 ? 3 : 1 // WAVE_FORMAT_EXTENSIBLE: PCM or float by width
  if (!data || !channels || !rate || ![1, 3].includes(format)) return null
  const width = bits / 8, frames = Math.floor(data.length / (width * channels))
  const samples = new Float32Array(frames)
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * width
      sum += format === 3 ? dv.getFloat32(at, true)
        : bits === 16 ? dv.getInt16(at, true) / 32768
          : bits === 8 ? (dv.getUint8(at) - 128) / 128
            : bits === 24 ? ((dv.getUint8(at) | dv.getUint8(at + 1) << 8 | dv.getInt8(at + 2) << 16) / 8388608)
              : dv.getInt32(at, true) / 2147483648
    }
    samples[i] = sum / channels
  }
  return { rate, samples }
}

function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples
  const out = new Float32Array(Math.floor(samples.length * to / from))
  for (let i = 0; i < out.length; i++) {
    const position = i * from / to, index = Math.floor(position), t = position - index
    out[i] = (samples[index] ?? 0) * (1 - t) + (samples[index + 1] ?? 0) * t
  }
  return out
}

/** Decode any supported file to mono float samples at MIX_RATE; non-WAV files go through ffmpeg (FFMPEG or PATH). */
export async function decodeAudio(bytes: Uint8Array): Promise<Float32Array> {
  const wav = decodeWav(bytes)
  if (wav) return resample(wav.samples, wav.rate, MIX_RATE)
  const ffmpeg = process.env.FFMPEG?.trim() || 'ffmpeg'
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpeg, ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(MIX_RATE), 'pipe:1'], { windowsHide: true })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', (error) => reject(new Error(`Audio decode needs ffmpeg for non-WAV files: ${error.message}`)))
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg could not decode the audio (exit ${code})`)))
    child.stdin.on('error', () => { /* ffmpeg may stop reading early */ })
    child.stdin.end(Buffer.from(bytes))
  })
  return new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength))
}

/** Mix cues over [startFrame, endFrame]: voice + sfx + music, music ducked while a voice is loud, then soft-limited. */
export function mixAudio(cues: readonly AudioCue[], decoded: ReadonlyMap<string, Float32Array>, startFrame: number, endFrame: number, fps: number): Float32Array {
  const length = Math.max(1, Math.round((endFrame - startFrame + 1) / fps * MIX_RATE))
  const voice = new Float32Array(length), effects = new Float32Array(length), music = new Float32Array(length)
  for (const cue of cues) {
    const samples = decoded.get(cue.assetId)
    if (!samples) continue
    const bus = cue.kind === 'voice' ? voice : cue.kind === 'music' ? music : effects
    const gain = 10 ** (cue.gainDb / 20)
    const at = Math.round((cue.frameStart - startFrame) / fps * MIX_RATE)
    for (let i = Math.max(0, -at); i < samples.length && at + i < length; i++) bus[at + i]! += samples[i]! * gain
  }
  // Ducking: a 100 ms voice envelope pulls the music down by up to 55 % (about -7 dB), smoothed over 50 ms.
  const window = Math.round(MIX_RATE / 10), smooth = Math.round(MIX_RATE / 20)
  const duck = new Float32Array(length)
  let level = 0
  for (let i = 0; i < length; i++) {
    level += Math.abs(voice[i]!) - (i >= window ? Math.abs(voice[i - window]!) : 0)
    duck[i] = 1 - 0.55 * Math.min(1, level / window / 0.05)
  }
  const out = new Float32Array(length)
  let smoothed = 1, peak = 1e-9
  for (let i = 0; i < length; i++) {
    smoothed += (duck[i]! - smoothed) / smooth
    out[i] = voice[i]! + effects[i]! + music[i]! * smoothed
    peak = Math.max(peak, Math.abs(out[i]!))
  }
  const drive = 1.25 / Math.max(peak, 1)
  for (let i = 0; i < length; i++) out[i] = Math.tanh(out[i]! * drive) * 0.9
  return out
}

export function encodeWav16(samples: Float32Array, rate = MIX_RATE): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2)
  out.write('RIFF', 0); out.writeUInt32LE(36 + samples.length * 2, 4); out.write('WAVE', 8)
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22)
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34)
  out.write('data', 36); out.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2)
  return out
}
