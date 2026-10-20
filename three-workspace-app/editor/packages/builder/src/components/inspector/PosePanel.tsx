import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { findMotionClipAt } from '../../contract/parser'
import { DEFAULT_SKY_COLOR, normalizeSkyHex } from '../../contract/skyColor'
import type { DraftNode } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { useThrottledFrame } from '../../bridge/useEngineEvent'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { FieldHelp } from '../common/FieldHelp'
import { SliderNumberControl } from '../common/SliderNumberControl'
import { IconChevron } from '../leftrail/icons'
import { PoseLibraryGrid } from './PoseLibraryGrid'

/** 姿势面板：姿势库预设。 */
export function PosePanel({ node }: { node: DraftNode }) {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const frame = useThrottledFrame()
  const applyPosePreset = useStore((s) => s.applyPosePreset)
  if (!doc || !node.character) return null

  const anim = node.character.animation
  const clipActive = !!findMotionClipAt(doc, node.id, frame)

  return (
    <div className="t3d-pose">
      <div className="t3d-pose-body">
        {anim.mode !== 'pose' && (
          <div className="t3d-pose-hint">{t('inspector.poseModeHint', { mode: anim.mode })}</div>
        )}
        {clipActive && (
          <div className="t3d-pose-hint">{t('inspector.poseClipHint')}</div>
        )}
        <PoseLibraryGrid
          selectedId={anim.posePresetId}
          disabled={node.locked}
          onSelect={(id) => applyPosePreset(node.id, id)}
        />
      </div>
    </div>
  )
}

/** 多选且全是人物时的姿势面板：预设同时作用到未锁定的人物。 */
export function MultiPosePanel({ nodes }: { nodes: DraftNode[] }): ReactElement | null {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const frame = useThrottledFrame()
  const applyPosePresets = useStore((s) => s.applyPosePresets)
  const characters = nodes.filter((node) => node.character)
  if (!doc || characters.length === 0) return null

  const editable = characters.filter((node) => !node.locked)
  const presetIds = characters.map((node) => node.character?.animation.posePresetId)
  const sharedPreset = presetIds.every((id) => id === presetIds[0]) ? presetIds[0] : undefined
  const nonPose = characters.find((node) => node.character?.animation.mode !== 'pose')
  const clipActive = characters.some((node) => findMotionClipAt(doc, node.id, frame))
  const ids = editable.map((node) => node.id)

  return (
    <div className="t3d-pose">
      <div className="t3d-pose-body">
        {nonPose?.character ? (
          <div className="t3d-pose-hint">{t('inspector.poseModeHint', { mode: nonPose.character.animation.mode })}</div>
        ) : null}
        {clipActive ? <div className="t3d-pose-hint">{t('inspector.poseClipHint')}</div> : null}
        <PoseLibraryGrid
          selectedId={sharedPreset}
          disabled={editable.length === 0}
          onSelect={(id) => applyPosePresets(ids, id)}
        />
      </div>
    </div>
  )
}

export function InspectorSection({
  title,
  children,
  defaultOpen = true,
  collapsible = true,
  extra,
}: {
  title: string
  children?: ReactNode
  defaultOpen?: boolean
  collapsible?: boolean
  extra?: ReactNode
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const shown = !collapsible || open
  return (
    <section className="t3d-inspector-section">
      <div className={cx('t3d-inspector-section-head-row', collapsible && 'is-collapsible')}>
        {collapsible ? (
          <button
            type="button"
            className="t3d-inspector-section-head"
            aria-disabled="false"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {title}
          </button>
        ) : (
          <div className="t3d-inspector-section-head is-static">{title}</div>
        )}
        {extra}
        {collapsible ? (
          <button
            type="button"
            className="t3d-inspector-section-toggle"
            tabIndex={-1}
            aria-hidden
            onClick={() => setOpen((v) => !v)}
          >
            <IconChevron className={cx('t3d-inspector-chevron', open && 'is-open')} />
          </button>
        ) : null}
      </div>
      {shown && children != null ? <div className="t3d-inspector-section-body">{children}</div> : null}
    </section>
  )
}

export function ToggleRow({
  label,
  helpText,
  checked,
  onChange,
  disabled,
}: {
  label: string
  helpText?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): ReactElement {
  const [ready, setReady] = useState(false)
  return (
    <label className="t3d-inspector-row t3d-inspector-row-toggle">
      <span>{label}{helpText && <FieldHelp text={helpText} />}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={cx('t3d-inspector-switch', checked && 'is-on', ready && 'is-init')}
        onClick={() => {
          if (disabled) return
          setReady(true)
          onChange(!checked)
        }}
      >
        <span className="t3d-inspector-switch-thumb" />
      </button>
    </label>
  )
}

export function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  const pickingRef = useRef(false)
  onChangeRef.current = onChange
  const hex = normalizeHex(value)

  // 取色器打开时回写 value 会让 Chromium 不再派发后续 input，选完色就点不动。
  useEffect(() => {
    const input = inputRef.current
    if (!input || pickingRef.current) return
    if (input.value.toLowerCase() !== hex.toLowerCase()) input.value = hex
  }, [hex])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const finish = () => {
      onChangeRef.current(input.value)
      // React 的 onChange 也会接到这次 change，并在本轮把 picking 再置上。
      // 微任务里再清掉，关掉取色器之后才能继续同步。
      queueMicrotask(() => {
        pickingRef.current = false
      })
    }
    const stop = () => {
      pickingRef.current = false
    }
    input.addEventListener('change', finish)
    input.addEventListener('blur', stop)
    return () => {
      input.removeEventListener('change', finish)
      input.removeEventListener('blur', stop)
    }
  }, [])

  return (
    <label className="t3d-inspector-row">
      <span>{label}</span>
      <span className="t3d-inspector-color">
        <span className="t3d-inspector-swatch" style={{ backgroundColor: hex }}>
          <input
            ref={inputRef}
            type="color"
            defaultValue={hex}
            aria-label={label}
            onPointerDown={() => {
              pickingRef.current = true
            }}
            onChange={(e) => {
              pickingRef.current = true
              onChange(e.target.value)
            }}
          />
        </span>
        <em>{hex}</em>
      </span>
    </label>
  )
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  unit,
  disabled,
  stacked,
  className,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  unit?: string
  disabled?: boolean
  stacked?: boolean
  className?: string
  onChange: (next: number) => void
}): ReactElement {
  return (
    <div className={cx('t3d-inspector-row', stacked ? 't3d-inspector-row-slider-stack' : 't3d-inspector-row-inline', className)}>
      <SliderNumberControl label={label} min={min} max={max} step={step} value={value}
        precision={step >= 1 ? 0 : 2} unit={unit ?? (display.endsWith('%') ? '%' : '')}
        disabled={disabled} onChange={onChange} />
    </div>
  )
}

export { XyzRow } from '../common/TransformGroup'

export function FieldRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="t3d-inspector-row">
      <span>{label}</span>
      <em>{value}</em>
    </div>
  )
}

function normalizeHex(value: string): string {
  return normalizeSkyHex(value) ?? DEFAULT_SKY_COLOR
}
