import { useEffect, useRef, useState } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import type { LibraryTab } from '../../stores/types'
import { cx } from '../common/cx'
import { Tooltip } from '../common/Tooltip'
import { TAB_LABEL } from '../leftrail/constants'
import { IconPlus, TAB_ICON } from '../leftrail/icons'

const QUICK_TABS: readonly LibraryTab[] = ['character', 'prop', 'camera', 'cameraMotion', 'motion']

export function QuickAddMenu() {
  const t = useT()
  const { useStore } = useDirector()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

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
  }, [open])

  const label = t('viewport.quickAdd')
  return (
    <div ref={wrapRef} className="t3d-quick-add">
      <Tooltip label={open ? '' : label} side="top">
        <button
          type="button"
          className={cx('t3d-gizmo-btn', open && 't3d-gizmo-btn-active')}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconPlus />
        </button>
      </Tooltip>
      {open ? (
        <div className="t3d-dropdown-menu is-anchored t3d-quick-add-menu" data-placement="top" role="menu">
          {QUICK_TABS.map((tab) => {
            const Icon = TAB_ICON[tab]
            return (
              <button
                key={tab}
                type="button"
                role="menuitem"
                className="t3d-dropdown-option"
                onClick={() => {
                  setOpen(false)
                  useStore.getState().flashLibraryTab(tab)
                }}
              >
                <Icon className="t3d-quick-add-icon" />
                <span>{t(TAB_LABEL[tab])}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
