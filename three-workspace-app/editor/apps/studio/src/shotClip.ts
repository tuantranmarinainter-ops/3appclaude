/**
 * B20: đổi một MotionClip của App 2 thành mô tả clip trong gói shot cho App 3.
 * Gói shot chỉ có {sourceStartSeconds, sourceEndSeconds, speed, loop, reverse}; App 3 từ chối khi
 * sourceEndSeconds vượt thời lượng Action trong GLB. Vì vậy:
 *   - Lặp (loop):          loop=true, đoạn nguồn giữ nguyên (không vượt Action).
 *   - Giữ khung cuối:      loop=false, đoạn nguồn giữ nguyên; App 3 dừng ở khung cuối khi hết đoạn.
 *   - Giãn chậm (stretch): loop=false, speed = độ dài đoạn nguồn / độ dài clip, nên vừa khít clip.
 * sourceEndSeconds không bao giờ lớn hơn độ dài Action.
 */
export type ShotExtendMode = 'loop' | 'hold' | 'stretch'

export interface ShotClipSource {
  frameStart: number
  frameEnd: number
  playback: { speed: number; loop: boolean; loopMode?: string; extendMode?: unknown }
}
export interface ShotClipBinding { sourceStartSeconds: number; sourceLengthSeconds: number; reverse: boolean }
export interface ShotClipPayload { sourceStartSeconds: number; sourceEndSeconds: number; speed: number; loop: boolean; reverse: boolean; extendMode: ShotExtendMode }

/** Giống `motionExtendMode` của packages/builder/src/evaluate/clips.ts (giữ hai nơi khớp nhau). */
export function shotExtendMode(playback: ShotClipSource['playback']): ShotExtendMode {
  const explicit = playback.extendMode
  if (explicit === 'loop' || explicit === 'hold' || explicit === 'stretch') return explicit
  if (playback.loop) return 'loop'
  return playback.loopMode === 'stretch' ? 'stretch' : 'hold'
}

export function shotClipPayload(clip: ShotClipSource, binding: ShotClipBinding, fps: number, frameStart: number, actionDurationSeconds: number): ShotClipPayload {
  const mode = shotExtendMode(clip.playback)
  const length = binding.sourceLengthSeconds
  const clipSeconds = (clip.frameEnd - clip.frameStart + 1) / fps
  const speed = mode === 'stretch' && clipSeconds > 0 && length > 0 ? length / clipSeconds : clip.playback.speed
  const offset = (frameStart - clip.frameStart) / fps * speed
  if (mode === 'loop' && offset !== 0) throw new TypeError('MVP loop shots must begin at the source clip boundary')
  const limit = Number.isFinite(actionDurationSeconds) && actionDurationSeconds > 0 ? actionDurationSeconds : Infinity
  const rawEnd = binding.sourceStartSeconds + length - (binding.reverse ? offset : 0)
  const end = Math.max(0, Math.min(rawEnd, limit))
  const start = Math.max(0, Math.min(binding.sourceStartSeconds + (binding.reverse ? 0 : offset), end))
  return { sourceStartSeconds: start, sourceEndSeconds: end, speed, loop: mode === 'loop', reverse: binding.reverse, extendMode: mode }
}
