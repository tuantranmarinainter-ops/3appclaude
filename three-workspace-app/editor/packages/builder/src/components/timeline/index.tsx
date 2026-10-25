import { TimelineFrameField, TimelineRangeField, TransportButton } from './TimelineControls'
import { useTimelineMarquee } from './hooks/useTimelineMarquee'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackProp } from '../../evaluate/curves/KeyframeTrack'
import { useDirector } from '../../bridge/DirectorContext'
import { useT } from '../../locale'
import { clampTimelineHeight, PX_PER_FRAME_MAX, TIMELINE_HEIGHT_DEFAULT } from '../../stores/EditorStore'
import { nodeIdsOf } from '../../stores/nodeSelection'
import { cx } from '../common/cx'
import { RangeSlider } from '../common/RangeSlider'
import { browserPanelStorage } from '../common/panelLayout'
import type { TimelineUnit } from '../../stores/types'
import { readTimelineUnit, timelineUnitRuler, writeTimelineUnit } from './utils/timeUnit'
import { ScrubNumberInput } from '../common/ScrubNumberInput'
import { Tooltip } from '../common/Tooltip'
import { useVerticalResize } from '../leftrail/hooks/usePanelResize'
import {
  IconAutoKeyframe,
  IconChevron,
  IconPause,
  IconPlay,
  IconSnapMagnet,
  IconToEnd,
  IconToStart,
  IconTrash,
} from '../leftrail/icons'
import { FilmModeSwitch } from '../film/FilmModeSwitch'
import { IconFit } from '../film/icons'
import { FilmPanel } from '../film'
import { framesToSeconds, secondsToFrame } from '../../evaluate/timecode'
import { LEFT_W, TIMELINE_FPS_MAX, TIMELINE_FPS_MIN, TRACK_INSET, frameFromContentClientX } from './constants'
import { KeyframeDragPreviewProvider } from './hooks/useKeyframeDrag'
import { useSnapFrame } from './hooks/useSnapFrame'
import { useTimelineScrub } from './hooks/useTimelineScrub'
import { Playhead } from './Playhead'
import { Ruler } from './Ruler'
import { TrackRow } from './TrackRow'
import { cameraMotionOwnsKeyframes } from '../../evaluate/camera/cameraMotionExclusive'
import { anchoredScrollLeft, buildTree, fitPxForRange, flattenTree, frameAtContentX, selectedTimelineNodeId, timelineContentFrameEnd, timelineFitPx, wheelZoomPxPerFrame } from './utils'
import { getActiveEditSequence } from '../../evaluate'

export function TimelinePanel() {
  const { useStore } = useDirector()
  const workspaceMode = useStore((s) => s.workspaceMode)
  const timelineVisible = useStore((s) => s.timelineVisible)
  if (workspaceMode === 'film') return <FilmPanel />
  if (!timelineVisible) return null
  return <SceneTimeline />
}

function SceneTimeline() {
  const t = useT()
  const { stage, useStore } = useDirector()
  const doc = useStore((s) => s.doc)
  const clipMovePreview = useStore((s) => s.clipMovePreview)
  const clipResizePreview = useStore((s) => s.clipResizePreview)
  const playing = useStore((s) => s.playing)
  const writeLocked = useStore((s) => s.writeLocked)
  const selection = useStore((s) => s.selection)
  const userKeys = useStore((s) => s.userKeys)
  const fcurves = useStore((s) => s.fcurves)
  const userKeysEnabled = useStore((s) => s.userKeysEnabled)
  const autoKeyframe = useStore((s) => s.autoKeyframe)
  const timelineSnap = useStore((s) => s.timelineSnap)
  const chainCameraMotion = useStore((s) => s.chainCameraMotion)
  const pxPerFrame = useStore((s) => s.pxPerFrame)
  const timelineUnit = useStore((s) => s.timelineUnit)
  const timelineOpen = useStore((s) => s.timelineOpen)
  const timelineHeight = useStore((s) => s.timelineHeight)
  const {
    setFrame,
    togglePlay,
    select,
    setPxPerFrame,
    setTimelineUnit,
    toggleUserKeys,
    toggleAutoKeyframe,
    toggleTimelineSnap,
    addKeyframes,
    addTransformKeyframes,
    moveKeyframes,
    toggleChainCameraMotion,
    toggleTimeline,
    setTimelineHeight,
    setTimelineRange,
    setTimelineFps,
    beginTimelineRangeEdit,
    endTimelineRangeEdit,
    removeKeyframe,
    removeFcurveKeyframe,
    removeTransformKeysAtFrame,
    clearTimelineReveal,
  } = useStore()
  const timelineRevealClip = useStore((s) => s.timelineRevealClip)
  const [onlySelectedCharacter, setOnlySelectedCharacter] = useState(false)
  const trackAvailRef = useRef(0)
  const revealNonceRef = useRef(0)
  const clampAvailableHeight = (value: number) => {
    const available = Math.max(140, window.innerHeight - 44 - 180)
    return clampTimelineHeight(Math.min(value, available))
  }
  const { onPointerDown, onDoubleClick } = useVerticalResize(timelineHeight, timelineOpen, setTimelineHeight, clampAvailableHeight, {
    defaultValue: TIMELINE_HEIGHT_DEFAULT,
    storageKey: 'topview.builder.panel.timelineHeight',
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(pxPerFrame)
  const frameStartRef = useRef(0)
  const [viewW, setViewW] = useState(0)
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})

  // N3: nhớ đơn vị hiển thị (giây/frame/tick) như các preference panel khác.
  const unitHydrated = useRef(false)
  useEffect(() => {
    if (!unitHydrated.current) {
      unitHydrated.current = true
      const stored = readTimelineUnit(browserPanelStorage())
      if (stored !== timelineUnit) {
        setTimelineUnit(stored)
        return
      }
    }
    writeTimelineUnit(browserPanelStorage(), timelineUnit)
  }, [timelineUnit, setTimelineUnit])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewW(el.clientWidth)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [timelineOpen])

  const frameFromClientX = useCallback(
    (clientX: number) => {
      const root = contentRef.current
      const fs = doc?.content.timeline.frameStart ?? 0
      if (!root) return fs
      return frameFromContentClientX(clientX, root.getBoundingClientRect().left, fs, scaleRef.current)
    },
    [doc],
  )

  const tl = doc?.content.timeline
  const anim = tl?.animation
  const frameCount = tl
    ? timelineContentFrameEnd(tl.frameEnd, [
      ...(anim?.cameraMotionClips ?? []),
      ...(anim?.pathMotionClips ?? []),
      ...(anim?.motionClips ?? []),
      ...(clipMovePreview ? [clipMovePreview] : []),
      ...(clipResizePreview ? [clipResizePreview] : []),
    ]) - tl.frameStart + 1
    : 1
  const trackAvail = viewW - LEFT_W - TRACK_INSET
  trackAvailRef.current = trackAvail
  const scale = pxPerFrame
  const fitTimeline = () => {
    const next = timelineFitPx(frameCount, trackAvail)
    if (next == null) return
    setPxPerFrame(next)
    const scroller = scrollRef.current
    if (scroller) scroller.scrollLeft = 0
  }
  scaleRef.current = scale
  frameStartRef.current = tl?.frameStart ?? 0

  // Ctrl (hoặc pinch trackpad) + lăn chuột: zoom quanh frame dưới con trỏ, frame neo đứng yên.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY
      const oldPx = scaleRef.current
      const nextPx = wheelZoomPxPerFrame(oldPx, deltaY)
      if (nextPx === oldPx) return
      const cursorOffsetX = event.clientX - el.getBoundingClientRect().left
      const anchorFrame = frameAtContentX(el.scrollLeft + cursorOffsetX, frameStartRef.current, oldPx)
      setPxPerFrame(nextPx)
      scaleRef.current = nextPx
      requestAnimationFrame(() => {
        el.scrollLeft = anchoredScrollLeft({ anchorFrame, frameStart: frameStartRef.current, pxPerFrame: nextPx, cursorOffsetX })
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [timelineOpen, setPxPerFrame])

  // "Vừa shot": ưu tiên clip đang chọn; không có thì shot biên tập chứa playhead.
  const fitShotRange = (): { start: number; end: number } | null => {
    if (!doc || !tl) return null
    if (selection?.kind === 'clip') {
      const list = selection.clipType === 'camera'
        ? tl.animation.cameraMotionClips
        : selection.clipType === 'motion'
          ? tl.animation.motionClips
          : tl.animation.pathMotionClips
      const clip = list.find((item) => item.id === selection.clipId)
      if (clip) return { start: clip.frameStart, end: clip.frameEnd }
    }
    const sequence = getActiveEditSequence(doc)
    const shot = sequence?.clips.find((item) => frame >= item.sourceFrameStart && frame <= item.sourceFrameEnd)
    return shot ? { start: shot.sourceFrameStart, end: shot.sourceFrameEnd } : null
  }
  const fitShot = () => {
    const range = fitShotRange()
    if (!range || !tl) return
    const next = fitPxForRange(range.start, range.end, trackAvail)
    if (next == null) return
    setPxPerFrame(next)
    scaleRef.current = next
    requestAnimationFrame(() => {
      const scroller = scrollRef.current
      if (scroller) scroller.scrollLeft = Math.max(0, (range.start - tl.frameStart) * next - 8)
    })
  }
  const snap = useSnapFrame(scale)
  const { rulerRef, scrubHandlers } = useTimelineScrub(
    tl?.frameStart ?? 0,
    scale,
    setFrame,
    false,
    snap,
  )

  const { kfBox, onKfBoxPointerDown, onKfBoxPointerMove, onKfBoxPointerUp, onKfBoxKeyDown } = useTimelineMarquee({
    contentRef, doc, selection, select, setFrame, snap, frameFromClientX,
  })

  // 视口选中主体物体平滑滚屏聚焦；点击关键帧/轨迹/运镜保持原位不滚动。
  // 必须放在 early return 之前，避免 Hooks 顺序变化。
  useEffect(() => {
    if (!doc || !timelineOpen) return
    // 仅在显式选中主体物体（kind === 'node'）时才可能执行滚屏聚焦。
    // 点击关键帧（keyframe / transformKeyframe）、轨迹/运镜/动作片段（clip）及框选（timelineBox）保持原位不滚动。
    if (!selection || selection.kind !== 'node') return
    const nodeId = selection.nodeId
    if (!nodeId) return
    const root = scrollRef.current
    if (!root) return
    const frame = requestAnimationFrame(() => {
      const el = root.querySelector<HTMLElement>(
        `[data-timeline-node="${CSS.escape(nodeId)}"]`,
      )
      if (!el) return
      const rootRect = root.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      // 吸顶标尺占用顶部 30px 高度，加上 8px 安全缓冲避免被标尺遮挡；底部留 8px 缓冲
      const topOffset = 38
      const bottomPad = 8
      if (elRect.top >= rootRect.top + topOffset && elRect.bottom <= rootRect.bottom - bottomPad) return
      const delta =
        elRect.top - rootRect.top - (rootRect.height - elRect.height) / 2
      root.scrollTo({
        top: Math.max(0, root.scrollTop + delta),
        behavior: 'smooth',
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [selection, timelineOpen])

  // C27: host vừa gán một clip — phóng tới khoảng clip, cuộn ngang tới clip và nháy sáng nó.
  useEffect(() => {
    if (!timelineRevealClip || timelineRevealClip.nonce === revealNonceRef.current) return
    revealNonceRef.current = timelineRevealClip.nonce
    const request = timelineRevealClip
    const frames = Math.max(1, request.frameEnd - request.frameStart + 1)
    if (trackAvailRef.current > 0) setPxPerFrame(trackAvailRef.current / frames)
    let attempts = 0
    let raf = 0
    const tryReveal = () => {
      const root = scrollRef.current
      const el = root?.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(request.clipId)}"]`)
      if (root && el) {
        const rootRect = root.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        root.scrollLeft = Math.max(0, root.scrollLeft + elRect.left - rootRect.left - LEFT_W - 24)
        el.classList.add('t3d-timeline-clip-flash')
        window.setTimeout(() => el.classList.remove('t3d-timeline-clip-flash'), 1900)
        clearTimelineReveal()
        return
      }
      if (++attempts < 12) raf = requestAnimationFrame(tryReveal)
      else clearTimelineReveal()
    }
    raf = requestAnimationFrame(tryReveal)
    return () => cancelAnimationFrame(raf)
  }, [timelineRevealClip, clearTimelineReveal, setPxPerFrame])

  if (!doc || !tl) return <div className="t3d-timeline">{t('common.loading')}</div>

  const selectedNodeId = selectedTimelineNodeId(doc, selection)
  const multiSelectedIds = nodeIdsOf(selection)
  const isOpen = (row: { key: string; kind: string }) => {
    if (openMap[row.key] !== undefined) return openMap[row.key]
    // 物体根行默认展开；变换组始终收起，打关键帧后也不自动展开。
    if (row.kind === 'node') return true
    return false
  }
  const allRows = flattenTree(
    buildTree(doc, t, multiSelectedIds.length > 1 ? multiSelectedIds : selectedNodeId, userKeys),
    isOpen,
  )

  const rows = onlySelectedCharacter && selectedNodeId ? allRows.filter((item) => item.row.nodeId === selectedNodeId) : allRows

  const trackW = frameCount * scale
  const frame = stage.currentFrame
  const sheet = timelineUnitRuler(scale, tl.fps, timelineUnit)

  const snapshotValue = (nodeId: string, prop: TrackProp): number[] => {
    const snap = stage.getNodeSnapshot(nodeId)
    const node = doc.content.nodes.find((n) => n.id === nodeId)
    if (snap) {
      if (prop === 'fov') return [snap.fov ?? 50]
      if (prop === 'lookAt') return [...(snap.lookAt ?? [0, 0, 0])]
      return [...snap[prop]]
    }
    if (node) {
      const xf = node.transform
      if (prop === 'fov') return [node.camera?.fov ?? 50]
      if (prop === 'lookAt') {
        return node.camera ? [node.camera.lookAt.x, node.camera.lookAt.y, node.camera.lookAt.z] : [0, 0, 0]
      }
      return [xf[prop].x, xf[prop].y, xf[prop].z]
    }
    return prop === 'fov' ? [50] : [0, 0, 0]
  }

  const deleteTimelineSelection = useStore.getState().deleteSelection

  const canDeleteTimelineSelection =
    selection?.kind === 'keyframe' ||
    selection?.kind === 'transformKeyframe' ||
    selection?.kind === 'clip' ||
    (selection?.kind === 'timelineBox' && (selection.clips.length > 0 || selection.keys.length > 0))

  const onAddKeyframe = (nodeId: string, props: TrackProp | TrackProp[]) => {
    if (cameraMotionOwnsKeyframes(doc, nodeId)) return
    const list = Array.isArray(props) ? props : [props]
    // 这一行的节点在多选里 → 整批选中对象一起打键（一条 undo），否则只打这一个。
    const selectedIds = nodeIdsOf(selection)
    if (selectedIds.length > 1 && selectedIds.includes(nodeId)) {
      addTransformKeyframes(selectedIds, list)
      return
    }
    addKeyframes(
      nodeId,
      list.map((prop) => ({ prop, value: snapshotValue(nodeId, prop) })),
    )
  }

  return (
    <div
      className={cx('t3d-timeline', !timelineOpen && 'is-collapsed')}
      data-tutorial-anchor="timeline"
      style={{ ['--t3d-timeline-height' as string]: `${timelineHeight}px` }}
    >
      <Tooltip label={timelineOpen ? t('timeline.collapse') : t('timeline.expand')} side="top">
        <button type="button" className="t3d-timeline-fold" onClick={toggleTimeline}>
          <IconChevron className="t3d-timeline-fold-icon" />
        </button>
      </Tooltip>
      {timelineOpen ? (
        <div
          className="t3d-timeline-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('timeline.resize')}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
        />
      ) : null}
      <div className="t3d-timeline-toolbar">
        <FilmModeSwitch />
        <div className="t3d-timeline-group">
          <TransportButton label={t('timeline.toStart')} onClick={() => setFrame(tl.frameStart)}>
            <IconToStart />
          </TransportButton>
          <TransportButton
            className="t3d-timeline-play"
            label={playing ? t('timeline.pause') : t('timeline.play')}
            onClick={togglePlay}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </TransportButton>
          <TransportButton label={t('timeline.toEnd')} onClick={() => setFrame(tl.frameEnd)}>
            <IconToEnd />
          </TransportButton>
        </div>
        <Tooltip label={t('help.autoKey')} side="top" variant="description">
          <button
            aria-label={t('timeline.autoKeyframe')}
            type="button"
            className={cx('t3d-timeline-auto-key', autoKeyframe && 'is-active')}
            aria-pressed={autoKeyframe}
            onClick={toggleAutoKeyframe}
          >
            <IconAutoKeyframe />
            {t('timeline.autoKeyframe')}
          </button>
        </Tooltip>
        <Tooltip label={t('timeline.snapTitle')} side="top">
          <button
            type="button"
            className={cx('t3d-timeline-auto-key', timelineSnap && 'is-active')}
            aria-pressed={timelineSnap}
            onClick={toggleTimelineSnap}
          >
            <IconSnapMagnet />
            {t('timeline.snap')}
          </button>
        </Tooltip>
        <label className="t3d-timeline-field">
          {t('timeline.frame')}
          <TimelineFrameField min={tl.frameStart} max={tl.frameEnd} onChange={setFrame} unit={timelineUnit} fps={tl.fps} />
        </label>
        <Tooltip label={t('common.delete')} side="top">
          <button
            type="button"
            className="t3d-timeline-icon-btn"
            disabled={writeLocked || !canDeleteTimelineSelection}
            aria-label={t('common.delete')}
            onClick={deleteTimelineSelection}
          >
            <IconTrash />
          </button>
        </Tooltip>
        <div className="t3d-timeline-toolbar-end">
          <label className="t3d-timeline-field">
            {t('timeline.fps')}
            <ScrubNumberInput
              value={tl.fps}
              min={TIMELINE_FPS_MIN}
              max={TIMELINE_FPS_MAX}
              step={1}
              precision={0}
              ariaLabel={t('timeline.fps')}
              disabled={writeLocked}
              onEditStart={beginTimelineRangeEdit}
              onChange={setTimelineFps}
              onEditEnd={endTimelineRangeEdit}
            />
          </label>
          <div className="t3d-timeline-unit-switch" role="group" aria-label={t('timeline.unit')}>
            {(['seconds', 'frames', 'ticks'] as TimelineUnit[]).map((unit) => (
              <button
                key={unit}
                type="button"
                className={cx('t3d-timeline-unit-btn', timelineUnit === unit && 'is-active')}
                aria-pressed={timelineUnit === unit}
                onClick={() => setTimelineUnit(unit)}
              >
                {t(unit === 'seconds' ? 'timeline.unitSeconds' : unit === 'frames' ? 'timeline.unitFrames' : 'timeline.unitTicks')}
              </button>
            ))}
          </div>
          <label className="t3d-timeline-field t3d-timeline-zoom">
            {t('timeline.zoom')}
            <RangeSlider
              min={0.2}
              max={PX_PER_FRAME_MAX}
              step={0.1}
              aria-label={t('timeline.zoom')}
              value={pxPerFrame}
              onChange={(e) => setPxPerFrame(Number(e.target.value))}
            />
          </label>
          <Tooltip label={t('timeline.fitShot')} side="top">
            <button type="button" className="t3d-timeline-auto-key" disabled={!tl || trackAvail <= 0} onClick={fitShot}>
              {t('timeline.fitShot')}
            </button>
          </Tooltip>
          <Tooltip label={t('timeline.fitAll')} side="top">
            <button type="button" className="t3d-timeline-icon-btn" disabled={!tl || trackAvail <= 0} onClick={fitTimeline} aria-label={t('timeline.fitAll')}>
              <IconFit />
            </button>
          </Tooltip>
          <div className="t3d-timeline-range-cluster">
            <TimelineRangeField
              label={t('timeline.rangeStart')}
              unit={t('timeline.secondsUnit')}
              value={framesToSeconds(tl.frameStart, tl.fps)}
              min={0}
              max={framesToSeconds(Math.max(0, tl.frameEnd - 1), tl.fps)}
              step={0.1}
              precision={1}
              fixed
              disabled={writeLocked}
              onBegin={beginTimelineRangeEdit}
              onCommit={(start) => setTimelineRange(secondsToFrame(start, tl.fps), tl.frameEnd)}
              onEnd={endTimelineRangeEdit}
            />
            <TimelineRangeField
              label={t('timeline.rangeEnd')}
              unit={t('timeline.secondsUnit')}
              value={framesToSeconds(tl.frameEnd, tl.fps)}
              min={framesToSeconds(tl.frameStart + 1, tl.fps)}
              step={0.1}
              precision={1}
              fixed
              disabled={writeLocked}
              onBegin={beginTimelineRangeEdit}
              onCommit={(end) => setTimelineRange(tl.frameStart, secondsToFrame(end, tl.fps))}
              onEnd={endTimelineRangeEdit}
            />
          </div>
        </div>
        <div className="t3d-timeline-toolbar-tail t3d-timeline-eval-toggles">
          <label className="t3d-timeline-toggle">
            <input type="checkbox" checked={userKeysEnabled} onChange={toggleUserKeys} />
            {t('timeline.userKeys')}
          </label>
          <label className="t3d-timeline-toggle" title={t('timeline.chainMotionTitle')}>
            <input type="checkbox" checked={chainCameraMotion} onChange={toggleChainCameraMotion} />
            {t('timeline.chainMotion')}
          </label>
          <label className="t3d-timeline-toggle">
            <input type="checkbox" checked={onlySelectedCharacter} onChange={(event) => setOnlySelectedCharacter(event.target.checked)} />
            {t('timeline.onlySelectedCharacter')}
          </label>
        </div>
      </div>

      {timelineOpen ? (
        <div className="t3d-timeline-scroll" ref={scrollRef}>
          <KeyframeDragPreviewProvider>
          <div
            className="t3d-timeline-content"
            ref={contentRef}
            style={{
              width: LEFT_W + TRACK_INSET + trackW,
              minWidth: '100%',
              ['--t3d-sheet-grid-step' as string]: `${sheet.step * scale}px`,
            }}
            onPointerDown={onKfBoxPointerDown}
            onPointerMove={onKfBoxPointerMove}
            onPointerUp={onKfBoxPointerUp}
            onPointerCancel={onKfBoxPointerUp}
            onKeyDownCapture={onKfBoxKeyDown}
            tabIndex={-1}
          >
            <Ruler
              frameStart={tl.frameStart}
              frameEnd={tl.frameEnd}
              fps={tl.fps}
              unit={timelineUnit}
              pxPerFrame={scale}
              currentFrame={frame}
              ariaLabel={t('timeline.frame')}
              rulerRef={rulerRef}
              scrubHandlers={scrubHandlers}
            />
            <div
              className="t3d-timeline-grid"
              style={{ left: LEFT_W + TRACK_INSET, width: trackW }}
            />
            <Playhead
              frameStart={tl.frameStart}
              pxPerFrame={scale}
              currentFrame={frame}
              scrubHandlers={scrubHandlers}
            />
            {rows.map(({ row, depth }) => (
              <TrackRow
                key={row.key}
                row={row}
                depth={depth}
                open={isOpen(row)}
                frameStart={tl.frameStart}
                pxPerFrame={scale}
                selection={selection}
                userKeys={userKeys}
              keyframesLocked={cameraMotionOwnsKeyframes(doc, row.nodeId)}
              keyframesLockedHint={t('timeline.keyframeSuspendedByMotion')}
                fcurves={fcurves}
                onSelect={select}
                onToggle={(key) => setOpenMap((m) => ({ ...m, [key]: !isOpen(row) }))}
                onAddKeyframe={onAddKeyframe}
                onMoveKeyframes={moveKeyframes}
                onRemoveKeyframe={removeKeyframe}
                onRemoveFcurveKeyframe={removeFcurveKeyframe}
                onRemoveTransformKeys={removeTransformKeysAtFrame}
              />
            ))}
            {kfBox && (kfBox.width >= 1 || kfBox.height >= 1) ? (
              <div
                className="t3d-timeline-kf-box"
                style={{
                  left: kfBox.left,
                  top: kfBox.top,
                  width: kfBox.width,
                  height: kfBox.height,
                }}
                aria-hidden
              />
            ) : null}
          </div>
          </KeyframeDragPreviewProvider>
        </div>
      ) : null}
    </div>
  )
}
