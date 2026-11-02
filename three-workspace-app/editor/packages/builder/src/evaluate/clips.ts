import type { MotionBlendIn, MotionClip } from '../contract/types'

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

/** Clip sau (B) có `blendIn` hợp lệ về mặt dữ liệu (số khung nguyên dương, kiểu chuyển biết trước). */
export function motionBlendInOf(clip: MotionClip): MotionBlendIn | null {
  const blend = clip.playback.blendIn
  if (!blend || !Number.isInteger(blend.frames) || blend.frames < 1) return null
  if (blend.curve !== 'smooth' && blend.curve !== 'linear') return null
  return blend
}

/**
 * Clip trước (A) của `clip` khi nó có `blendIn`: cùng nhân vật, bắt đầu sớm hơn và vùng trộn
 * [B.frameStart, B.frameStart + frames - 1] nằm trong khoảng của A. Không hợp lệ -> null (phát như cũ).
 */
export function motionBlendPartner(clips: readonly MotionClip[], clip: MotionClip): MotionClip | null {
  const blend = motionBlendInOf(clip)
  if (!blend) return null
  const zoneEnd = clip.frameStart + blend.frames - 1
  let best: MotionClip | null = null
  for (const other of clips) {
    if (other.id === clip.id || other.target.nodeId !== clip.target.nodeId) continue
    if (other.frameStart >= clip.frameStart || other.frameEnd < zoneEnd) continue
    if (!best || other.frameStart > best.frameStart) best = other
  }
  return best
}

/** Trọng số của clip sau tại vị trí chuẩn hóa t (0..1): smoothstep hoặc tuyến tính. */
export function motionBlendWeight(curve: MotionBlendIn['curve'], t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t
  return curve === 'linear' ? x : x * x * (3 - 2 * x)
}

export interface MotionClipsAt {
  from: MotionClip
  /** Clip thứ hai trong vùng trộn; null ngoài vùng trộn. */
  to: MotionClip | null
  /** Trọng số của `to` (0..1); 0 khi không trộn. */
  weight: number
}

/**
 * Như motionClipAt nhưng hiểu `blendIn`. Ngoài vùng trộn trả đúng clip mà motionClipAt trả (to = null).
 * Bất biến: tối đa 2 clip mỗi khung, chỉ khi clip sau có blendIn hợp lệ với đúng clip trước đang phủ khung đó.
 */
export function motionClipsAt(
  clips: readonly MotionClip[],
  nodeId: string,
  frame: number,
  boundary?: 'left' | 'right',
): MotionClipsAt | null {
  let first: MotionClip | null = null
  let owners: MotionClip[] | null = null
  for (const clip of clips) {
    if (clip.target.nodeId !== nodeId) continue
    const ownsFrame = boundary === 'left' ? frame > clip.frameStart && frame <= clip.frameEnd + 1
      : boundary === 'right' ? frame >= clip.frameStart && frame < clip.frameEnd + 1
        : frame >= clip.frameStart && frame <= clip.frameEnd
    if (!ownsFrame) continue
    if (!first) { first = clip; continue }
    if (!owners) owners = [first]
    owners.push(clip)
  }
  if (!first) return null
  if (!owners || owners.length !== 2) return { from: first, to: null, weight: 0 }
  // Đúng 2 clip chồng nhau: chỉ trộn khi clip sau có blendIn hợp lệ trỏ tới clip trước kia.
  const [x, y] = owners
  const later = x.frameStart > y.frameStart ? x : y.frameStart > x.frameStart ? y : null
  if (!later) return { from: first, to: null, weight: 0 }
  const earlier = later === x ? y : x
  const blend = motionBlendInOf(later)
  if (!blend || motionBlendPartner(clips, later) !== earlier) return { from: first, to: null, weight: 0 }
  const t = (frame - later.frameStart) / blend.frames
  // Hết vùng trộn mà clip trước còn phủ khung: clip sau phát một mình.
  if (t >= 1) return { from: later, to: null, weight: 0 }
  return { from: earlier, to: later, weight: motionBlendWeight(blend.curve, t) }
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
