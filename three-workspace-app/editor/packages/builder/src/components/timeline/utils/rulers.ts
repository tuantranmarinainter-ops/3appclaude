import type { TimelineUnit } from '../../../stores/types'

export const RULER_UNITS: readonly TimelineUnit[] = ['seconds', 'frames', 'ticks']
export const RULER_HEIGHT = 30
export const RULERS_STORAGE_KEY = 'topview.builder.timeline.rulers'

export type RulerVisibility = Record<TimelineUnit, boolean>

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Người dùng chốt 2026-11-05: mỗi lần mở timeline chỉ hiện thước Giây; Khung/Tick tắt, bật tay khi cần
 * (lựa chọn chỉ sống trong phiên đó, không nhớ sang lần mở sau).
 */
export function defaultRulerVisibility(_unit?: TimelineUnit): RulerVisibility {
  return { seconds: true, frames: false, ticks: false }
}

export function visibleRulers(visibility: RulerVisibility): TimelineUnit[] {
  const shown = RULER_UNITS.filter((unit) => visibility[unit])
  return shown.length ? shown : ['frames']
}

/** Toggle one ruler; the last visible ruler can not be hidden. */
export function toggleRuler(visibility: RulerVisibility, unit: TimelineUnit): RulerVisibility {
  const next = { ...visibility, [unit]: !visibility[unit] }
  return RULER_UNITS.some((item) => next[item]) ? next : visibility
}

export function readRulerVisibility(storage: StorageLike | null, fallbackUnit: TimelineUnit): RulerVisibility {
  const fallback = defaultRulerVisibility(fallbackUnit)
  if (!storage) return fallback
  try {
    const parsed = JSON.parse(storage.getItem(RULERS_STORAGE_KEY) ?? 'null') as Partial<RulerVisibility> | null
    if (!parsed || typeof parsed !== 'object') return fallback
    const next = { seconds: parsed.seconds === true, frames: parsed.frames === true, ticks: parsed.ticks === true }
    return RULER_UNITS.some((unit) => next[unit]) ? next : fallback
  } catch {
    return fallback
  }
}

export function writeRulerVisibility(storage: StorageLike | null, visibility: RulerVisibility): void {
  if (!storage) return
  try {
    storage.setItem(RULERS_STORAGE_KEY, JSON.stringify(visibility))
  } catch {
    // Storage off or full: the choice only lives for this session.
  }
}
