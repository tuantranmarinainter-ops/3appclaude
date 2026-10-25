import { getLiveStudio } from './devtools/liveStudio'

/**
 * Khoảng In/Out của timeline cảnh (N4) làm mặc định cho "Mở shot từ cảnh" và Xuất film BBS.
 * In/Out sống trong EditorStore của builder (trạng thái phiên) và được mirror vào
 * localStorage theo project với khóa `topview.builder.timeline.inOut.<projectId>`
 * (định dạng JSON {"start":n,"end":n} — xem packages/builder/src/stores/inOutPreference.ts).
 */

export interface FrameRange { startFrame: number; endFrame: number }

/** BBS Film lấy mẫu trên lưới tick 20 Hz; một đoạn chứa tối đa 255 tick. */
export const BBS_TICK_RATE = 20

function gcd(a: number, b: number): number {
  let x = Math.abs(a), y = Math.abs(b)
  while (y) { const next = x % y; x = y; y = next }
  return x || 1
}

/**
 * Bước frame nhỏ nhất để độ dài khoảng luôn rơi đúng lưới 20 tick ở fps hiện tại
 * (30 fps -> 3 frame). Khớp hệt helper cùng tên của E2 trong filmFrame.ts (PR #122).
 */
export function filmGridFrameStep(fps: number): number {
  if (!Number.isSafeInteger(fps) || fps <= 0) return 1
  return fps / gcd(fps, BBS_TICK_RATE)
}

export interface FilmRangeAlignment {
  range: FrameRange
  changed: boolean
  /** Tổng số tick nguyên mà khoảng đã căn spans; bỏ qua khi không căn được trong timeline. */
  ticks?: number
}

/**
 * Làm tròn khoảng về lưới 20 tick: ưu tiên nới cuối khoảng; nếu vượt timeline thì rút ngắn;
 * cả hai đều không được thì giữ nguyên. Khớp hành vi E2 (PR #122): 0–27 @30fps -> 0–29.
 */
export function alignFilmRangeToTickGrid(
  range: FrameRange,
  fps: number,
  timeline: { frameStart: number; frameEnd: number },
): FilmRangeAlignment {
  const unchanged: FilmRangeAlignment = { range: { startFrame: range.startFrame, endFrame: range.endFrame }, changed: false }
  if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.endFrame < range.startFrame) return unchanged
  const step = filmGridFrameStep(fps)
  const frames = range.endFrame - range.startFrame + 1
  const remainder = frames % step
  const ticksFor = (count: number) => count * BBS_TICK_RATE / fps
  if (remainder === 0) return { range: { ...range }, changed: false, ticks: ticksFor(frames) }
  const extendedEnd = range.endFrame + (step - remainder)
  if (extendedEnd <= timeline.frameEnd) return { range: { startFrame: range.startFrame, endFrame: extendedEnd }, changed: true, ticks: ticksFor(extendedEnd - range.startFrame + 1) }
  const shortenedEnd = range.endFrame - remainder
  if (shortenedEnd >= range.startFrame) return { range: { startFrame: range.startFrame, endFrame: shortenedEnd }, changed: true, ticks: ticksFor(shortenedEnd - range.startFrame + 1) }
  return unchanged
}

export function timelineInOutStorageKey(projectId: string): string {
  return `topview.builder.timeline.inOut.${projectId}`
}

type InOutStorage = Pick<Storage, 'getItem'>

function defaultStorage(): InOutStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** In/Out đã mirror trong localStorage cho project; null khi chưa đặt. */
export function readStoredTimelineInOut(projectId: string, storage: InOutStorage | null = defaultStorage()): FrameRange | null {
  if (!storage || !projectId) return null
  try {
    const raw = storage.getItem(timelineInOutStorageKey(projectId))
    if (!raw) return null
    const value = JSON.parse(raw) as { start?: unknown; end?: unknown }
    if (typeof value?.start !== 'number' || typeof value?.end !== 'number') return null
    const start = Math.round(Math.min(value.start, value.end))
    const end = Math.round(Math.max(value.start, value.end))
    return { startFrame: start, endFrame: end }
  } catch {
    return null
  }
}

/** In/Out từ DirectorStudio đang mở (workspace cảnh); null khi Studio chưa/chưa sẵn sàng. */
export function readLiveTimelineInOut(): FrameRange | null {
  const state = getLiveStudio()?.useStore.getState()
  if (!state || state.inFrame == null || state.outFrame == null) return null
  return { startFrame: state.inFrame, endFrame: state.outFrame }
}

/**
 * Khoảng mặc định cho panel Xuất film / Mở shot từ cảnh: In/Out (live trước, mirror sau),
 * kẹp trong timeline rồi làm tròn về lưới 20 tick. Null khi chưa có In/Out nào.
 */
export function resolveTimelineInOutDefault(
  projectId: string,
  timeline: { frameStart: number; frameEnd: number; fps: number },
  storage?: InOutStorage | null,
): FrameRange | null {
  const raw = readLiveTimelineInOut() ?? readStoredTimelineInOut(projectId, storage)
  if (!raw) return null
  const startFrame = Math.max(raw.startFrame, timeline.frameStart)
  const endFrame = Math.min(raw.endFrame, timeline.frameEnd)
  if (endFrame < startFrame) return null
  return alignFilmRangeToTickGrid({ startFrame, endFrame }, timeline.fps, timeline).range
}
