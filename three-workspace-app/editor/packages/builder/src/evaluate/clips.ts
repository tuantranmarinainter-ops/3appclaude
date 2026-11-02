import type { MotionClip } from '../contract/types'

/** 闭区间 [frameStart, frameEnd]，与 parser.findMotionClipAt 一致。 */
export function motionClipAt(
  clips: readonly MotionClip[],
  nodeId: string,
  frame: number,
  boundary?: 'left' | 'right',
): MotionClip | null {
  for (const clip of clips) {
    const ownsFrame = boundary === 'left' ? frame > clip.frameStart && frame <= clip.frameEnd + 1
      : boundary === 'right' ? frame >= clip.frameStart && frame < clip.frameEnd + 1
        : frame >= clip.frameStart && frame <= clip.frameEnd
    if (clip.target.nodeId === nodeId && ownsFrame) {
      return clip
    }
  }
  return null
}

/**
 * B9: khi clip dài hơn động tác gốc có 3 cách "kéo dài": lặp lại, giữ khung cuối, giãn chậm.
 * Tài liệu cũ không có lựa chọn riêng: cờ loop=true là "lặp", loop=false là "giữ khung cuối".
 * "Giãn chậm" được lưu là loop=false + playback.loopMode='stretch' (không cần trường mới, bản cũ vẫn đọc được).
 */
export type MotionExtendMode = 'loop' | 'hold' | 'stretch'

export function motionExtendMode(playback: Pick<MotionClip['playback'], 'loop' | 'loopMode'> & { extendMode?: unknown }): MotionExtendMode {
  const explicit = playback.extendMode
  if (explicit === 'loop' || explicit === 'hold' || explicit === 'stretch') return explicit
  if (playback.loop) return 'loop'
  return playback.loopMode === 'stretch' ? 'stretch' : 'hold'
}

/** Độ dài đoạn động tác gốc đang dùng (giây, chưa nhân tốc độ). */
export function motionSourceLengthSeconds(clip: MotionClip): number {
  const sourceStart = Math.max(0, Math.min(clip.motion.time, clip.sourceDuration))
  return Math.max(0, Math.min(clip.motion.sourceLengthSeconds ?? clip.sourceDuration - sourceStart, clip.sourceDuration - sourceStart))
}

/** Clip trên timeline dài hơn động tác gốc bao nhiêu giây (0 nếu không dài hơn). */
export function motionClipOverrunSeconds(clip: MotionClip, fps: number): number {
  const sourceLength = motionSourceLengthSeconds(clip)
  if (!sourceLength || !(fps > 0)) return 0
  const clipSeconds = (clip.frameEnd - clip.frameStart + 1) / fps
  const playedSeconds = sourceLength / (clip.playback.speed || 1)
  return Math.max(0, clipSeconds - playedSeconds)
}

export function motionTimeSeconds(clip: MotionClip, frame: number, fps: number, leftLimit = false, clampSource = false): number {
  const mode = motionExtendMode(clip.playback)
  const loops = mode === 'loop'
  const pingPong = loops && clip.playback.loopMode === 'ping-pong'
  let speed = clip.playback.speed ?? 1
  const sourceStart = Math.max(0, Math.min(clip.motion.time, clip.sourceDuration))
  const sourceLength = Math.max(0, Math.min(clip.motion.sourceLengthSeconds ?? clip.sourceDuration - sourceStart, clip.sourceDuration - sourceStart))
  if (!sourceLength) return sourceStart
  if (mode === 'stretch') {
    // Giãn chậm: toàn bộ động tác gốc được kéo vừa khít độ dài clip.
    const clipSeconds = (clip.frameEnd - clip.frameStart + 1) / fps
    if (clipSeconds > 0) speed = sourceLength / clipSeconds
  }
  const elapsed = ((Math.max(clip.frameStart, frame) - clip.frameStart) / fps) * speed
  const wrapped = elapsed % (2 * sourceLength)
  let offset = pingPong
    ? (wrapped <= sourceLength ? wrapped : 2 * sourceLength - wrapped)
    : loops ? elapsed % sourceLength : Math.min(elapsed, sourceLength)
  // Native source durations are float32; quantized timeline endpoints can differ by a few nanoseconds.
  if (leftLimit && loops && !pingPong && elapsed > 0 && Math.min(offset, sourceLength - offset) < 1e-7) offset = sourceLength
  if (clip.motion.reverse) {
    const time = sourceStart + sourceLength - offset
    return loops && !clampSource && time >= clip.sourceDuration ? clip.sourceDuration - Math.min(1e-6, sourceLength / 2) : time
  }
  return sourceStart + offset
}
