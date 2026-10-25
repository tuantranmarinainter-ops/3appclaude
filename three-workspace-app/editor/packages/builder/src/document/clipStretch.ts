import type { MotionClip } from '../contract/types'

export function motionSourceSpan(clip: MotionClip): number {
  const start = Math.max(0, Math.min(clip.motion.time, clip.sourceDuration))
  return Math.max(0, Math.min(clip.motion.sourceLengthSeconds ?? clip.sourceDuration - start, clip.sourceDuration - start))
}

export function motionStretchPatch(clip: MotionClip, fps: number, frameStart: number, frameEnd: number) {
  const speed = motionSourceSpan(clip) * fps / (frameEnd - frameStart + 1)
  if (!Number.isFinite(speed) || speed < 0.01 || speed > 16 || frameEnd < frameStart) return null
  return { frameStart, frameEnd, speed }
}
