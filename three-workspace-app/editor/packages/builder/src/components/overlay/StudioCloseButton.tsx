import { useState } from 'react'
import { useT } from '../../locale'
import { Tooltip } from '../common/Tooltip'

interface StudioCloseButtonProps {
  onClose: () => void | boolean | Promise<void | boolean>
}

export function StudioCloseButton({ onClose }: StudioCloseButtonProps) {
  const t = useT()
  const [closing, setClosing] = useState(false)

  const close = () => {
    if (closing) return
    setClosing(true)
    // 保存成功后保持转圈直到卸载。清掉 loading 会在退回前把 Done 再画出来。
    void Promise.resolve(onClose()).then(
      (closed) => {
        if (closed === false) setClosing(false)
      },
      () => setClosing(false),
    )
  }

  const label = closing ? t('close.saving') : t('close.done')

  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={closing ? 't3d-studio-close is-loading' : 't3d-studio-close'}
        aria-label={label}
        aria-busy={closing}
        disabled={closing}
        onClick={close}
      >
        <span className="t3d-studio-close-face">
          <ExitIcon />
        </span>
        {closing ? <span className="t3d-studio-close-spinner" aria-hidden="true" /> : null}
      </button>
    </Tooltip>
  )
}

function ExitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
      <path d="M936.96 998.4H364.032c-28.672 0-51.2-23.04-51.2-51.2s23.04-51.2 51.2-51.2h521.216V128.512H364.032c-28.672 0-51.2-23.04-51.2-51.2s23.04-51.2 51.2-51.2H936.96c28.672 0 51.2 23.04 51.2 51.2V947.2c0 28.16-23.04 51.2-51.2 51.2z" />
      <path d="M280.576 755.2c-13.312 0-26.112-5.12-36.352-14.848L51.2 547.84c-9.728-9.728-15.36-23.04-15.36-36.352a51.2 51.2 0 0 1 15.36-36.352l193.536-190.976a51.1488 51.1488 0 0 1 72.704 0.512c19.968 19.968 19.968 52.736-0.512 72.704L160.256 511.488l156.672 155.648c19.968 19.968 20.48 52.736 0 72.704-9.728 10.24-23.04 15.36-36.352 15.36z" />
      <path d="M606.72 563.2H118.784c-28.672 0-51.2-23.04-51.2-51.2s23.04-51.2 51.2-51.2h487.936c28.672 0 51.2 23.04 51.2 51.2s-22.528 51.2-51.2 51.2z" />
    </svg>
  )
}
