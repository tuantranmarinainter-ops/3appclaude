import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { TranslateFn } from '../../locale'
import type { LibraryTab } from '../../stores/types'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { TAB_LABEL, TAB_ORDER } from './constants'
import { IconChevron, TAB_ICON } from './icons'

function textWidth(sample: HTMLElement, text: string, size: number) {
  const style = getComputedStyle(sample)
  const probe = document.createElement('span')
  probe.textContent = text
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.whiteSpace = 'nowrap'
  probe.style.font = style.font
  probe.style.fontSize = `${size}px`
  probe.style.letterSpacing = '-0.02em'
  document.body.appendChild(probe)
  const width = probe.offsetWidth
  probe.remove()
  return width
}

function unclampedHeight(el: HTMLElement) {
  const probe = el.cloneNode(true)
  if (!(probe instanceof HTMLElement) || !el.parentElement) return el.clientHeight
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  probe.style.display = 'block'
  probe.style.overflow = 'visible'
  probe.style.width = `${el.clientWidth}px`
  probe.style.fontSize = el.style.fontSize
  probe.style.setProperty('-webkit-line-clamp', 'unset')
  probe.style.setProperty('line-clamp', 'unset')
  el.parentElement.appendChild(probe)
  const height = probe.offsetHeight
  probe.remove()
  return height
}

function RailTabButton({
  label,
  active,
  icon: Icon,
  onSelect,
}: {
  label: string
  active: boolean
  icon: (props: { className?: string }) => ReactElement
  onSelect: () => void
}): ReactElement {
  const labelRef = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const el = labelRef.current
    if (!el) return
    const fit = () => {
      const width = el.clientWidth
      if (width <= 0) return
      const words = label.split(/\s+/).filter(Boolean)
      const room = Math.max(0, width - 1)
      let size = 11
      while (size > 8 && words.some((word) => textWidth(el, word, size) > room)) size -= 0.5
      if (words.some((word) => textWidth(el, word, size) > room)) {
        const widest = Math.max(...words.map((word) => textWidth(el, word, size)))
        if (widest > 0) size = Math.floor((room / widest) * size * 10) / 10
      }
      el.style.fontSize = Math.abs(size - 11) < 0.01 ? '' : `${size}px`
      setTruncated(unclampedHeight(el) > el.clientHeight + 1)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [label])

  const button = (
    <button
      type="button"
      className={cx('t3d-leftrail-rail-btn', active && 't3d-leftrail-rail-btn-active')}
      onClick={onSelect}
    >
      <Icon />
      <span ref={labelRef} className="t3d-leftrail-rail-label">
        {label}
      </span>
    </button>
  )
  if (!truncated) return button
  return (
    <Tooltip label={label} side="right">
      {button}
    </Tooltip>
  )
}

export function IconRail({
  tab,
  open,
  t,
  onSelect,
  onToggle,
  tabs = TAB_ORDER,
}: {
  tab: LibraryTab
  open: boolean
  t: TranslateFn
  onSelect: (tab: LibraryTab) => void
  onToggle: () => void
  tabs?: readonly LibraryTab[]
}): ReactElement {
  return (
    <div className="t3d-leftrail-rail">
      {tabs.map((id) => (
        <div key={id} className="t3d-leftrail-rail-item">
          <RailTabButton
            label={t(TAB_LABEL[id])}
            active={tab === id}
            icon={TAB_ICON[id]}
            onSelect={() => onSelect(id)}
          />
          {id === 'object' ? <div className="t3d-leftrail-rail-divider" role="separator" /> : null}
        </div>
      ))}
      {open ? null : (
        <Tooltip label={t('library.expandContent')} side="right">
          <button type="button" className="t3d-leftrail-expand" onClick={onToggle}>
            <IconChevron className="t3d-leftrail-chevron-expand" />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
