import { useDirector } from '../../bridge/DirectorContext'
import type { FCurveSet } from '../../evaluate/curves/FCurveSet'
import { fovToFocalLength } from '../../evaluate/camera/focalLength'
import type { TrackProp, UserKeys } from '../../evaluate/curves/KeyframeTrack'
import { useT } from '../../locale'
import { nodeIdsOf } from '../../stores/nodeSelection'
import { fcurveRefsOf, type KeyframeRef, type Selection } from '../../stores/types'
import { Tooltip } from '../common/Tooltip'
import { cx } from '../common/cx'
import { IconChevron } from '../leftrail/icons'
import { FC_PROP_PATH } from './constants'
import { useKeyframeDrag } from './hooks/useKeyframeDrag'
import { useSnapFrame } from './hooks/useSnapFrame'
import type { TimelineRow } from './types'
import {
collectSummary,
isKeyframeHighlighted,
keyframePreviewOffset,
bundlePreviewOffset,
nextKeyframeSelection
} from './utils'

import { CameraClips, MotionClips, PathClips } from './TimelineClipRows'
import { AddKeyframeButton, AggregateKeyframes, GhostKeyframes } from './TimelineKeyframeRows'
import { fcurveFrames, isAdditiveMod, nextRowSelection } from './utils/trackRow'
import { fcurveRefsAtFrame, fcurveToken, nextTimelineKeySelection, sameFcurve, selectedTimelineDragItems, selectedTimelineRefs } from './utils/fcurveSelection'

export function TrackRow({
  row,
  depth,
  open,
  frameStart,
  pxPerFrame,
  selection,
  userKeys,
  fcurves,
  keyframesLocked = false,
  keyframesLockedHint,
  onSelect,
  onToggle,
  pinned,
  onTogglePin,
  onAddKeyframe,
  onMoveKeyframes,
  onRemoveKeyframe,
  onRemoveFcurveKeyframe,
  onRemoveTransformKeys,
}: {
  row: TimelineRow
  depth: number
  open: boolean
  frameStart: number
  pxPerFrame: number
  selection: Selection | null
  userKeys: UserKeys
  fcurves: FCurveSet | null
  keyframesLocked?: boolean
  keyframesLockedHint?: string
  onSelect: (next: Selection | null) => void
  onToggle: (key: string) => void
  /** Defined only for root node rows: whether the row is pinned to the top. */
  pinned?: boolean
  onTogglePin?: (nodeId: string) => void
  onAddKeyframe: (nodeId: string, props: TrackProp | TrackProp[]) => void
  onMoveKeyframes: (items: { nodeId: string; prop: TrackProp; keyId: string; newFrame: number }[]) => void
  onRemoveKeyframe: (nodeId: string, prop: TrackProp, keyId: string) => void
  onRemoveFcurveKeyframe: (nodeId: string, propPath: string, frame: number) => void
  onRemoveTransformKeys: (nodeId: string, frame: number) => void
}) {
  const t = useT()
  const { useStore } = useDirector()
  const setFrame = useStore((s) => s.setFrame)
  const writeLocked = useStore((s) => s.writeLocked)
  const moveKeys = keyframesLocked || writeLocked ? () => {} : onMoveKeyframes
  const snap = useSnapFrame(pxPerFrame)
  const dragKf = useKeyframeDrag(pxPerFrame, moveKeys, snap)
  const previewDf = dragKf.previewDf
  const draggingKeyIds = dragKf.draggingKeyIds

  const hasKids = !!row.children?.length
  const xformProps = row.addTransformKeys
  const summary = hasKids && !open && !xformProps ? collectSummary(row) : null

  return (
    <div
      className={cx('t3d-timeline-row', `t3d-timeline-row-${row.kind}`)}
      data-timeline-node={row.kind === 'node' ? row.nodeId : undefined}
    >
      <div
        className={cx(
          't3d-timeline-name',
          // 多选时每个被选中的节点行都高亮，不只主选那一行。
          row.kind === 'node' &&
            nodeIdsOf(selection).includes(row.nodeId) &&
            't3d-timeline-name-selected',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(e) => {
          // Ctrl/Cmd/Shift + bấm tên dòng: thêm/bỏ node vào nhóm chọn nhiều dòng.
          if (isAdditiveMod(e)) {
            onSelect(nextRowSelection(selection, row.nodeId, true))
            return
          }
          // A path sub-track represents a selectable path object rather than
          // only its target character. Selecting its first clip keeps the
          // target filtered in Timeline and makes the corresponding path
          // visible/highlighted in the viewport.
          if (row.kind === 'clips-path' && row.pathClips?.length) {
            onSelect({ kind: 'clip', clipType: 'path', clipId: row.pathClips[0].id })
          } else {
            onSelect({ kind: 'node', nodeId: row.nodeId })
          }
        }}
        title={
          row.kind === 'node'
            ? `${row.nodeName}（${row.nodeId} · ${row.nodeType}）`
            : `${row.nodeName} › ${row.label}`
        }
      >
        {hasKids ? (
          <Tooltip
            label={t(open ? 'timeline.collapseTrack' : 'timeline.expandTrack', { name: row.label })}
            side="top"
          >
            <button
              type="button"
              className={cx('t3d-timeline-twisty', open && 'is-open')}
              aria-expanded={open}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(row.key)
              }}
            >
              <IconChevron />
            </button>
          </Tooltip>
        ) : (
          <span className="t3d-timeline-twisty-spacer" />
        )}
        {row.kind === 'node' ? (
          <span
            className="t3d-timeline-node-name"
            onClick={hasKids ? (e) => { if (!isAdditiveMod(e)) onToggle(row.key) } : undefined}
          >
            {row.label}
          </span>
        ) : (
          <span
            className="t3d-timeline-track-label"
            onClick={hasKids ? (e) => { if (!isAdditiveMod(e)) onToggle(row.key) } : undefined}
          >
            {row.label}
          </span>
        )}
        {onTogglePin ? (
          <Tooltip label={t(pinned ? 'timeline.unpinTrack' : 'timeline.pinTrack')} side="top">
            <button
              type="button"
              className={cx('t3d-timeline-pin', pinned && 'is-pinned')}
              aria-pressed={!!pinned}
              aria-label={t(pinned ? 'timeline.unpinTrack' : 'timeline.pinTrack')}
              onClick={(e) => {
                e.stopPropagation()
                onTogglePin(row.nodeId)
              }}
            >
              {pinned ? '★' : '☆'}
            </button>
          </Tooltip>
        ) : null}
        {row.followsSubject ? (
          <span className="t3d-timeline-follow-badge" title={t('library.subjectBound')}>
            {t('library.subjectBound')}
          </span>
        ) : null}
        {row.kind === 'kf' && row.prop ? (
          <AddKeyframeButton
            label={t('timeline.insert')}
            name={row.label}
            locked={keyframesLocked || writeLocked}
            lockedHint={keyframesLockedHint}
            onClick={() => onAddKeyframe(row.nodeId, row.prop!)}
          />
        ) : xformProps ? (
          <AddKeyframeButton
            label={t('timeline.insert')}
            name={row.label}
            locked={keyframesLocked || writeLocked}
            lockedHint={keyframesLockedHint}
            onClick={() => onAddKeyframe(row.nodeId, xformProps)}
          />
        ) : null}
      </div>
      <div className="t3d-timeline-track">
        {xformProps ? (
          <AggregateKeyframes
            nodeId={row.nodeId}
            props={xformProps}
            frameStart={frameStart}
            pxPerFrame={pxPerFrame}
            userKeys={userKeys}
            fcurves={fcurves}
            selection={selection}
            muted={keyframesLocked}
            readOnly={writeLocked}
            mutedHint={keyframesLockedHint}
            onSelect={onSelect}
            onSeek={setFrame}
            onMoveKeyframes={moveKeys}
            onRemoveTransformKeys={onRemoveTransformKeys}
          />
        ) : null}
        {summary ? (
          <>
            <CameraClips
              clips={summary.cam}
              ghost
              frameStart={frameStart}
              pxPerFrame={pxPerFrame}
              selection={selection}
              onSelect={onSelect}
            />
            <MotionClips
              clips={summary.motion}
              ghost
              frameStart={frameStart}
              pxPerFrame={pxPerFrame}
              selection={selection}
              onSelect={onSelect}
            />
            <PathClips
              clips={summary.path}
              ghost
              frameStart={frameStart}
              pxPerFrame={pxPerFrame}
              selection={selection}
              onSelect={onSelect}
            />
            <GhostKeyframes
              summary={summary}
              frameStart={frameStart}
              pxPerFrame={pxPerFrame}
              userKeys={userKeys}
              selection={selection}
              readOnly={writeLocked}
              onSelect={onSelect}
              onSeek={setFrame}
              onMoveKeyframes={moveKeys}
            />
          </>
        ) : null}
        {row.kind === 'clips-camera' && row.camClips!.length > 0 && (
          <CameraClips
            clips={row.camClips!}
            ghost={false}
            frameStart={frameStart}
            pxPerFrame={pxPerFrame}
            selection={selection}
            onSelect={onSelect}
          />
        )}
        {row.kind === 'clips-motion' && row.motionClips!.length > 0 && (
          <MotionClips
            clips={row.motionClips!}
            ghost={false}
            frameStart={frameStart}
            pxPerFrame={pxPerFrame}
            selection={selection}
            onSelect={onSelect}
          />
        )}
        {row.kind === 'clips-path' && row.pathClips!.length > 0 && (
          <PathClips
            clips={row.pathClips!}
            ghost={false}
            frameStart={frameStart}
            pxPerFrame={pxPerFrame}
            selection={selection}
            onSelect={onSelect}
          />
        )}
        {row.kind === 'kf' && (
          <>
            {fcurveFrames(fcurves, row.nodeId, row.prop!)
              // 同帧已有 userKeys 菱形时不重复画（userKeys 优先，可交互）
              .filter(
                (f) => !(userKeys[row.nodeId]?.[row.prop!] ?? []).some((k) => Math.abs(k.frame - f) <= 1e-6),
              )
              .map((f) => {
                const curves = fcurveRefsAtFrame(fcurves, row.nodeId, [row.prop!], f)
                const tokens = curves.map(fcurveToken)
                const selected = curves.every((ref) => selectedTimelineRefs(selection, userKeys, fcurves).curves.some((item) => sameFcurve(ref, item)))
                return <div
                  key={`fc:${f}`}
                  className={cx('t3d-timeline-kf t3d-timeline-kf-fcurve', selected && 't3d-timeline-kf-selected', keyframesLocked && 't3d-timeline-kf-suspended')}
                  data-fcurve-bundle={JSON.stringify(curves)}
                  data-timeline-key-tokens={JSON.stringify(tokens)}
                  style={{ left: (f - frameStart + (tokens.length ? keyframePreviewOffset(previewDf, tokens[0], draggingKeyIds) : 0)) * pxPerFrame }}
                  title={t('timeline.fcurveKey', { frame: f })}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    if (e.button !== 0) return
                    if (keyframesLocked) { setFrame(f); return }
                    const additive = isAdditiveMod(e)
                    const next = nextTimelineKeySelection(selection, [], curves, additive, userKeys, fcurves)
                    if (next !== selection) onSelect(next)
                    setFrame(f)
                    if (!writeLocked && !additive) dragKf.begin(e, selectedTimelineDragItems(next, userKeys, fcurves))
                  }}
                  onPointerMove={keyframesLocked || writeLocked ? undefined : dragKf.move}
                  onPointerUp={keyframesLocked || writeLocked ? undefined : dragKf.end}
                  onPointerCancel={keyframesLocked || writeLocked ? undefined : dragKf.cancel}
                  onDoubleClick={(e) => { e.stopPropagation(); if (!keyframesLocked && !writeLocked) onRemoveFcurveKeyframe(row.nodeId, FC_PROP_PATH[row.prop!], f) }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!keyframesLocked && !writeLocked) onRemoveFcurveKeyframe(row.nodeId, FC_PROP_PATH[row.prop!], f) }}
                />
              })}
            {(userKeys[row.nodeId]?.[row.prop!] ?? []).map((kf) => {
              const curves = fcurveRefsAtFrame(fcurves, row.nodeId, [row.prop!], kf.frame)
              const tokens = [kf.id, ...curves.map(fcurveToken)]
              const diamond = (
                <div
                  key={kf.id}
                  className={cx(
                    't3d-timeline-kf',
                    isKeyframeHighlighted(selection, {
                      keyId: kf.id,
                      nodeId: row.nodeId,
                      frame: kf.frame,
                    }) && 't3d-timeline-kf-selected',
                    keyframesLocked && 't3d-timeline-kf-suspended',
                  )}
                  data-kf-node={row.nodeId}
                  data-kf-prop={row.prop}
                  data-kf-id={kf.id}
                  data-timeline-key-tokens={JSON.stringify(tokens)}
                  data-fcurve-bundle={JSON.stringify(curves)}
                  style={{
                    left:
                      (kf.frame -
                        frameStart +
                        (!keyframesLocked
                          ? bundlePreviewOffset(previewDf, tokens, draggingKeyIds)
                          : 0)) *
                      pxPerFrame,
                  }}
                  title={
                    keyframesLocked
                      ? keyframesLockedHint
                      : t('timeline.userKey', {
                          frame: kf.frame,
                          value: formatTrackValue(row.prop, kf.value),
                          interpolation: kf.interpolation,
                        })
                  }
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    if (keyframesLocked) {
                      setFrame(kf.frame)
                      return
                    }
                    const clicked: KeyframeRef = { nodeId: row.nodeId, prop: row.prop!, keyId: kf.id }
                    const additive = isAdditiveMod(e)
                    const next = curves.length || fcurveRefsOf(selection).length
                      ? nextTimelineKeySelection(selection, [clicked], curves, additive, userKeys, fcurves)
                      : nextKeyframeSelection(selection, clicked, additive, kf.frame, userKeys)
                    if (next !== selection) onSelect(next)
                    if (writeLocked) {
                      setFrame(kf.frame)
                      return
                    }
                    if (!additive) dragKf.begin(e, selectedTimelineDragItems(next, userKeys, fcurves))
                    setFrame(kf.frame)
                  }}
                  onPointerMove={keyframesLocked || writeLocked ? undefined : dragKf.move}
                  onPointerUp={keyframesLocked || writeLocked ? undefined : dragKf.end}
                  onPointerCancel={keyframesLocked || writeLocked ? undefined : dragKf.cancel}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if (keyframesLocked || writeLocked) return
                    onRemoveKeyframe(row.nodeId, row.prop!, kf.id)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (keyframesLocked || writeLocked) return
                    onRemoveKeyframe(row.nodeId, row.prop!, kf.id)
                  }}
                />
              )
              if (keyframesLocked && keyframesLockedHint) {
                return (
                  <Tooltip key={kf.id} label={keyframesLockedHint} side="top" delay={120}>
                    {diamond}
                  </Tooltip>
                )
              }
              return diamond
            })}
          </>
        )}
      </div>
    </div>
  )
}

function formatTrackValue(prop: TrackProp | undefined, value: number[]): string {
  if (prop === 'fov') return value.map((v) => fovToFocalLength(v).toFixed(1)).join(', ')
  return value.map((v) => v.toFixed(2)).join(', ')
}
