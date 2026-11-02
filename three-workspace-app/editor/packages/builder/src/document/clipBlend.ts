import type { MotionBlendIn, MotionClip } from '../contract/types'
import { motionBlendInOf, motionBlendPartner } from '../evaluate/clips'
import { shiftOverlappingMotionClips } from '../evaluate/studioIntents'

/**
 * Trộn clip kiểu iClone (K1): các hàm thuần trên danh sách MotionClip.
 * Quy ước khung: `frameStart/frameEnd` như timeline hiện có (hai clip sát nhau có frameEnd(A) == frameStart(B)
 * là KHÔNG chồng). Vùng trộn của clip sau B là [B.frameStart, B.frameStart + frames - 1] và kết thúc đúng
 * tại A.frameEnd khi tạo bằng kéo thả, nên `frames = A.frameEnd - B.frameStart + 1`.
 */

export const DEFAULT_BLEND_SECONDS = 0.5
export const MIN_BLEND_FRAMES = 2

/** Số khung trộn mặc định (0,5 giây quy ra frame của timeline). */
export function defaultBlendFrames(fps: number): number {
  return Math.max(MIN_BLEND_FRAMES, Math.round(DEFAULT_BLEND_SECONDS * (fps > 0 ? fps : 30)))
}

const clipLength = (clip: Pick<MotionClip, 'frameStart' | 'frameEnd'>) => clip.frameEnd - clip.frameStart + 1
const halfOpenOverlap = (a: MotionClip, b: MotionClip) => a.frameStart < b.frameEnd && b.frameStart < a.frameEnd

/** Số khung trộn tối đa cho cặp (A, B): không quá nửa clip ngắn hơn. */
export function maxBlendFrames(a: MotionClip, b: MotionClip): number {
  return Math.max(0, Math.floor(Math.min(clipLength(a), clipLength(b)) / 2))
}

/**
 * Mọi cặp clip chồng nhau (cùng nhân vật) phải là cặp trộn hợp lệ (clip sau có blendIn trỏ đúng clip trước,
 * vùng chồng nằm trong vùng trộn) và không có 3 clip chồng nhau cùng lúc.
 */
export function motionOverlapsValid(clips: readonly MotionClip[]): boolean {
  const byNode = new Map<string, MotionClip[]>()
  for (const clip of clips) {
    const list = byNode.get(clip.target.nodeId)
    if (list) list.push(clip)
    else byNode.set(clip.target.nodeId, [clip])
  }
  for (const list of byNode.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]
        const y = list[j]
        if (!halfOpenOverlap(x, y)) continue
        const [a, b] = x.frameStart <= y.frameStart ? [x, y] : [y, x]
        if (a.frameStart === b.frameStart) return false
        const blend = motionBlendInOf(b)
        if (!blend || motionBlendPartner(list, b) !== a) return false
        if (a.frameEnd > b.frameStart + blend.frames - 1) return false
        for (let k = j + 1; k < list.length; k++) {
          if (halfOpenOverlap(list[k], x) && halfOpenOverlap(list[k], y)) return false
        }
      }
    }
  }
  return true
}

function withBlend(clip: MotionClip, blend: MotionBlendIn | null): MotionClip {
  const { blendIn: _old, ...rest } = clip.playback
  void _old
  return { ...clip, playback: blend ? { ...rest, blendIn: blend } : rest }
}

function defaultBlend(frames: number, previous?: MotionBlendIn | null): MotionBlendIn {
  return {
    frames,
    curve: previous?.curve ?? 'smooth',
    footLock: true,
    ...(previous?.mirror !== undefined ? { mirror: previous.mirror } : {}),
    ...(previous?.phaseOffsetSeconds !== undefined ? { phaseOffsetSeconds: previous.phaseOffsetSeconds } : {}),
  }
}

/** Bỏ blendIn không còn hợp lệ (không còn clip trước phủ vùng trộn, hoặc hai clip không còn chồng nhau). */
export function normalizeBlendIns(clips: readonly MotionClip[]): MotionClip[] {
  return clips.map((clip) => {
    if (!clip.playback.blendIn) return clip
    const partner = motionBlendPartner(clips, clip)
    return partner && halfOpenOverlap(partner, clip) ? clip : withBlend(clip, null)
  })
}

export interface BlendDragResult {
  positions: Record<string, { frameStart: number; frameEnd: number }>
  pointerFrame: number
  frameEnd: number
  /** Clip sau (nhận blendIn) và số khung trộn sẽ ghi khi thả. */
  blendClipId: string
  frames: number
}

/**
 * Kéo clip `clipId` tới `requestedStart`: nếu nó chồng lên đúng một clip bên cạnh (đuôi A hoặc đầu B)
 * thì trả bố cục mà các clip khác KHÔNG bị đẩy, kèm blendIn cần ghi; ngược lại null để dùng cách kéo cũ.
 */
export function previewBlendDrag(
  track: readonly MotionClip[],
  clipId: string,
  requestedStart: number,
  minFrame: number,
): BlendDragResult | null {
  const dragged = track.find((clip) => clip.id === clipId)
  if (!dragged || !Number.isFinite(requestedStart)) return null
  const start = Math.max(minFrame, Math.round(requestedStart))
  const duration = dragged.frameEnd - dragged.frameStart
  const moved: MotionClip = { ...dragged, frameStart: start, frameEnd: start + duration }
  const others = track.filter((clip) => clip.id !== clipId && clip.target.nodeId === dragged.target.nodeId)
  const candidates: Array<{ later: MotionClip; earlier: MotionClip; frames: number }> = []
  for (const other of others) {
    // Clip kéo là clip sau: đầu nó đè lên đuôi `other`.
    if (other.frameStart < moved.frameStart && moved.frameStart < other.frameEnd && other.frameEnd <= moved.frameEnd) {
      candidates.push({ later: moved, earlier: other, frames: other.frameEnd - moved.frameStart + 1 })
    }
    // Clip kéo là clip trước: đuôi nó đè lên đầu `other`.
    if (moved.frameStart < other.frameStart && other.frameStart < moved.frameEnd && moved.frameEnd <= other.frameEnd) {
      candidates.push({ later: other, earlier: moved, frames: moved.frameEnd - other.frameStart + 1 })
    }
  }
  for (const { later, earlier, frames } of candidates) {
    if (frames < MIN_BLEND_FRAMES || frames > maxBlendFrames(earlier, later)) continue
    const layout = track.map((clip) => (clip.id === clipId ? moved : clip))
    const next = layout.map((clip) => (clip.id === later.id ? withBlend(clip, defaultBlend(frames, clip.playback.blendIn)) : clip))
    if (!motionOverlapsValid(normalizeBlendIns(next))) continue
    const positions: BlendDragResult['positions'] = {}
    for (const clip of layout) positions[clip.id] = { frameStart: clip.frameStart, frameEnd: clip.frameEnd }
    return {
      positions,
      pointerFrame: moved.frameStart,
      frameEnd: Math.max(minFrame, ...layout.map((clip) => clip.frameEnd)),
      blendClipId: later.id,
      frames,
    }
  }
  return null
}

/** Áp kết quả kéo: dời clip, ghi blendIn cho clip sau, bỏ các blendIn hết hiệu lực. Các clip khác không dời. */
export function applyBlendDrag(clips: readonly MotionClip[], result: BlendDragResult): MotionClip[] {
  const placed = clips.map((clip) => {
    const position = result.positions[clip.id]
    const next = position ? { ...clip, ...position } : clip
    return next.id === result.blendClipId ? withBlend(next, defaultBlend(result.frames, next.playback.blendIn)) : next
  })
  return normalizeBlendIns(placed)
}

/** Chuột phải "Trộn với clip trước": clip sát clip trước (cách 0–1 khung) -> dời sớm `frames` khung và đặt blendIn. */
export function blendWithPrevious(
  clips: readonly MotionClip[],
  clipId: string,
  fps: number,
  minFrame = 0,
): MotionClip[] | null {
  const clip = clips.find((item) => item.id === clipId)
  if (!clip || clip.playback.blendIn) return null
  let previous: MotionClip | null = null
  for (const other of clips) {
    if (other.id === clip.id || other.target.nodeId !== clip.target.nodeId) continue
    const gap = clip.frameStart - other.frameEnd
    if (other.frameStart >= clip.frameStart || gap < 0 || gap > 1) continue
    if (!previous || other.frameEnd > previous.frameEnd) previous = other
  }
  if (!previous) return null
  const frames = Math.min(defaultBlendFrames(fps), maxBlendFrames(previous, clip))
  if (frames < MIN_BLEND_FRAMES) return null
  const newStart = previous.frameEnd + 1 - frames
  if (newStart <= previous.frameStart || newStart < minFrame) return null
  const shift = clip.frameStart - newStart
  const next = clips.map((item) => (item.id === clip.id
    ? withBlend({ ...item, frameStart: item.frameStart - shift, frameEnd: item.frameEnd - shift }, defaultBlend(frames))
    : item))
  return motionOverlapsValid(next) ? next : null
}

/**
 * Đổi số khung trộn: clip sau dời (đầu clip sau lùi/tiến) để vùng trộn vẫn kết thúc tại cùng một khung.
 * null nếu kết quả không hợp lệ (quá dài/ngắn, đụng clip khác).
 */
export function setBlendFrames(
  clips: readonly MotionClip[],
  clipId: string,
  frames: number,
  minFrame = 0,
): MotionClip[] | null {
  const clip = clips.find((item) => item.id === clipId)
  const blend = clip && motionBlendInOf(clip)
  const partner = clip ? motionBlendPartner(clips, clip) : null
  if (!clip || !blend || !partner || !Number.isFinite(frames)) return null
  const next = Math.round(frames)
  if (next < MIN_BLEND_FRAMES || next > maxBlendFrames(partner, clip)) return null
  const delta = next - blend.frames
  if (delta === 0) return [...clips]
  const frameStart = clip.frameStart - delta
  if (frameStart <= partner.frameStart || frameStart < minFrame) return null
  const result = clips.map((item) => (item.id === clip.id
    ? withBlend({ ...item, frameStart, frameEnd: item.frameEnd - delta }, { ...blend, frames: next })
    : item))
  return motionOverlapsValid(result) ? result : null
}

export function setBlendCurve(clips: readonly MotionClip[], clipId: string, curve: MotionBlendIn['curve']): MotionClip[] | null {
  const clip = clips.find((item) => item.id === clipId)
  const blend = clip && motionBlendInOf(clip)
  if (!clip || !blend || blend.curve === curve) return null
  return clips.map((item) => (item.id === clipId ? withBlend(item, { ...blend, curve }) : item))
}

/** "Bỏ trộn": xóa blendIn và đẩy clip sau (và các clip nối tiếp) ra khỏi vùng chồng như cách cũ. */
export function removeBlend(clips: readonly MotionClip[], clipId: string): MotionClip[] | null {
  const clip = clips.find((item) => item.id === clipId)
  if (!clip?.playback.blendIn) return null
  const partner = motionBlendPartner(clips, clip)
  const cleared = withBlend(clip, null)
  if (!partner || partner.frameEnd <= clip.frameStart) return clips.map((item) => (item.id === clipId ? cleared : item))
  const length = clip.frameEnd - clip.frameStart
  const frameStart = partner.frameEnd
  const sameTarget = clips
    .filter((item) => item.id !== clipId && item.target.nodeId === clip.target.nodeId)
    .sort((a, b) => a.frameStart - b.frameStart)
  const shifted = shiftOverlappingMotionClips(sameTarget, frameStart, frameStart + length)
  return clips.map((item) => (item.id === clipId
    ? { ...cleared, frameStart, frameEnd: frameStart + length }
    : shifted.get(item.id) ?? item))
}

/** Văn bản hover của dải X. */
export function blendBandLabel(blend: MotionBlendIn): string {
  return `Trộn ${blend.frames} khung · ${blend.curve === 'linear' ? 'Tuyến tính' : 'Êm đầu-cuối'}`
}

export interface BlendOptionsPatch {
  /** Đảo chân: lật trái-phải toàn bộ clip sau. */
  mirror?: boolean
  /** Khớp nhịp bước: dời điểm bắt đầu đọc động tác gốc (giây). null hoặc 0 = bỏ khớp nhịp. */
  phaseOffsetSeconds?: number | null
}

/** K3: bật/tắt Đảo chân và đặt/bỏ độ dời nhịp bước của clip sau. null nếu clip không có blendIn hoặc không đổi gì. */
export function setBlendOptions(clips: readonly MotionClip[], clipId: string, patch: BlendOptionsPatch): MotionClip[] | null {
  const clip = clips.find((item) => item.id === clipId)
  const blend = clip && motionBlendInOf(clip)
  if (!clip || !blend) return null
  const { mirror: _mirror, phaseOffsetSeconds: _phase, ...rest } = blend
  void _mirror; void _phase
  const mirror = patch.mirror !== undefined ? patch.mirror : blend.mirror === true
  const phase = patch.phaseOffsetSeconds !== undefined ? patch.phaseOffsetSeconds : blend.phaseOffsetSeconds ?? null
  const phaseValue = phase === null || !Number.isFinite(phase) || phase === 0 ? null : phase
  if (mirror === (blend.mirror === true) && phaseValue === (blend.phaseOffsetSeconds ?? null)) return null
  const next: MotionBlendIn = { ...rest, ...(mirror ? { mirror: true } : {}), ...(phaseValue !== null ? { phaseOffsetSeconds: phaseValue } : {}) }
  return clips.map((item) => (item.id === clipId ? withBlend(item, next) : item))
}
