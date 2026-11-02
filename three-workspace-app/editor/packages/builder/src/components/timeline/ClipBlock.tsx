import { useEffect, useRef, useState } from 'react'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { cx } from '../common/cx'
import { useSnapFrame } from './hooks/useSnapFrame'
import { duplicateClipGesture } from './utils/clipGestures'
import { clipRefsOf, nextClipSelection } from '../../stores/types'

export function ClipBlock({
  kind,
  selected,
  left,
  width,
  label,
  durationLabel,
  clipId,
  frameStart,
  frameEnd,
  pxPerFrame,
  locked = false,
  ghost = false,
}: {
  kind: 'camera' | 'motion' | 'path'
  selected: boolean
  left: number
  width: number
  label: string
  /** Độ dài clip theo đơn vị timeline đang chọn (N3); chỉ hiện khi clip đủ rộng. */
  durationLabel?: string
  clipId: string
  frameStart: number
  frameEnd: number
  pxPerFrame: number
  locked?: boolean
  ghost?: boolean
  onSelect?: () => void
}) {
  const t = useT()
  const { useStore, stage } = useDirector()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [duplicateFrame, setDuplicateFrame] = useState<number | null>(null)
  useEffect(() => {
    if (!menu) return
    const dismiss = () => setMenu(null)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', dismiss)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', key); window.removeEventListener('blur', dismiss) }
  }, [menu])
  const snap = useSnapFrame(pxPerFrame)
  const [resizing, setResizing] = useState(false)
  const [moving, setMoving] = useState(false)
  const movePreview = useStore((s) => s.clipMovePreview)
  const resizePreview = useStore((s) => s.clipResizePreview)
  const writeLocked = useStore((s) => s.writeLocked)
  const previewRange = movePreview?.clipType === kind || movePreview?.clips?.some((ref) => ref.clipType === kind && ref.clipId === clipId)
    ? movePreview?.positions[clipId] : undefined
  const resizeRange = resizePreview?.clipType === kind
    ? (resizePreview.positions?.[clipId]
      ?? (resizePreview.clipId === clipId
        ? { frameStart: resizePreview.frameStart, frameEnd: resizePreview.frameEnd }
        : undefined))
    : undefined
  const draggingThis = moving && movePreview?.clipType === kind && movePreview.clipId === clipId
  const activeStart = resizeRange?.frameStart ?? previewRange?.frameStart ?? frameStart
  const activeEnd = resizeRange?.frameEnd ?? previewRange?.frameEnd ?? frameEnd
  const previewLeft = left + (activeStart - frameStart) * pxPerFrame
  const displayLeft = draggingThis ? left + (movePreview.pointerFrame - frameStart) * pxPerFrame : previewLeft
  const displayWidth = Math.max(3, (activeEnd - activeStart) * pxPerFrame)
  const dragMove = useRef<{
    startX: number; origFrame: number; pointerId: number; moved: boolean; duplicate: boolean
    scroll: HTMLElement | null; scrollLeft: number; scale: number
  } | null>(null)

  useEffect(() => {
    const cancel = () => {
      const s = useStore.getState()
      if (dragMove.current) {
        dragMove.current = null
        setMoving(false)
        setDuplicateFrame(null)
        s.cancelClipMove()
      }
      if (dragEdge.current) {
        dragEdge.current = null
        setResizing(false)
        s.cancelClipResize()
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', onKey)
      const s = useStore.getState()
      if (dragMove.current) s.cancelClipMove()
      if (dragEdge.current) s.cancelClipResize()
    }
  }, [useStore])
  const dragEdge = useRef<{
    edge: 'start' | 'end'
    startX: number
    origFrame: number
  } | null>(null)

  /** 整段平移：先试首帧，首帧没吸上再试末帧，两头都能贴住邻居。 */
  const snapMoveStart = (rawStart: number) => {
    const exclude = { clipId, clipIds: new Set(clipRefsOf(useStore.getState().selection).map((ref) => ref.clipId)) }
    const snappedStart = snap(rawStart, exclude)
    if (snappedStart !== rawStart) return snappedStart
    const rawEnd = rawStart + (frameEnd - frameStart)
    const snappedEnd = snap(rawEnd, exclude)
    return snappedEnd === rawEnd ? rawStart : snappedEnd - (frameEnd - frameStart)
  }

  const cancelResize = () => {
    if (!dragEdge.current) return
    dragEdge.current = null
    setResizing(false)
    useStore.getState().cancelClipResize()
  }

  const handles =
    ghost || writeLocked || (locked && kind !== 'path')
      ? null
      : (['start', 'end'] as const).map((edge) => (
        <span
          key={edge}
          className={`t3d-timeline-clip-handle t3d-timeline-clip-handle-${edge}`}
          title={edge === 'start' ? t('timeline.dragStart') : t('timeline.dragDuration')}
          onPointerDown={(e) => {
            e.stopPropagation()
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            dragEdge.current = {
              edge,
              startX: e.clientX,
              origFrame: edge === 'start' ? frameStart : frameEnd,
            }
            setResizing(true)
            const s = useStore.getState()
            s.beginClipResize()
            s.select({ kind: 'clip', clipType: kind, clipId })
          }}
          onPointerMove={(e) => {
            const d = dragEdge.current
            if (!d || d.edge !== edge) return
            useStore.getState().resizeClip(
              kind,
              clipId,
              d.edge,
              snap(d.origFrame + (e.clientX - d.startX) / pxPerFrame, { clipId }),
            )
          }}
          onPointerUp={() => {
            dragEdge.current = null
            setResizing(false)
            useStore.getState().endClipResize()
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ))

  return (
    <>
    {menu && <div role="menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 10000, background: 'var(--t3d-panel-bg, #222)', padding: 6 }}
      onPointerDown={(e) => e.stopPropagation()} onMouseLeave={() => setMenu(null)}>
      {[
        ['Sao chép', () => useStore.getState().copyTimelineClip(kind, clipId)],
        ['Dán tại đầu phát', () => useStore.getState().pasteTimelineClip(stage.currentFrame)],
        ['Nhân bản', () => useStore.getState().duplicateTimelineClip(kind, clipId, frameEnd)],
        ['Xoá', () => { const s = useStore.getState(); s.select({ kind: 'clip', clipType: kind, clipId }); s.deleteSelection() }],
      ].map(([label, action]) => <button key={label as string} type="button" role="menuitem" disabled={writeLocked && label !== 'Sao chép'}
        style={{ display: 'block' }} onClick={() => { (action as () => void)(); setMenu(null) }}>{label as string}</button>)}
    </div>}
    {duplicateFrame !== null && <div className="t3d-timeline-clip t3d-timeline-clip-drop-preview" aria-hidden="true"
      style={{ left: left + (duplicateFrame - frameStart) * pxPerFrame, width: displayWidth }}>{label}</div>}
    {draggingThis && !ghost && <div
      className="t3d-timeline-clip t3d-timeline-clip-drop-preview"
      style={{ left: previewLeft, width: displayWidth }}
      aria-hidden="true"
      data-drop-preview={clipId}
    >{label}{durationLabel && displayWidth >= 90 ? ` · ${durationLabel}` : ''}</div>}
    <div
      className={cx(
        't3d-timeline-clip',
        kind === 'camera' && 't3d-timeline-clip-camera',
        kind === 'motion' && 't3d-timeline-clip-motion',
        kind === 'path' && 't3d-timeline-clip-path',
        selected && !ghost && 't3d-timeline-clip-selected',
        resizing && 't3d-timeline-clip-resizing',
        moving && 't3d-timeline-clip-moving',
        ghost && 't3d-timeline-clip-ghost',
      )}
      style={{ left: displayLeft, width: displayWidth }}
      data-clip-id={clipId}
      data-clip-type={kind}
      data-frame-start={frameStart}
      data-frame-end={frameEnd}
      data-preview-start={previewRange?.frameStart}
      data-preview-end={previewRange?.frameEnd}
      data-dragging={moving || undefined}
      aria-label={ghost ? undefined : label}
      onContextMenu={ghost ? undefined : (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }) }}
      onClick={ghost ? undefined : (e) => e.stopPropagation()}
      onPointerDown={ghost ? undefined : (e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('.t3d-timeline-clip-handle')) return
        e.preventDefault()
        e.stopPropagation()
        const s = useStore.getState()
        e.currentTarget.closest<HTMLElement>('.t3d-timeline')?.focus()
        const duplicate = duplicateClipGesture(e, navigator.platform)
        const additive = e.shiftKey || (!duplicate && (e.ctrlKey || e.metaKey))
        const next = nextClipSelection(s.selection, { clipType: kind, clipId }, additive)
        if (next !== s.selection) s.select(next)
        if (additive || writeLocked) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const scroll = e.currentTarget.closest<HTMLElement>('.t3d-timeline-scroll')
        dragMove.current = {
          startX: e.clientX, origFrame: frameStart, pointerId: e.pointerId, moved: false, duplicate,
          scroll, scrollLeft: scroll?.scrollLeft ?? 0, scale: pxPerFrame,
        }
        setMoving(true)
        if (!duplicate) s.beginClipMove()
      }}
      onPointerMove={ghost ? undefined : (e) => {
        const d = dragMove.current
        if (!d || e.pointerId !== d.pointerId) return
        const delta = e.clientX - d.startX + (d.scroll?.scrollLeft ?? 0) - d.scrollLeft
        if (!d.moved && Math.abs(delta) < 3) return
        d.moved = true
        if (d.duplicate) setDuplicateFrame(Math.max(0, Math.round(snapMoveStart(d.origFrame + delta / d.scale))))
        else useStore.getState().moveClip(kind, clipId, snapMoveStart(d.origFrame + delta / d.scale))
      }}
      onPointerUp={ghost ? undefined : (e) => {
        const d = dragMove.current
        if (!d || e.pointerId !== d.pointerId) return
        dragMove.current = null
        const s = useStore.getState()
        if (d.moved) {
          const delta = e.clientX - d.startX + (d.scroll?.scrollLeft ?? 0) - d.scrollLeft
          if (d.duplicate) s.duplicateTimelineClip(kind, clipId, snapMoveStart(d.origFrame + delta / d.scale))
          else { s.moveClip(kind, clipId, snapMoveStart(d.origFrame + delta / d.scale)); s.endClipMove() }
        } else s.cancelClipMove()
        setMoving(false)
        setDuplicateFrame(null)
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        if (dragEdge.current) {
          cancelResize()
          return
        }
        if (!dragMove.current) return
        dragMove.current = null
        setMoving(false)
        setDuplicateFrame(null)
        useStore.getState().cancelClipMove()
      }}
      onLostPointerCapture={() => {
        if (dragEdge.current) {
          cancelResize()
          return
        }
        if (!dragMove.current) return
        dragMove.current = null
        setMoving(false)
        setDuplicateFrame(null)
        useStore.getState().cancelClipMove()
      }}
    >
      {label}
      {durationLabel && displayWidth >= 90 ? <span className="t3d-timeline-clip-duration"> · {durationLabel}</span> : null}
      {handles}
    </div>
    </>
  )
}
