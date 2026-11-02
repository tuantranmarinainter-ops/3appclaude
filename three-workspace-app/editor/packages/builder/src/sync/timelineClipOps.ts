import type { DirectorDocument, MotionClip } from '../contract/types'

export type TimelineClipResult = { id: string | null; error: 'no-gap' | 'unavailable' | 'not-applicable' | null }

export interface FrameRange { start: number; end: number }

type ClipLike = { id: string; frameStart: number; frameEnd: number; target: { nodeId: string } }

/** Shot (film sequence clip) containing `frame`, as a half-open frame range; null when there is no shot. */
export function shotRangeAt(doc: DirectorDocument, frame: number): FrameRange | null {
  const editorial = doc.content.editorial
  if (!editorial) return null
  const sequence = editorial.sequences.find((item) => item.id === editorial.activeSequenceId)
  const shot = sequence?.clips.find((clip) => frame >= clip.sourceFrameStart && frame <= clip.sourceFrameEnd)
  return shot ? { start: shot.sourceFrameStart, end: shot.sourceFrameEnd + 1 } : null
}

/**
 * Nearest start frame >= `from` where a clip of `length` fits between `others`
 * without overlap and inside `limit`. Null when nothing fits.
 */
export function findFreeGapStart(
  others: readonly FrameRange[],
  from: number,
  length: number,
  limit: FrameRange,
): number | null {
  if (!(length > 0)) return null
  const sorted = [...others].sort((a, b) => a.start - b.start)
  let cursor = Math.max(from, limit.start)
  for (const other of sorted) {
    if (other.end <= cursor) continue
    if (other.start >= cursor + length) break
    cursor = Math.max(cursor, other.end)
  }
  return cursor + length <= limit.end ? cursor : null
}

/** Where a duplicate of a clip should go; null when there is no room. */
export function duplicateGapStart(
  doc: DirectorDocument,
  clip: ClipLike,
  siblings: readonly ClipLike[],
): number | null {
  const tl = doc.content.timeline
  const shot = shotRangeAt(doc, clip.frameStart)
  const limit = shot
    ? { start: Math.max(shot.start, tl.frameStart), end: Math.min(shot.end, tl.frameEnd) }
    : { start: tl.frameStart, end: tl.frameEnd }
  const others = siblings
    .filter((item) => item.id !== clip.id && item.target.nodeId === clip.target.nodeId)
    .map((item) => ({ start: item.frameStart, end: item.frameEnd }))
  return findFreeGapStart(others, clip.frameEnd, clip.frameEnd - clip.frameStart, limit)
}

/**
 * Split a motion clip at `frame` into two clips that play as one continuous motion.
 * The second clip's source offset continues where the first one ended.
 */
export function splitMotionClip(
  clip: MotionClip,
  frame: number,
  fps: number,
): { first: MotionClip; second: Omit<MotionClip, 'id'> } | null {
  const at = Math.round(frame)
  if (!(at > clip.frameStart && at < clip.frameEnd) || !(fps > 0)) return null
  const speed = clip.playback.speed ?? 1
  const sourceStart = Math.max(0, Math.min(clip.motion.time, clip.sourceDuration))
  const length = Math.max(0, Math.min(clip.motion.sourceLengthSeconds ?? clip.sourceDuration - sourceStart, clip.sourceDuration - sourceStart))
  if (!length) return null
  const elapsed = ((at - clip.frameStart) / fps) * speed
  const offset = clip.playback.loop ? elapsed % length : Math.min(elapsed, length)
  const remaining = Math.max(1e-3, length - offset)
  const { id: _id, ...rest } = clip
  const second: Omit<MotionClip, 'id'> = {
    ...rest,
    frameStart: at,
    motion: {
      ...clip.motion,
      time: clip.motion.reverse ? sourceStart : Math.min(clip.sourceDuration, sourceStart + offset),
      sourceLengthSeconds: remaining,
    },
  }
  return { first: { ...clip, frameEnd: at }, second }
}

/** Frame the clip can be stretched to: next clip of the same node, else shot end, else timeline end. */
export function extendedClipEnd(
  doc: DirectorDocument,
  clip: ClipLike,
  siblings: readonly ClipLike[],
): number {
  const tl = doc.content.timeline
  const shot = shotRangeAt(doc, clip.frameStart)
  let end = shot ? Math.min(shot.end, tl.frameEnd) : tl.frameEnd
  for (const item of siblings) {
    if (item.id !== clip.id && item.target.nodeId === clip.target.nodeId && item.frameStart >= clip.frameEnd) end = Math.min(end, item.frameStart)
  }
  return end
}
