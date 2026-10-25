import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  GROUND_CELL_SIZES,
  type GroundViewOptions,
  type GroundViewStyle,
} from '../../contract/groundView'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { IconGrid } from '../leftrail/icons'
import { useGroundViewOptions } from './hooks/useGroundViewOptions'

const STYLE_ORDER: readonly GroundViewStyle[] = ['bw', 'color', 'numbers']

export function GroundViewControls(): ReactElement {
  const t = useT()
  const [options, setOptions] = useGroundViewOptions()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target
      if (target instanceof Node && wrapRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open ])

  const patch = (next: Partial<GroundViewOptions>) => setOptions({ ...options, ...next })
  const styleLabel = (style: GroundViewStyle): string => (
    style === 'bw'
      ? t('viewport.floorStyleBw')
      : style === 'color'
        ? t('viewport.floorStyleColor')
        : t('viewport.floorStyleNumbers')
  )
  const opacityPercent = Math.round(options.opacity * 100)

  return (
    <div ref={wrapRef} className="t3d-ground-view">
      <Tooltip label={open ? '' : t('viewport.floor')} side="top">
        <button
          type="button"
          className={cx('t3d-gizmo-btn', (open || options.enabled) && 't3d-gizmo-btn-active')}
          aria-label={t('viewport.floor')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconGrid />
        </button>
      </Tooltip>
      {open ? (
        <div className="t3d-ground-view-panel" role="dialog" aria-label={t('viewport.floor')}>
          <label className="t3d-ground-view-row t3d-ground-view-toggle">
            <input
              type="checkbox"
              checked={options.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            <span>{t('viewport.floorChecker')}</span>
          </label>
          <div className="t3d-ground-view-row">
            <span className="t3d-ground-view-label">{t('viewport.floorStyle')}</span>
            <div className="t3d-ground-view-seg" role="group">
              {STYLE_ORDER.map((style) => (
                <button
                  key={style}
                  type="button"
                  disabled={!options.enabled}
                  className={cx(options.style === style && 'is-active')}
                  aria-pressed={options.style === style}
                  onClick={() => patch({ style })}
                >
                  {styleLabel(style)}
                </button>
              ))}
            </div>
          </div>
          <div className="t3d-ground-view-row">
            <span className="t3d-ground-view-label">{t('viewport.floorCellSize')}</span>
            <div className="t3d-ground-view-seg" role="group">
              {GROUND_CELL_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  disabled={!options.enabled}
                  className={cx(options.cellSize === size && 'is-active')}
                  aria-pressed={options.cellSize === size}
                  onClick={() => patch({ cellSize: size })}
                >
                  {`${String(size).replace('.', ',')} m`}
                </button>
              ))}
            </div>
          </div>
          <div className="t3d-ground-view-row">
            <span className="t3d-ground-view-label">{t('viewport.floorOpacity')}</span>
            <input
              type="range"
              min={15}
              max={100}
              step={5}
              disabled={!options.enabled}
              value={opacityPercent}
              aria-label={t('viewport.floorOpacity')}
              onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
            />
            <span className="t3d-ground-view-value">{`${opacityPercent}%`}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
