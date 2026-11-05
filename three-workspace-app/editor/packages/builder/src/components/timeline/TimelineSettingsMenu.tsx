import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '../common/Tooltip'
import { cx } from '../common/cx'

/** Nút bánh răng của timeline: các tuỳ chọn ít đổi (hiện có "Tự dời"). Menu vẽ vào body vì thanh công cụ cắt phần tràn. */
export function TimelineSettingsMenu({ clipRipple, setClipRipple }: { clipRipple: boolean; setClipRipple: (enabled: boolean) => void }) {
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const open = anchor !== null
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setAnchor(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAnchor(null) }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', escape) }
  }, [open])
  const toggle = () => {
    if (open || !button.current) { setAnchor(null); return }
    const rect = button.current.getBoundingClientRect()
    setAnchor({ right: Math.max(8, window.innerWidth - rect.right), bottom: window.innerHeight - rect.top + 6 })
  }
  return (
    <>
      <Tooltip label="Tuỳ chọn timeline" side="top">
        <button
          ref={button}
          type="button"
          className={cx('t3d-timeline-auto-key', open && 'is-active')}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Tuỳ chọn timeline"
          data-timeline-settings
          onClick={toggle}
        >
          ⚙
        </button>
      </Tooltip>
      {anchor && createPortal(
        <div
          ref={menu}
          role="menu"
          data-timeline-settings-menu
          style={{
            position: 'fixed', right: anchor.right, bottom: anchor.bottom, zIndex: 10000, width: 300, padding: 10,
            background: 'var(--t3d-panel-bg, #222)', color: 'var(--t3d-text, #eee)', border: '1px solid rgba(255,255,255,.15)',
            borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,.45)', fontSize: 12, lineHeight: 1.4,
          }}
        >
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              role="menuitemcheckbox"
              aria-checked={clipRipple}
              checked={clipRipple}
              onChange={(event) => setClipRipple(event.target.checked)}
            />
            <span>
              <strong>Tự dời clip</strong>
              <br />
              Bật: cắt (Ctrl+B), tỉa, xoá clip động tác thì các clip sau tự thụt vào; kéo clip thì đẩy clip bên cạnh.
              <br />
              Tắt (mặc định): giữ nguyên khoảng trống, clip khác đứng yên.
            </span>
          </label>
        </div>,
        document.body,
      )}
    </>
  )
}
