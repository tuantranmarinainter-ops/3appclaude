export type PanelSizeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function clampPanelSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function resizePanelSize(start: number, pointerDelta: number, direction: 1 | -1, min: number, max: number): number {
  return clampPanelSize(start + pointerDelta * direction, min, max)
}

export function readPanelSize(
  storage: PanelSizeStorage | null,
  key: string,
  fallback: number,
  clamp: (value: number) => number,
): number {
  if (!storage) return clamp(fallback)
  try {
    const parsed = Number(storage.getItem(key))
    return Number.isFinite(parsed) && parsed > 0 ? clamp(parsed) : clamp(fallback)
  } catch {
    return clamp(fallback)
  }
}

export function writePanelSize(storage: PanelSizeStorage | null, key: string, value: number): void {
  if (!storage) return
  try {
    storage.setItem(key, String(Math.round(value)))
  } catch {
    // Storage can be disabled or full; resizing still works for this session.
  }
}

export function clearPanelSize(storage: PanelSizeStorage | null, key: string): void {
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // A reset still applies in memory when storage is unavailable.
  }
}

export function browserPanelStorage(): PanelSizeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
