import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MotionBlendIn, MotionClip } from '../../contract/types'
import { useDirector } from '../../bridge/DirectorContext'
import { blendLockText, blendOffBeatText, blendOffsetText, blendPhaseText, blendStatusVersion, getBlendStatus, subscribeBlendStatus } from '../../engine/objects/blendStatus'
import { blendBandLabel, maxBlendFrames, MIN_BLEND_FRAMES } from '../../document/clipBlend'
import { motionBlendInOf, motionBlendPartner } from '../../evaluate/clips'
import { clampMenuPosition } from './utils/clipMenu'

interface Band {
  clip: MotionClip
  partner: MotionClip
  blend: MotionBlendIn
  left: number
  width: number
}

/** Dải gạch chéo X ở vùng clip sau chồng lên clip trước (K1). Bấm vào để mở bảng chỉnh nhỏ. */
export function ClipBlendBands({
  clips,
  frameStart,
  pxPerFrame,
}: {
  clips: MotionClip[]
  frameStart: number
  pxPerFrame: number
}) {
  const { useStore } = useDirector()
  const preview = useStore((s) => s.clipMovePreview)
  const writeLocked = useStore((s) => s.writeLocked)
  const [panel, setPanel] = useState<{ clipId: string; x: number; y: number } | null>(null)
  useSyncExternalStore(subscribeBlendStatus, blendStatusVersion, blendStatusVersion)
  const bandTitle = (band: Band) => {
    const status = getBlendStatus(band.clip.id)
    return [blendBandLabel(band.blend), band.blend.mirror ? 'Đảo chân' : '', blendPhaseText(status), blendOffsetText(status), blendLockText(status, 0), blendOffBeatText(status)].filter(Boolean).join(' · ')
  }

  // Khi đang kéo, vẽ dải theo vị trí xem trước để người dùng thấy ngay vùng trộn.
  const live = clips.map((clip) => {
    const position = preview?.clipType === 'motion' ? preview.positions[clip.id] : undefined
    let next = position ? { ...clip, ...position } : clip
    if (preview?.clipType === 'motion' && preview.blend?.clipId === clip.id) {
      const base = next.playback.blendIn
      next = { ...next, playback: { ...next.playback, blendIn: { curve: 'smooth', footLock: true, ...base, frames: preview.blend.frames } } }
    }
    return next
  })
  const bands: Band[] = []
  for (const clip of live) {
    const blend = motionBlendInOf(clip)
    const partner = blend ? motionBlendPartner(live, clip) : null
    if (!blend || !partner || partner.frameEnd <= clip.frameStart) continue
    bands.push({
      clip, partner, blend,
      left: (clip.frameStart - frameStart) * pxPerFrame,
      width: Math.max(8, (partner.frameEnd - clip.frameStart) * pxPerFrame),
    })
  }
  const opened = panel ? bands.find((band) => band.clip.id === panel.clipId) : undefined
  return (
    <>
      {bands.map((band) => (
        <div
          key={band.clip.id}
          className={getBlendStatus(band.clip.id)?.leadMismatch ? 't3d-timeline-clip-blend is-offbeat' : 't3d-timeline-clip-blend'}
          data-blend-offbeat={getBlendStatus(band.clip.id)?.leadMismatch ? 'true' : undefined}
          role="button"
          tabIndex={0}
          data-blend-clip-id={band.clip.id}
          data-blend-frames={band.blend.frames}
          style={{ left: band.left, width: band.width }}
          title={bandTitle(band)}
          aria-label={bandTitle(band)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            setPanel({ clipId: band.clip.id, x: rect.left, y: rect.bottom + 4 })
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            setPanel({ clipId: band.clip.id, x: rect.left, y: rect.bottom + 4 })
          }}
        />
      ))}
      {panel && opened && (
        <BlendPanel
          band={opened}
          x={panel.x}
          y={panel.y}
          disabled={writeLocked}
          maxFrames={maxBlendFrames(opened.partner, opened.clip)}
          onClose={() => setPanel(null)}
          apply={(patch) => useStore.getState().setMotionClipBlend(opened.clip.id, patch)}
          remove={() => { useStore.getState().removeMotionClipBlend(opened.clip.id); setPanel(null) }}
        />
      )}
    </>
  )
}

function BlendPanel({
  band, x, y, disabled, maxFrames, onClose, apply, remove,
}: {
  band: Band
  x: number
  y: number
  disabled: boolean
  maxFrames: number
  onClose: () => void
  apply: (patch: { frames?: number; curve?: 'smooth' | 'linear'; mirror?: boolean; phaseOffsetSeconds?: number | null }) => boolean
  remove: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(String(band.blend.frames))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => { setDraft(String(band.blend.frames)); setInvalid(false) }, [band.blend.frames])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const next = clampMenuPosition(x, y, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight })
    el.style.left = `${next.x}px`
    el.style.top = `${next.y}px`
  }, [x, y])
  useEffect(() => {
    const down = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key) }
  }, [onClose])
  const commitFrames = () => {
    const value = Math.round(Number(draft))
    if (!Number.isFinite(value) || value === band.blend.frames) { setDraft(String(band.blend.frames)); setInvalid(false); return }
    const ok = apply({ frames: value })
    setInvalid(!ok)
    if (!ok) setDraft(String(band.blend.frames))
  }
  return (
    <div ref={ref} className="t3d-timeline-blend-panel" role="dialog" aria-label="Trộn clip" style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}>
      <div className="t3d-timeline-blend-title">Trộn clip</div>
      <label className="t3d-timeline-blend-row">
        <span>Số khung trộn</span>
        <input
          type="number"
          min={MIN_BLEND_FRAMES}
          max={Math.max(MIN_BLEND_FRAMES, maxFrames)}
          step={1}
          value={draft}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitFrames}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitFrames() } }}
        />
      </label>
      <label className="t3d-timeline-blend-row">
        <span>Kiểu chuyển</span>
        <select
          value={band.blend.curve}
          disabled={disabled}
          onChange={(event) => { apply({ curve: event.target.value as 'smooth' | 'linear' }) }}
        >
          <option value="smooth">Êm đầu-cuối</option>
          <option value="linear">Tuyến tính</option>
        </select>
      </label>
      {(() => {
        const status = getBlendStatus(band.clip.id)
        const offset = blendOffsetText(status)
        const lock = blendLockText(status, 0)
        return (offset || lock) ? (
          <div className="t3d-timeline-blend-note" data-blend-status>
            {offset && <div>{offset}</div>}
            {lock && <div>{lock}</div>}
          </div>
        ) : null
      })()}
      {(() => {
        const status = getBlendStatus(band.clip.id)
        const warning = blendOffBeatText(status)
        const phase = status?.phaseOffsetSeconds ?? 0
        const suggested = status?.suggestedPhaseSeconds ?? null
        return (
          <>
            {warning && <div className="t3d-timeline-blend-warn" data-blend-offbeat-text role="alert">{warning}</div>}
            <div className="t3d-timeline-blend-actions">
              <button type="button" className="t3d-timeline-blend-toggle" aria-pressed={!!band.blend.mirror} disabled={disabled}
                title="Lật trái-phải toàn bộ clip sau (xương, đường đi và hướng root)"
                onClick={() => { apply({ mirror: !band.blend.mirror }) }}>Đảo chân</button>
              <button type="button" disabled={disabled || suggested === null || suggested === phase}
                title={suggested === null ? 'Không tìm thấy nhịp khớp trong 1,5 giây đầu của clip sau' : 'Dời điểm bắt đầu của clip sau tới nhịp có cùng chân trước'}
                onClick={() => { if (suggested !== null) apply({ phaseOffsetSeconds: suggested }) }}>Khớp nhịp bước</button>
              {phase !== 0 && <button type="button" disabled={disabled} onClick={() => { apply({ phaseOffsetSeconds: null }) }}>Bỏ khớp nhịp</button>}
            </div>
          </>
        )
      })()}
      {invalid && <div className="t3d-timeline-blend-note">Số khung không hợp lệ (2 – {Math.max(MIN_BLEND_FRAMES, maxFrames)}) hoặc đụng clip khác.</div>}
      <button type="button" className="t3d-timeline-blend-remove" disabled={disabled} onClick={remove}>Bỏ trộn</button>
    </div>
  )
}
