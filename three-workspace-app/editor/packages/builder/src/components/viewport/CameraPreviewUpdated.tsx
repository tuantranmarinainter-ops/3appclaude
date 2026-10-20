import { useEffect, useState } from 'react'
import { useT } from '../../locale'

const HOLD_MS = 2000
const FADE_MS = 200

export function CameraPreviewUpdated({ savedAt }: { savedAt: number }) {
  const t = useT()
  const [elapsed] = useState(() => Math.max(0, Date.now() - savedAt))
  const [visible, setVisible] = useState(elapsed < HOLD_MS + FADE_MS)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), Math.max(0, savedAt + HOLD_MS + FADE_MS - Date.now()))
    return () => window.clearTimeout(timer)
  }, [savedAt])

  if (!visible) return null
  return (
    <span
      className="t3d-preview-updated"
      role="status"
      style={{ animationDelay: `${-elapsed}ms` }}
    >
      {t('viewport.cameraUpdated')}
    </span>
  )
}
