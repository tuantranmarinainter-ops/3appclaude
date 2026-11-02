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

export interface AnchorRect { left: number; top: number; bottom: number }

/**
 * Đặt bảng nổi cạnh một phần tử neo: ưu tiên bên dưới, nếu không đủ chỗ thì lật lên trên,
 * nếu vẫn không đủ thì dán vào mép cửa sổ và trả maxHeight để bảng tự cuộn. Không bao giờ ra ngoài cửa sổ.
 */
export function placeAnchoredPanel(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 4,
): { x: number; y: number; maxHeight: number } {
  const maxHeight = Math.max(80, viewport.height - margin * 2)
  const height = Math.min(size.height, maxHeight)
  const below = anchor.bottom + gap
  const above = anchor.top - gap - height
  let y: number
  if (below + height + margin <= viewport.height) y = below
  else if (above >= margin) y = above
  else y = Math.max(margin, viewport.height - margin - height)
  const x = Math.max(margin, Math.min(anchor.left, viewport.width - margin - size.width))
  return { x, y, maxHeight }
}

export const TIMELINE_NOTICE_EVENT = 'topview:timeline-notice'

/** Small status line in the timeline; the panel listens and hides it after a few seconds. */
export function emitTimelineNotice(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TIMELINE_NOTICE_EVENT, { detail: message }))
}
