import { useRef, type PointerEvent } from 'react'
import { useEngineEvent } from '../../bridge/useEngineEvent'
import type { TimelineUnit } from '../../stores/types'
import { formatFrameInUnit, timelineUnitRuler } from './utils/timeUnit'

export function Ruler({
  frameStart,
  frameEnd,
  fps,
  unit,
  pxPerFrame,
  currentFrame,
  ariaLabel,
  rulerRef,
  scrubHandlers,
}: {
  frameStart: number
  frameEnd: number
  fps: number
  unit: TimelineUnit
  pxPerFrame: number
  currentFrame: number
  ariaLabel: string
  rulerRef: { current: HTMLDivElement | null }
  scrubHandlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: (event: PointerEvent<HTMLElement>) => void
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void
  }
}) {
  const labelRef = useRef<HTMLSpanElement>(null)
  const layoutRef = useRef({ start: frameStart, px: pxPerFrame, fps, unit })
  layoutRef.current = { start: frameStart, px: pxPerFrame, fps, unit }
  const sheet = timelineUnitRuler(pxPerFrame, fps, unit)
  const first = Math.floor(frameStart / sheet.step) * sheet.step
  const ticks: number[] = []
  for (let frame = first; frame <= frameEnd; frame += sheet.step) {
    if (frame >= frameStart) ticks.push(frame)
  }

  useEngineEvent('frame', (frame) => {
    const { start, px, fps: rate, unit: currentUnit } = layoutRef.current
    const el = labelRef.current
    if (!el) return
    el.style.left = `${(frame - start) * px}px`
    el.textContent = formatFrameInUnit(frame, rate, currentUnit)
  })

  return (
    <div className="t3d-timeline-row t3d-timeline-ruler-row">
      <div className="t3d-timeline-name t3d-timeline-ruler-name" />
      <div
        ref={rulerRef}
        className="t3d-timeline-track t3d-timeline-ruler"
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={frameStart}
        aria-valuemax={frameEnd}
        aria-valuenow={Math.round(currentFrame)}
        aria-valuetext={formatFrameInUnit(currentFrame, fps, unit)}
        tabIndex={0}
        {...scrubHandlers}
      >
        {ticks.map((frame) => (
          <span
            key={frame}
            className="t3d-timeline-tick"
            style={{ left: (frame - frameStart) * pxPerFrame }}
          >
            {sheet.format(frame)}
          </span>
        ))}
        <span
          ref={labelRef}
          className="t3d-timeline-cursor-label"
          style={{ left: (currentFrame - frameStart) * pxPerFrame }}
        >
          {formatFrameInUnit(currentFrame, fps, unit)}
        </span>
      </div>
    </div>
  )
}
