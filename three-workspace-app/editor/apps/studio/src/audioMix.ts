import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { decodeAudio, encodeWav16, filmAudioSchedule, mixAudio, readAudioCueExtension, MIX_RATE, type AudioCue, type FilmAudioEntry } from './audioCues'
import { resolveUnifiedAssetFile } from './unifiedAssetFiles'

/** Decoded mono samples (MIX_RATE) per audio asset used by the cues. */
export async function decodeCueAssets(project: UnifiedProject, cues: readonly AudioCue[], signal?: AbortSignal): Promise<Map<string, Float32Array>> {
  const decoded = new Map<string, Float32Array>()
  for (const assetId of new Set(cues.map((cue) => cue.assetId))) {
    signal?.throwIfAborted()
    decoded.set(assetId, await decodeAudio((await resolveUnifiedAssetFile(project, assetId, 'source')).bytes))
  }
  return decoded
}

/** One ducked mono WAV of the project's audio lane over an inclusive frame range. */
export async function mixdownProjectAudio(project: UnifiedProject, startFrame: number, endFrame: number, signal?: AbortSignal): Promise<Buffer> {
  const cues = readAudioCueExtension(project).cues
  const decoded = await decodeCueAssets(project, cues, signal)
  return encodeWav16(mixAudio(cues, decoded, startFrame, endFrame, project.scene.content.timeline.fps))
}

/**
 * Film package audio, kept small: one ducked mix of the Film range (audio/mix.wav, ready for video editing) and the
 * 20 Hz schedule with speaker/subtitle per cue (audio.json). Source files stay in the project.
 */
export async function filmAudioPackage(project: UnifiedProject, startFrame: number, endFrame: number, signal?: AbortSignal, filmDurationTicks?: number):
  Promise<{ files: Map<string, Buffer>; schedule: FilmAudioEntry[]; mix: Buffer; bbs?: ReturnType<typeof bbsFilmAudio> } | null> {
  const cues = readAudioCueExtension(project).cues
  if (!cues.length) return null
  const fps = project.scene.content.timeline.fps
  const decoded = await decodeCueAssets(project, cues, signal)
  const durations = new Map([...decoded].map(([assetId, samples]) => [assetId, samples.length / MIX_RATE]))
  const sourceOf = (assetId: string) => project.assets[assetId as keyof UnifiedProject['assets']]?.displayName ?? assetId
  const schedule = filmAudioSchedule(cues, durations, startFrame, endFrame, fps, sourceOf)
  if (!schedule.length) return null
  return { files: new Map(), schedule, mix: encodeWav16(mixAudio(cues, decoded, startFrame, endFrame, fps)),
    ...(filmDurationTicks === undefined ? {} : { bbs: bbsFilmAudio(cues, decoded, startFrame, fps, filmDurationTicks) }) }
}

/** Mix like playback: cue gains and offsets, with only a global peak limit. */
export function bbsFilmAudio(cues: readonly AudioCue[], decoded: ReadonlyMap<string, Float32Array>, startFrame: number, fps: number, durationTicks: number): { wav: Buffer; peakDb: number } {
  if (!Number.isSafeInteger(durationTicks) || durationTicks < 1 || !Number.isFinite(fps) || fps <= 0) throw new TypeError('Invalid film audio duration or frame rate')
  const rate = 44100, samples = new Float32Array(Math.round(durationTicks * rate / 20))
  for (const cue of cues) {
    const source = decoded.get(cue.assetId)
    if (!source) continue
    const start = (cue.frameStart - startFrame) / fps
    const end = cue.frameEnd === undefined ? Infinity : (cue.frameEnd - startFrame + 1) / fps
    const first = Math.max(0, Math.ceil(start * rate)), last = Math.min(samples.length, Math.ceil(end * rate))
    const gain = 10 ** (cue.gainDb / 20)
    for (let i = first; i < last; i++) {
      const position = (i / rate - start + (cue.offsetSeconds ?? 0)) * MIX_RATE
      const index = Math.floor(position), fraction = position - index
      if (index >= source.length) break
      samples[i]! += ((source[index] ?? 0) * (1 - fraction) + (source[index + 1] ?? 0) * fraction) * gain
    }
  }
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  const limit = 10 ** (-1 / 20)
  if (peak > limit) {
    const gain = limit / peak
    for (let i = 0; i < samples.length; i++) samples[i]! *= gain
    peak = limit
  }
  return { wav: encodeWav16(samples, rate), peakDb: peak ? 20 * Math.log10(peak) : -Infinity }
}
