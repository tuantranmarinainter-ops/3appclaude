import { useRef, useState, type ReactNode } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useEngineEvent } from '../../bridge/useEngineEvent'
import { ScrubNumberInput } from '../common/ScrubNumberInput'
import type { TimelineUnit } from '../../stores/types'
import { frameToUnitValue, unitValueToFrame } from './utils/timeUnit'
import { Tooltip } from '../common/Tooltip'
import { cx } from '../common/cx'

export function TimelineFrameField({
  min,
  max,
  onChange,
  unit = 'frames',
  fps = 30,
}: {
  min: number
  max: number
  onChange: (n: number) => void
  /** Đơn vị hiển thị (N3); giá trị ra/vào vẫn là frame. */
  unit?: TimelineUnit
  fps?: number
}) {
  const { stage } = useDirector()
  const [frame, setFrame] = useState(() => Math.round(stage.currentFrame))
  const editingRef = useRef(false)
  useEngineEvent('frame', (next) => {
    if (!editingRef.current) setFrame(Math.round(next))
  })
  return (
    <ScrubNumberInput
      value={frameToUnitValue(frame, fps, unit)}
      min={frameToUnitValue(min, fps, unit)}
      max={frameToUnitValue(max, fps, unit)}
      step={unit === 'seconds' ? 0.1 : 1}
      precision={unit === 'frames' ? 0 : unit === 'ticks' ? 1 : 2}
      onEditStart={() => {
        editingRef.current = true
      }}
      onChange={(n) => {
        editingRef.current = true
        const next = unitValueToFrame(n, fps, unit)
        setFrame(next)
        onChange(next)
      }}
      onEditEnd={() => {
        editingRef.current = false
      }}
    />
  )
}

export function TimelineRangeField({
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  precision = 0,
  fixed,
  disabled,
  onBegin,
  onCommit,
  onEnd,
}: {
  label: string
  unit?: string
  value: number
  min?: number
  max?: number
  step?: number
  precision?: number
  fixed?: boolean
  disabled?: boolean
  onBegin: () => void
  onCommit: (n: number) => void
  onEnd: () => void
}) {
  return (
    <label className="t3d-timeline-field t3d-timeline-field-range">
      {label}
      <span className="t3d-timeline-field-value">
        <ScrubNumberInput
          value={value}
          min={min}
          max={max}
          step={step}
          precision={precision}
          fixed={fixed}
          disabled={disabled}
          onEditStart={onBegin}
          onChange={onCommit}
          onEditEnd={onEnd}
        />
        {unit ? <span className="t3d-timeline-field-unit">{unit}</span> : null}
      </span>
    </label>
  )
}

export function TransportButton({
  label,
  className,
  onClick,
  disabled,
  children,
}: {
  label: string
  className?: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        className={cx('t3d-timeline-icon-btn', className)}
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  )
}
