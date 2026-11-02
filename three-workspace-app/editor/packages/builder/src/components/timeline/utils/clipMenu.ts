/** Keep a fixed-position menu inside the viewport: flip up/left when it would overflow. */
export function clampMenuPosition(
  x: number,
  y: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 4,
): { x: number; y: number } {
  const flipX = x + size.width + margin > viewport.width
  const flipY = y + size.height + margin > viewport.height
  const nx = flipX ? x - size.width : x
  const ny = flipY ? y - size.height : y
  return {
    x: Math.max(margin, nx),
    y: Math.max(margin, ny),
  }
}

export const TIMELINE_NOTICE_EVENT = 'topview:timeline-notice'

/** Small status line in the timeline; the panel listens and hides it after a few seconds. */
export function emitTimelineNotice(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TIMELINE_NOTICE_EVENT, { detail: message }))
}
