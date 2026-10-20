import type { ReactElement } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { cx } from '../common/cx'

/** 相机绑了用户轨迹时，在属性栏底部切换朝向路径或保持绑定前朝向。 */
export function CameraPathFacing({ cameraId }: { cameraId: string }): ReactElement | null {
  const t = useT()
  const { useStore } = useDirector()
  const mode = useStore((s) => {
    const clips = s.doc?.content.timeline.animation.pathMotionClips
    let found = false
    let allNone = true
    if (clips) {
      for (const clip of clips) {
        if (clip.target.nodeId !== cameraId || clip.lockedReason === 'derived-from-keyframes') continue
        found = true
        if (clip.facing !== 'none') allNone = false
      }
    }
    return !found ? null : allNone ? 'none' : 'path-tangent'
  })
  const setCameraPathFacing = useStore((s) => s.setCameraPathFacing)
  if (!mode) return null
  return (
    <div className="t3d-inspector-kv t3d-camera-path-facing">
      <span className="t3d-inspector-k">{t('inspector.pathFacing')}</span>
      <span className="t3d-inspector-v">
        <span className="t3d-motion-speed" role="group" aria-label={t('inspector.pathFacing')}>
          <button
            type="button"
            className={cx('t3d-motion-speed-btn', mode === 'path-tangent' && 'is-active')}
            aria-pressed={mode === 'path-tangent'}
            onClick={() => setCameraPathFacing(cameraId, 'path-tangent')}
          >
            {t('inspector.pathFacePath')}
          </button>
          <button
            type="button"
            className={cx('t3d-motion-speed-btn', mode === 'none' && 'is-active')}
            aria-pressed={mode === 'none'}
            onClick={() => setCameraPathFacing(cameraId, 'none')}
          >
            {t('inspector.pathFaceOriginal')}
          </button>
        </span>
      </span>
    </div>
  )
}
