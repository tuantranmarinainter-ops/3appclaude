import { createPortal } from 'react-dom'
import { useT } from '../../locale'
import { usePortalRoot } from '../overlay/PortalRoot'
import { useNavigationHint } from './hooks/useNavigationHint'

function HintKey({
  letter,
  arrow,
  label,
  className,
}: {
  letter: string
  arrow?: string
  label: string
  className?: string
}) {
  return (
    <kbd className={className} aria-label={label}>
      <span aria-hidden="true">
        {letter}
        {arrow ? <span className="t3d-navigation-hint-arrow">{arrow}</span> : null}
      </span>
    </kbd>
  )
}

export function NavigationHint({ hidden }: { hidden: boolean }) {
  const t = useT()
  const portal = usePortalRoot()
  const { visible, toast, dismiss } = useNavigationHint()
  return <>
    {visible && !hidden && (
      <aside className="t3d-navigation-hint" aria-label={t('topbar.shortcuts')} onPointerDown={(event) => event.stopPropagation()}>
        <div className="t3d-navigation-hint-header">
          <span>{t('topbar.shortcuts')}</span>
          <button type="button" className="t3d-navigation-hint-close" aria-label={t('common.close')} onClick={dismiss}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="m3 3 6 6m0-6L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="t3d-navigation-hint-body">
          <span className="t3d-navigation-hint-label">{t('viewport.translate')}</span>
          <span className="t3d-navigation-hint-rule" aria-hidden="true" />
          <span className="t3d-navigation-hint-label t3d-navigation-hint-label-lift">{t('viewport.elevation')}</span>
          <div className="t3d-navigation-hint-keys" dir="ltr">
            <HintKey className="t3d-navigation-hint-w" letter="W" arrow="↑" label="W ↑" />
            <HintKey letter="A" arrow="←" label="A ←" />
            <HintKey letter="S" arrow="↓" label="S ↓" />
            <HintKey letter="D" arrow="→" label="D →" />
          </div>
          <div className="t3d-navigation-hint-eq" dir="ltr">
            <HintKey letter="E" label={`E ${t('tutorial.viewportUp')}`} />
            <HintKey letter="Q" label={`Q ${t('tutorial.viewportDown')}`} />
          </div>
        </div>
        <div className="t3d-navigation-hint-look">
          <div className="t3d-navigation-hint-mouse-track" aria-hidden="true">
            <span>‹</span>
            <svg className="t3d-navigation-hint-mouse" width="26" height="36" viewBox="0 0 26 36" fill="none">
              <path d="M13 2C6.9 2 2 6.9 2 13v3h11V2Z" fill="#c4b5fd" />
              <rect x="2" y="2" width="22" height="32" rx="11" stroke="currentColor" strokeWidth="1.5" />
              <path d="M13 2v14M2 16h22" stroke="currentColor" strokeWidth="1.5" />
              <rect x="11.5" y="8" width="3" height="6" rx="1.5" fill="#2a2a2c" />
            </svg>
            <span>›</span>
          </div>
          <div className="t3d-navigation-hint-look-copy">
            <span className="t3d-navigation-hint-label">{t('viewport.controlDirection')}</span>
            <span className="t3d-navigation-hint-look-description">{t('topbar.shortcutLeftDrag')}</span>
          </div>
        </div>
      </aside>
    )}
    {toast && portal && createPortal(
      <div className="t3d-camera-aim-toast" role="status" aria-live="polite">{t('viewport.navigationHintDismissed')}</div>, portal,
    )}
  </>
}
