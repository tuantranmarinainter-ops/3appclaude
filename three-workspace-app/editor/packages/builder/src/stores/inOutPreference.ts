/**
 * Mốc In/Out kiểu DaVinci cho timeline cảnh (N4): trạng thái phiên trong EditorStore,
 * không ghi vào document. Mirror sang localStorage theo draft để host (panel Xuất film /
 * Mở shot từ cảnh) đọc được khoảng mặc định kể cả khi DirectorStudio đã unmount.
 * Khóa: `topview.builder.timeline.inOut.<draftId>`, giá trị JSON {"start":n,"end":n}.
 */
export interface TimelineInOutRange {
  start: number
  end: number
}

export function timelineInOutStorageKey(draftId: string): string {
  return `topview.builder.timeline.inOut.${draftId}`
}

/** Chuẩn hoá một khoảng In/Out: số nguyên, start <= end. */
export function normalizeInOutRange(start: number, end: number): TimelineInOutRange | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const a = Math.round(start)
  const b = Math.round(end)
  return a <= b ? { start: a, end: b } : { start: b, end: a }
}

/** Kẹp khoảng In/Out vào trong timeline; null nếu giao nhau rỗng. */
export function clampInOutRange(
  range: TimelineInOutRange,
  timeline: { frameStart: number; frameEnd: number },
): TimelineInOutRange | null {
  const start = Math.max(range.start, timeline.frameStart)
  const end = Math.min(range.end, timeline.frameEnd)
  return start <= end ? { start, end } : null
}

export function parseTimelineInOut(raw: string | null): TimelineInOutRange | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as { start?: unknown; end?: unknown }
    if (typeof value?.start !== 'number' || typeof value?.end !== 'number') return null
    return normalizeInOutRange(value.start, value.end)
  } catch {
    return null
  }
}

export function serializeTimelineInOut(range: TimelineInOutRange): string {
  return JSON.stringify({ start: range.start, end: range.end })
}

type InOutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readTimelineInOut(storage: InOutStorage | null, draftId: string): TimelineInOutRange | null {
  if (!storage || !draftId) return null
  try {
    return parseTimelineInOut(storage.getItem(timelineInOutStorageKey(draftId)))
  } catch {
    return null
  }
}

export function writeTimelineInOut(storage: InOutStorage | null, draftId: string, range: TimelineInOutRange | null): void {
  if (!storage || !draftId) return
  try {
    if (range) storage.setItem(timelineInOutStorageKey(draftId), serializeTimelineInOut(range))
    else storage.removeItem(timelineInOutStorageKey(draftId))
  } catch {
    // Storage bị tắt/đầy: In/Out chỉ sống trong phiên.
  }
}

/** localStorage của trình duyệt, null khi không có (SSR/test). */
export function browserInOutStorage(): InOutStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
