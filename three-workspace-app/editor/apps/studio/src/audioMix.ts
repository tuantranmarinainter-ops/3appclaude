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
export async function filmAudioPackage(project: UnifiedProject, startFrame: number, endFrame: number, signal?: AbortSignal):
  Promise<{ files: Map<string, Buffer>; schedule: FilmAudioEntry[]; mix: Buffer } | null> {
  const cues = readAudioCueExtension(project).cues
  if (!cues.length) return null
  const fps = project.scene.content.timeline.fps
  const decoded = await decodeCueAssets(project, cues, signal)
  const durations = new Map([...decoded].map(([assetId, samples]) => [assetId, samples.length / MIX_RATE]))
  const sourceOf = (assetId: string) => project.assets[assetId as keyof UnifiedProject['assets']]?.displayName ?? assetId
  const schedule = filmAudioSchedule(cues, durations, startFrame, endFrame, fps, sourceOf)
  if (!schedule.length) return null
  return { files: new Map(), schedule, mix: encodeWav16(mixAudio(cues, decoded, startFrame, endFrame, fps)) }
}
