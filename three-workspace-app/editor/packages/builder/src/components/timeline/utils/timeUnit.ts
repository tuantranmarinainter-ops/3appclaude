import type { TimelineUnit } from '../../../stores/types'

/** Đơn vị hiển thị của timeline: giây / frame / tick BBS (20 Hz). */
export type { TimelineUnit }

/** BBS FS lấy mẫu ở 20 Hz: 1 tick = 1/20 giây. */
export const BBS_TICK_RATE = 20

export const TIMELINE_UNIT_STORAGE_KEY = 'topview.builder.timeline.unit'

export function isTimelineUnit(value: unknown): value is TimelineUnit {
  return value === 'seconds' || value === 'frames' || value === 'ticks'
}

/** Frame → giá trị theo đơn vị đang chọn. */
export function frameToUnitValue(frame: number, fps: number, unit: TimelineUnit): number {
  const safeFps = fps > 0 ? fps : 30
  if (unit === 'frames') return frame
  if (unit === 'seconds') return frame / safeFps
  return (frame * BBS_TICK_RATE) / safeFps
}

/** Giá trị nhập theo đơn vị → frame nguyên gần nhất. */
export function unitValueToFrame(value: number, fps: number, unit: TimelineUnit): number {
  const safeFps = fps > 0 ? fps : 30
  if (!Number.isFinite(value)) return 0
  if (unit === 'frames') return Math.round(value)
  if (unit === 'seconds') return Math.round(value * safeFps)
  return Math.round((value * safeFps) / BBS_TICK_RATE)
}

/** Nhãn gọn cho một frame theo đơn vị: "1.5s" / "45f" / "30t". */
export function formatFrameInUnit(frame: number, fps: number, unit: TimelineUnit): string {
  const value = frameToUnitValue(frame, fps, unit)
  if (unit === 'frames') return `${Math.round(value)}f`
  if (unit === 'ticks') return `${Number(value.toFixed(1))}t`
  return `${Number(value.toFixed(2))}s`
}

/** Nhãn độ dài một khoảng frame (dùng cho nhãn clip). */
export function formatDurationInUnit(frameCount: number, fps: number, unit: TimelineUnit): string {
  return formatFrameInUnit(frameCount, fps, unit)
}

const MIN_LABEL_PX = 70

/**
 * Thước theo đơn vị: chọn bước (tính bằng frame) sao cho nhãn cách nhau >= 70 px.
 * Với tick, bước phải cho số frame nguyên ở fps hiện tại (30 fps → 2 tick = 3 frame).
 */
export function timelineUnitRuler(
  pxPerFrame: number,
  fps: number,
  unit: TimelineUnit,
): { step: number; format: (frame: number) => string } {
  const safeFps = fps > 0 ? fps : 30
  if (unit === 'frames') {
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
      .find((candidate) => candidate * pxPerFrame >= MIN_LABEL_PX) ?? 5000
    return { step, format: (frame) => formatFrameInUnit(frame, safeFps, 'frames') }
  }
  if (unit === 'seconds') {
    const stepSeconds = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600]
      .find((candidate) => candidate * safeFps * pxPerFrame >= MIN_LABEL_PX) ?? 600
    return { step: stepSeconds * safeFps, format: (frame) => formatFrameInUnit(frame, safeFps, 'seconds') }
  }
  const stepTicks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
    .find((candidate) => {
      const frames = (candidate * safeFps) / BBS_TICK_RATE
      return Number.isInteger(frames) && frames * pxPerFrame >= MIN_LABEL_PX
    }) ?? 1000
  return { step: (stepTicks * safeFps) / BBS_TICK_RATE, format: (frame) => formatFrameInUnit(frame, safeFps, 'ticks') }
}

type UnitStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Đọc lựa chọn đơn vị đã lưu; mặc định 'frames' như các ô nhập frame hiện tại. */
export function readTimelineUnit(storage: UnitStorage | null): TimelineUnit {
  if (!storage) return 'frames'
  try {
    const value = storage.getItem(TIMELINE_UNIT_STORAGE_KEY)
    return isTimelineUnit(value) ? value : 'frames'
  } catch {
    return 'frames'
  }
}

export function writeTimelineUnit(storage: UnitStorage | null, unit: TimelineUnit): void {
  if (!storage) return
  try {
    storage.setItem(TIMELINE_UNIT_STORAGE_KEY, unit)
  } catch {
    // Storage bị tắt/đầy: lựa chọn chỉ sống trong phiên này.
  }
}
