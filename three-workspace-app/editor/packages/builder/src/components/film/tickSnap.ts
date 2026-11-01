/** BBS FS samples at 20 Hz, so shot cuts should land on a whole tick. */
export const CUT_TICK_RATE = 20

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * Smallest frame step whose time is a whole number of ticks
 * (30 fps -> 3 frames, 24 fps -> 6, 25 fps -> 5, 20 fps -> 1). Null when fps is not an integer.
 */
export function tickGridFrames(fps: number): number | null {
  if (!Number.isInteger(fps) || fps <= 0) return null
  return fps / gcd(fps, CUT_TICK_RATE)
}

/** Snap a cut position (frame boundary) to the 20 Hz tick grid; unchanged when no grid applies. */
export function snapCutToTicks(frame: number, fps: number): number {
  const step = tickGridFrames(fps)
  if (!step || step <= 1) return frame
  return Math.round(frame / step) * step
}

/** Trim-start: first frame of the shot is the cut. */
export function snapTrimStart(sourceFrameStart: number, fps: number): number {
  return Math.max(0, snapCutToTicks(sourceFrameStart, fps))
}

/** Trim-end: sourceFrameEnd is inclusive, so the cut sits at end + 1. */
export function snapTrimEnd(sourceFrameEnd: number, fps: number): number {
  return Math.max(0, snapCutToTicks(sourceFrameEnd + 1, fps) - 1)
}
