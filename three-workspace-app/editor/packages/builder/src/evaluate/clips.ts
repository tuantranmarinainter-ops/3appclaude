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

export function motionTimeSeconds(clip: MotionClip, frame: number, fps: number, leftLimit = false, clampSource = false): number {
  const speed = clip.playback.speed ?? 1
  const sourceStart = Math.max(0, Math.min(clip.motion.time, clip.sourceDuration))
  const sourceLength = Math.max(0, Math.min(clip.motion.sourceLengthSeconds ?? clip.sourceDuration - sourceStart, clip.sourceDuration - sourceStart))
  if (!sourceLength) return sourceStart
  const elapsed = ((Math.max(clip.frameStart, frame) - clip.frameStart) / fps) * speed
  let offset = clip.playback.loop ? elapsed % sourceLength : Math.min(elapsed, sourceLength)
  // Native source durations are float32; quantized timeline endpoints can differ by a few nanoseconds.
  if (leftLimit && clip.playback.loop && elapsed > 0 && Math.min(offset, sourceLength - offset) < 1e-7) offset = sourceLength
  if (clip.motion.reverse) {
    const time = sourceStart + sourceLength - offset
    return clip.playback.loop && !clampSource && time >= clip.sourceDuration ? clip.sourceDuration - Math.min(1e-6, sourceLength / 2) : time
  }
  return sourceStart + offset
}
