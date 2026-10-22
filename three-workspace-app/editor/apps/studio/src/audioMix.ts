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

/** Film package audio: source files under audio/, the 20 Hz schedule and a ducked mix of the Film range. */
export async function filmAudioPackage(project: UnifiedProject, startFrame: number, endFrame: number, signal?: AbortSignal):
  Promise<{ files: Map<string, Buffer>; schedule: FilmAudioEntry[]; mix: Buffer } | null> {
  const cues = readAudioCueExtension(project).cues
  if (!cues.length) return null
  const fps = project.scene.content.timeline.fps
  const decoded = await decodeCueAssets(project, cues, signal)
  const durations = new Map([...decoded].map(([assetId, samples]) => [assetId, samples.length / MIX_RATE]))
  const names = new Map<string, string>()
  const fileOf = (assetId: string) => {
    if (!names.has(assetId)) {
      const asset = project.assets[assetId as keyof UnifiedProject['assets']]!
      const extension = asset.source.mediaType === 'audio/mpeg' ? 'mp3' : asset.source.mediaType === 'audio/ogg' ? 'ogg' : 'wav'
      names.set(assetId, `audio/${asset.source.sha256.slice(0, 16)}.${extension}`)
    }
    return names.get(assetId)!
  }
  const schedule = filmAudioSchedule(cues, durations, startFrame, endFrame, fps, fileOf)
  if (!schedule.length) return null
  const files = new Map<string, Buffer>()
  for (const [assetId, name] of names) files.set(name, (await resolveUnifiedAssetFile(project, assetId, 'source')).bytes)
  return { files, schedule, mix: encodeWav16(mixAudio(cues, decoded, startFrame, endFrame, fps)) }
}
