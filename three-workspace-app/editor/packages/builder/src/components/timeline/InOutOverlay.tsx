import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { LEFT_W, TRACK_INSET } from './constants'

/**
 * Vùng In/Out trên timeline cảnh (N4): nền mờ phủ khoảng + hai tay kéo ở mép.
 * Kéo tay nào thì mốc đó đi theo con trỏ (đã hút theo snap của timeline nếu có).
 */
export function InOutOverlay({
  frameStart,
  pxPerFrame,
  inFrame,
  outFrame,
  inLabel,
  outLabel,
  frameFromClientX,
  onSetIn,
  onSetOut,
}: {
  frameStart: number
  pxPerFrame: number
  inFrame: number | null
  outFrame: number | null
  inLabel: string
  outLabel: string
  frameFromClientX: (clientX: number) => number
  onSetIn: (frame: number) => void
  onSetOut: (frame: number) => void
}) {
  const dragRef = useRef<{ edge: 'in' | 'out'; pointerId: number } | null>(null)
  if (inFrame == null && outFrame == null) return null
  const start = inFrame ?? outFrame!
  const end = outFrame ?? inFrame!
  const left = LEFT_W + TRACK_INSET + (start - frameStart) * pxPerFrame
  const width = Math.max(2, (end - start + 1) * pxPerFrame)

  const beginDrag = (edge: 'in' | 'out') => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { edge, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const frame = Math.round(frameFromClientX(event.clientX))
    if (drag.edge === 'in') onSetIn(frame)
    else onSetOut(frame)
  }
  const endDrag = () => {
    dragRef.current = null
  }

  return (
    <div className="t3d-timeline-inout" style={{ left, width }}>
      {inFrame != null ? (
        <div
          className="t3d-timeline-inout-handle is-in"
          role="slider"
          aria-label={inLabel}
          aria-valuenow={inFrame}
          onPointerDown={beginDrag('in')}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      ) : null}
      {outFrame != null ? (
        <div
          className="t3d-timeline-inout-handle is-out"
          role="slider"
          aria-label={outLabel}
          aria-valuenow={outFrame}
          onPointerDown={beginDrag('out')}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      ) : null}
    </div>
  )
}
