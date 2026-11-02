import type { MotionClip } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { motionClipOverrunSeconds, motionExtendMode, type MotionExtendMode } from '../../evaluate/clips'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { ScrubNumberInput } from '../common/ScrubNumberInput'
import { Dropdown } from '../common/Dropdown'
import { InspectorRangeDelete } from './FrameRangeRow'
import { ToggleRow } from './PosePanel'

const MOTION_SPEEDS = [0.1, 0.25, 0.5, 1, 2] as const
const EXTEND_MODES: readonly MotionExtendMode[] = ['loop', 'hold', 'stretch']

export function MotionClipConfigEditor({
  clip,
  onDelete,
}: {
  clip: MotionClip
  onDelete?: () => void
}) {
  const t = useT()
  const { useStore } = useDirector()
  const update = useStore((s) => s.updateMotionClipConfig)
  const fps = useStore((s) => s.doc?.content.timeline.fps ?? 30)
  const patch = (key: string, value: number | string | boolean) => update(clip.id, { [key]: value })
  const extendMode = motionExtendMode(clip.playback)
  const overrun = motionClipOverrunSeconds(clip, fps)
  // B9: lưu "Lặp" = loop bật; "Giữ khung cuối" = loop tắt; "Giãn chậm" = loop tắt + loopMode 'stretch'.
  const chooseExtend = (mode: MotionExtendMode) => {
    if (mode === extendMode) return
    if (mode === 'loop') update(clip.id, { loop: true, loopMode: clip.playback.loopMode === 'ping-pong' ? 'ping-pong' : 'repeat' })
    else if (mode === 'hold') update(clip.id, { loop: false, loopMode: 'repeat' })
    else update(clip.id, { loop: false, loopMode: 'stretch' })
  }
  const extendLabel: Record<MotionExtendMode, string> = {
    loop: t('inspector.extendLoop'),
    hold: t('inspector.extendHold'),
    stretch: t('inspector.extendStretch'),
  }
  const extendHint: Record<MotionExtendMode, string> = {
    loop: t('inspector.extendHintLoop'),
    hold: t('inspector.extendHintHold'),
    stretch: t('inspector.extendHintStretch'),
  }

  return (
    <div className="t3d-motion-clip-settings">
      <div className="t3d-inspector-title t3d-inspector-title-sub">
        {t('inspector.motionSettings')}
        {onDelete ? (
          <span className="t3d-inspector-title-action">
            <InspectorRangeDelete label={t('common.delete')} onClick={onDelete} />
          </span>
        ) : null}
      </div>
      <div className="t3d-inspector-kv">
        <span className="t3d-inspector-k">{t('inspector.clipSpeed')}</span>
        <span className="t3d-inspector-v">
          <span className="t3d-motion-speed" role="group" aria-label={t('inspector.clipSpeed')}>
            {MOTION_SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                className={cx('t3d-motion-speed-btn', Math.abs(clip.playback.speed - speed) < 0.001 && 'is-active')}
                aria-pressed={Math.abs(clip.playback.speed - speed) < 0.001}
                onClick={() => patch('speed', speed)}
              >
                {speed}x
              </button>
            ))}
          </span>
          <ScrubNumberInput value={clip.playback.speed} min={0.01} max={16} step={0.05} precision={2}
            ariaLabel={t('inspector.clipSpeed')} onChange={(value) => patch('speed', value)} />
        </span>
      </div>
      <div className="t3d-inspector-kv">
        <span className="t3d-inspector-k">{t('inspector.extendMode')}</span>
        <span className="t3d-inspector-v">
          <span className="t3d-motion-speed" role="radiogroup" aria-label={t('inspector.extendMode')}>
            {EXTEND_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                className={cx('t3d-motion-speed-btn', extendMode === mode && 'is-active')}
                aria-checked={extendMode === mode}
                onClick={() => chooseExtend(mode)}
              >
                {extendLabel[mode]}
              </button>
            ))}
          </span>
        </span>
      </div>
      <div className="t3d-motion-extend-hint">
        {overrun > 0.04 ? `${t('inspector.extendOverrun', { seconds: overrun.toFixed(1) })}. ` : ''}
        {extendHint[extendMode]}
      </div>
      {extendMode === 'loop' ? (
      <div className="t3d-inspector-kv">
        <span className="t3d-inspector-k">{t('inspector.loopMode')}</span>
        <span className="t3d-inspector-v">
          <Dropdown
            value={clip.playback.loopMode}
            options={[
              { value: 'repeat', label: t('inspector.loopRepeat') },
              { value: 'ping-pong', label: t('inspector.loopPingPong') },
            ]}
            onChange={(next) => patch('loopMode', next)}
          />
        </span>
      </div>
      ) : null}
      <ToggleRow
        label={t('inspector.inPlaceMotion')}
        checked={clip.motion.inPlace}
        onChange={(next) => patch('inPlace', next)}
      />
    </div>
  )
}
