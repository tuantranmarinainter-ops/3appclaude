import { useEffect, useState } from 'react'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { formatExportTime, parseExportTime, type ExportTimeUnit } from './utils'

const UNITS: readonly ExportTimeUnit[] = ['frames', 'seconds']

export function ExportTimeUnitToggle({
  value,
  disabled,
  onChange,
}: {
  value: ExportTimeUnit
  disabled?: boolean
  onChange: (unit: ExportTimeUnit) => void
}) {
  const t = useT()
  return (
    <span className="t3d-export-unit" role="group" aria-label={t('export.timeUnit')}>
      {UNITS.map((unit) => (
        <button
          key={unit}
          type="button"
          className={cx(value === unit && 'is-active')}
          aria-pressed={value === unit}
          disabled={disabled}
          onClick={() => onChange(unit)}
        >
          {t(unit === 'frames' ? 'export.unitFrames' : 'export.unitSeconds')}
        </button>
      ))}
    </span>
  )
}

export function ExportTimeInput({
  value,
  fps,
  unit,
  disabled,
  ariaLabel,
  title,
  onCommit,
}: {
  value: number
  fps: number
  unit: ExportTimeUnit
  disabled?: boolean
  ariaLabel: string
  title?: string
  onCommit: (frame: number) => void
}) {
  const formatted = formatExportTime(value, fps, unit)
  const [text, setText] = useState(formatted)
  useEffect(() => setText(formatted), [formatted])

  const commit = () => {
    const parsed = parseExportTime(text, fps, unit)
    if (parsed == null) {
      setText(formatted)
      return
    }
    onCommit(parsed)
    setText(formatted)
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className="t3d-export-time-input"
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          const step = event.shiftKey ? Math.max(1, Math.round(fps)) : 1
          onCommit(Math.round(value) + (event.key === 'ArrowUp' ? step : -step))
        }
      }}
    />
  )
}
