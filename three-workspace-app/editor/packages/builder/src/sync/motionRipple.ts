import type { MotionClip } from '../contract/types'

/**
 * "Tự dời" cho clip động tác (người dùng chốt 2026-11-05): cắt/tỉa bất kỳ đầu nào của clip thì không để khoảng trống.
 * Chỉ dời các clip động tác CÙNG nhân vật nằm sau clip đó; keyframe, camera, nhân vật khác giữ nguyên.
 * Quy ước khung: clip kề nhau dùng chung khung biên (clip trước frameEnd = clip sau frameStart), như splitMotionClip.
 */

export interface MotionRippleBounds {
  frameStart: number
  frameEnd: number
}

/** Clip cùng nhân vật bắt đầu sau `clip` (kể cả clip chồng để trộn bắt đầu trước khi `clip` kết thúc). */
function laterClips(clips: readonly MotionClip[], clip: MotionClip): MotionClip[] {
  return clips.filter(
    (c) => c.id !== clip.id && c.target.nodeId === clip.target.nodeId && c.frameStart > clip.frameStart,
  )
}

/** Kẹp độ dời các clip phía sau để không vượt frameEnd của timeline. */
function clampShift(later: readonly MotionClip[], shift: number, bounds: MotionRippleBounds): number {
  if (shift <= 0 || later.length === 0) return shift
  const lastEnd = Math.max(...later.map((c) => c.frameEnd))
  return Math.min(shift, Math.max(0, bounds.frameEnd - lastEnd))
}

function shifted(clip: MotionClip, shift: number): MotionClip {
  return shift === 0 ? clip : { ...clip, frameStart: clip.frameStart + shift, frameEnd: clip.frameEnd + shift }
}

/**
 * Kéo mép clip khi bật "Tự dời":
 * - mép trái: clip GIỮ điểm bắt đầu; bỏ (hoặc lấy lại) phần đầu động tác bằng cách dời motion.time, clip ngắn/dài ra ở cuối,
 *   các clip phía sau dời theo;
 * - mép phải: clip ngắn/dài ra ở cuối, các clip phía sau dời theo.
 * Trả về danh sách clip mới (cùng thứ tự) hoặc null nếu không đổi.
 */
export function rippleTrimMotionClip(
  clips: readonly MotionClip[],
  clipId: string,
  edge: 'start' | 'end',
  edgeFrame: number,
  fps: number,
  bounds: MotionRippleBounds,
): MotionClip[] | null {
  const old = clips.find((c) => c.id === clipId)
  if (!old || !Number.isFinite(edgeFrame) || !(fps > 0)) return null
  const later = laterClips(clips, old)
  const laterIds = new Set(later.map((c) => c.id))
  const length = old.frameEnd - old.frameStart
  const speed = old.playback.speed || 1
  let lengthDelta: number
  let next: MotionClip
  if (edge === 'end') {
    const target = Math.max(old.frameStart + 1, Math.round(edgeFrame))
    lengthDelta = target - old.frameEnd
    if (lengthDelta > 0) lengthDelta = Math.min(clampShift(later, lengthDelta, bounds), Math.max(0, bounds.frameEnd - old.frameEnd))
    next = { ...old, frameEnd: old.frameEnd + lengthDelta }
  } else {
    // trim > 0: bỏ bớt phần đầu; trim < 0: lấy lại phần đầu đã bỏ (không lùi quá giây 0 của động tác gốc).
    let trim = Math.round(edgeFrame) - old.frameStart
    trim = Math.min(trim, length - 1)
    const maxReveal = Math.floor((Math.max(0, old.motion.time) * fps) / speed + 1e-6)
    trim = Math.max(trim, -maxReveal)
    if (trim < 0) {
      // Clip dài ra ở cuối: chính nó và các clip sau không được vượt frameEnd của timeline.
      const grow = Math.min(clampShift(later, -trim, bounds), Math.max(0, bounds.frameEnd - old.frameEnd))
      trim = -grow
    }
    lengthDelta = -trim
    const seconds = (trim / fps) * speed
    const time = Math.max(0, Math.min(old.motion.time + seconds, old.sourceDuration))
    const motion = { ...old.motion, time }
    if (old.motion.sourceLengthSeconds != null) {
      motion.sourceLengthSeconds = Math.max(1e-3, old.motion.sourceLengthSeconds - (time - old.motion.time))
    }
    next = { ...old, frameEnd: old.frameEnd - trim, motion }
  }
  if (lengthDelta === 0 && next.motion.time === old.motion.time) return null
  return clips.map((c) => (c.id === clipId ? next : laterIds.has(c.id) ? shifted(c, lengthDelta) : c))
}

/**
 * Xoá clip khi bật "Tự dời": các clip phía sau của cùng nhân vật dời trái để lấp chỗ clip đã xoá
 * (tối đa bằng độ dài clip bị xoá, không ăn vào khoảng trống có sẵn).
 * Xoá nhiều clip: xử lý từ clip muộn nhất về sớm nhất để mỗi lần dời tính đúng.
 */
export function rippleDeleteMotionClips(clips: readonly MotionClip[], clipIds: readonly string[]): MotionClip[] {
  const ids = new Set(clipIds)
  const doomed = clips.filter((c) => ids.has(c.id)).sort((a, b) => b.frameStart - a.frameStart)
  let current = [...clips]
  for (const clip of doomed) {
    const later = laterClips(current, clip).filter((c) => !ids.has(c.id) || c.frameStart > clip.frameStart)
    const firstStart = later.length ? Math.min(...later.map((c) => c.frameStart)) : null
    const shift = firstStart == null ? 0 : Math.min(clip.frameEnd - clip.frameStart, firstStart - clip.frameStart)
    const laterIds = new Set(later.map((c) => c.id))
    current = current
      .filter((c) => c.id !== clip.id)
      .map((c) => (laterIds.has(c.id) ? shifted(c, -shift) : c))
  }
  return current
}
