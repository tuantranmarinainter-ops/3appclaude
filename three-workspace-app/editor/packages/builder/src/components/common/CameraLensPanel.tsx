import { useNodeSnapshot, useThrottledFrame } from '../../bridge/useEngineEvent'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import {
  ASPECT_RATIO_MENU_ORDER,
  aspectRatioLabel,
  isAspectRatioMenuItem,
} from '../../contract/aspectRatio'
import { cameraAspectSetting } from '../../contract/cameraAspect'
import { cameraMotionOwnsKeyframes } from '../../evaluate/camera/cameraMotionExclusive'
import {
  FOCAL_LENGTH_MAX,
  FOCAL_LENGTH_MIN,
  focalLengthToFov,
  fovToFocalLength,
} from '../../evaluate/camera/focalLength'
import { hasKeyAtFrame, KeyframeButton } from './KeyframeButton'
import { Dropdown } from './Dropdown'
import { SliderNumberControl } from './SliderNumberControl'

/**
 * 焦距：按全画幅竖边 24mm 与垂直视角互算。拖滑条不自动打关键帧；钻石走 addKeyframe。
 * 曲线里仍存垂直视角（度），界面显示毫米。
 */
export function CameraLensPanel({ cameraId }: { cameraId: string | null | undefined }) {
  const t = useT()
  const { useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const userKeys = useStore((s) => s.userKeys)
  const { setCameraFov, setCameraAspectRatio, addKeyframe } = useStore()
  const frame = useThrottledFrame()
  const snap = useNodeSnapshot(cameraId)
  if (!doc || !cameraId) return null

  const cam = doc.content.nodes.find((n) => n.id === cameraId && n.type === 'camera')
  if (!cam?.camera) return null

  const fov = snap?.fov ?? cam.camera.fov
  const focal = fovToFocalLength(fov)
  const keyed = hasKeyAtFrame(userKeys[cameraId]?.fov, frame)
  const motionLocked = cameraMotionOwnsKeyframes(doc, cameraId)
  const aspect = cameraAspectSetting(cam.camera, doc.content.aspectRatio)
  const aspectOptions = isAspectRatioMenuItem(aspect)
    ? [...ASPECT_RATIO_MENU_ORDER]
    : [...ASPECT_RATIO_MENU_ORDER, aspect]

  return (
    <>
      <div className="t3d-camera-subject-row">
        <SliderNumberControl
          label={t('library.lensFov')}
          helpText={t('help.fov')}
          min={FOCAL_LENGTH_MIN}
          max={FOCAL_LENGTH_MAX}
          step={0.1}
          precision={1}
          unit="mm"
          value={focal}
          onChange={(value) => setCameraFov(focalLengthToFov(value), cameraId)}
        />
        <KeyframeButton
          keyed={keyed}
          title={t(motionLocked ? 'timeline.keyframeSuspendedByMotion' : 'timeline.addKeyframe')}
          disabled={motionLocked}
          onClick={() => addKeyframe(cameraId, 'fov', [fov])}
        />
      </div>
      <div className="t3d-inspector-row t3d-camera-aspect-row">
        <span className="t3d-inspector-k">{t('library.cameraAspect')}</span>
        <div className="t3d-inspector-v">
          <Dropdown
            ariaLabel={t('library.cameraAspect')}
            value={aspect}
            options={aspectOptions.map((ratio) => ({
              value: ratio,
              label: aspectRatioLabel(ratio, t('topbar.aspectRatioAuto')),
            }))}
            onChange={(ratio) => setCameraAspectRatio(cameraId, ratio)}
          />
        </div>
      </div>
    </>
  )
}
