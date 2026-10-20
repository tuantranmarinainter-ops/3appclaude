import { createContext, useContext, useEffect, useState, type ReactNode, type Ref } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useT, useLocale } from '../../locale'
import { localizeMessage } from '../../locale/messages'
import type { TranslateFn } from '../../locale/types'
import { cx } from '../common/cx'

const EXIT_MS = 280
const LOAD_FAILED_PREFIX = 'Loading failed'

const PortalRootContext = createContext<HTMLElement | null>(null)

export function StudioShell({
  children,
  rootRef,
}: {
  children: ReactNode
  rootRef: Ref<HTMLDivElement>
}) {
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null)
  const locale = useLocale()
  const { useStore } = useDirector()
  const ready = useStore((s) => s.ready)
  const viewportFullscreen = useStore((s) => s.viewportFullscreen)
  const writeLocked = useStore((s) => s.writeLocked)

  return (
    <PortalRootContext.Provider value={portalEl}>
      <div
        className={cx(
          't3d-root',
          !ready && 't3d-root-booting',
          viewportFullscreen && 'is-viewport-fullscreen',
          writeLocked && 'is-write-locked',
        )}
        ref={rootRef}
        lang={locale}
        tabIndex={-1}
        aria-busy={!ready}
      >
        {children}
        <DraftLoadOverlay />
        <CameraAimToast />
        <PathBindMoveToast />
        <div className="t3d-portal-root" ref={setPortalEl} />
      </div>
    </PortalRootContext.Provider>
  )
}

export function usePortalRoot(): HTMLElement | null {
  return useContext(PortalRootContext)
}

function CameraAimToast() {
  const { useStore } = useDirector()
  const t = useT()
  const version = useStore((s) => s.cameraAimReleaseVersion)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(version > 0)
    if (!version) return
    const timer = window.setTimeout(() => setVisible(false), 3500)
    return () => window.clearTimeout(timer)
  }, [version])
  return visible ? <div className="t3d-camera-aim-toast" role="status" aria-live="polite">{t('library.lookAtReleased')}</div> : null
}

function PathBindMoveToast() {
  const { useStore } = useDirector()
  const t = useT()
  const nodeId = useStore((s) => s.pathBindMoveNodeId)
  const version = useStore((s) => s.pathBindMoveNoticeVersion)
  const releasePathBinding = useStore((s) => s.releasePathBinding)
  const dismissPathBindMoveNotice = useStore((s) => s.dismissPathBindMoveNotice)
  useEffect(() => {
    if (!nodeId) return
    const timer = window.setTimeout(() => dismissPathBindMoveNotice(), 2500)
    return () => window.clearTimeout(timer)
  }, [nodeId, version, dismissPathBindMoveNotice])
  if (!nodeId) return null
  return (
    <div className="t3d-path-bind-toast" role="status" aria-live="polite">
      <span>{t('library.pathBindMoveBlocked')}</span>
      <button type="button" className="t3d-hint-action" onClick={() => releasePathBinding(nodeId)}>
        {t('library.pathBindRelease')}（Esc）
      </button>
    </div>
  )
}

function BootVisual({ failed }: { failed: boolean }) {
  if (failed) return null
  return <div className="t3d-boot-spinner" aria-hidden="true" />
}

function bootCaption(t: TranslateFn, failed: boolean, message: string | undefined, status: string | undefined): string {
  if (!failed) return t('load.opening')
  if (message) return message
  if (status) return localizeMessage(t, status)
  return t('load.failed')
}

export function StudioBootScreen({
  failed = false,
  exiting = false,
  message,
  status,
}: {
  failed?: boolean
  exiting?: boolean
  /** 宿主侧失败原因（无权限 / 不存在等），缺省回落包内通用文案 */
  message?: string
  /** 失败时的加载状态原文，成功时不展示 */
  status?: string
}) {
  const t = useT()
  const caption = bootCaption(t, failed, message, status)

  return (
    <div
      className={exiting ? 't3d-boot t3d-boot-exit' : 't3d-boot'}
      role="status"
      aria-live="polite"
      aria-busy={!failed && !exiting}
    >
      <BootVisual failed={failed} />
      <p className={failed ? 't3d-boot-title t3d-boot-title-error' : 't3d-boot-title'}>
        {caption}
      </p>
    </div>
  )
}

function DraftLoadOverlay() {
  const { useStore } = useDirector()
  const ready = useStore((s) => s.ready)
  const loadStatus = useStore((s) => s.loadStatus)
  const [phase, setPhase] = useState<'show' | 'exit' | 'gone'>(ready ? 'gone' : 'show')

  useEffect(() => {
    if (!ready) {
      setPhase('show')
      return
    }
    setPhase((current) => (current === 'gone' ? 'gone' : 'exit'))
    const timer = window.setTimeout(() => setPhase('gone'), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [ready])

  if (phase === 'gone') return null

  return (
    <StudioBootScreen
      failed={loadStatus.startsWith(LOAD_FAILED_PREFIX)}
      exiting={phase === 'exit'}
      status={loadStatus}
    />
  )
}
