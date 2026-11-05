import { useKeyframeContextMenu } from './KeyframeContextMenu'
import { useDirector } from '../../bridge/DirectorContext'
import { fcurveRefsOf } from '../../stores/types'
import type { FCurveSet } from '../../evaluate/curves/FCurveSet'
import type { TrackProp, UserKeys } from '../../evaluate/curves/KeyframeTrack'
import { type KeyframeRef, type Selection } from '../../stores/types'
import { Tooltip } from '../common/Tooltip'
import { cx } from '../common/cx'
import { useKeyframeDrag } from './hooks/useKeyframeDrag'
import { useSnapFrame } from './hooks/useSnapFrame'
import type { TimelineSummary } from './types'
import {
bundlePreviewOffset,
collectFrameBundles,
isKeyframeHighlighted,
keyframePreviewOffset,
nextBundleSelection,
nextKeyframeSelection
} from './utils'

import { isAdditiveMod } from './utils/trackRow'
import { fcurveRefsAtFrame, fcurveToken, nextTimelineKeySelection, sameFcurve, selectedTimelineDragItems, selectedTimelineRefs } from './utils/fcurveSelection'
import { transformKeyframeFrames } from './utils/trackRow'

function IconDiamond() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.7a2.41 2.41 0 0 0-3.41 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AddKeyframeButton({
  label,
  name,
  onClick,
  locked,
  lockedHint,
}: {
  label: string
  name: string
  onClick: () => void
  locked?: boolean
  lockedHint?: string
}) {
  const text = locked && lockedHint ? lockedHint : `${label}: ${name}`
  return (
    <Tooltip label={text} side="top" delay={120} showOnFocus>
      <button
        type="button"
        className="t3d-timeline-kf-add"
        aria-label={text}
        disabled={locked}
        onClick={(e) => {
          e.stopPropagation()
          if (locked) return
          onClick()
        }}
      >
        <IconDiamond />
      </button>
    </Tooltip>
  )
}

export function GhostKeyframes({
  summary,
  frameStart,
  pxPerFrame,
  userKeys,
  selection,
  readOnly = false,
  onSelect,
  onSeek,
  onMoveKeyframes,
}: {
  summary: TimelineSummary
  frameStart: number
  pxPerFrame: number
  userKeys: UserKeys
  selection: Selection | null
  readOnly?: boolean
  onSelect: (next: Selection | null) => void
  onSeek: (frame: number) => void
  onMoveKeyframes: (items: { nodeId: string; prop: TrackProp; keyId: string; newFrame: number }[]) => void
}) {
  const openKeyMenu = useKeyframeContextMenu()
  const snap = useSnapFrame(pxPerFrame)
  const { useStore } = useDirector()
  const fcurves = useStore((s) => s.fcurves)
  const drag = useKeyframeDrag(pxPerFrame, onMoveKeyframes, snap)
  const previewDf = drag.previewDf
  const draggingKeyIds = drag.draggingKeyIds
  return summary.kfTracks.flatMap(({ nodeId, prop }) =>
    (userKeys[nodeId]?.[prop] ?? []).map((kf) => (
      <div
        key={`g-uk-${kf.id}`}
        className={cx(
          't3d-timeline-kf',
          't3d-timeline-kf-ghost',
          isKeyframeHighlighted(selection, { keyId: kf.id, nodeId, frame: kf.frame }) &&
            't3d-timeline-kf-selected',
        )}
        data-kf-node={nodeId}
        data-kf-prop={prop}
        data-kf-id={kf.id}
                data-timeline-key-tokens={JSON.stringify([kf.id])}
        style={{
                  left:
                    (kf.frame -
                      frameStart +
                      keyframePreviewOffset(previewDf, kf.id, draggingKeyIds)) *
                    pxPerFrame,
                }}
        onPointerDown={(e) => {
          e.stopPropagation()
          if (e.button !== 0) return
          const clicked: KeyframeRef = { nodeId, prop, keyId: kf.id }
          const additive = isAdditiveMod(e)
          const next = fcurveRefsOf(selection).length ? nextTimelineKeySelection(selection, [clicked], [], additive, userKeys, fcurves) : nextKeyframeSelection(selection, clicked, additive, kf.frame, userKeys)
          if (next !== selection) onSelect(next)
          onSeek(kf.frame)
          if (!readOnly && !additive) drag.begin(e, selectedTimelineDragItems(next, userKeys, fcurves))
        }}
        onDoubleClick={(e) => { e.stopPropagation(); onSelect(nextTimelineKeySelection(selection, [{ nodeId, prop, keyId: kf.id }], [], false, userKeys, fcurves)); onSeek(kf.frame) }}
        onContextMenu={(e) => openKeyMenu(e, nodeId, kf.frame, [{ nodeId, prop, keyId: kf.id }], [], isKeyframeHighlighted(selection, { keyId: kf.id, nodeId, frame: kf.frame }))}
        onPointerMove={readOnly ? undefined : drag.move}
        onPointerUp={readOnly ? undefined : drag.end}
        onPointerCancel={readOnly ? undefined : drag.cancel}
      />
    )),
  )
}

export function AggregateKeyframes({
  nodeId,
  props,
  frameStart,
  pxPerFrame,
  userKeys,
  fcurves,
  selection,
  muted = false,
  readOnly = false,
  mutedHint,
  onSelect,
  onSeek,
  onMoveKeyframes,
  onRemoveTransformKeys,
}: {
  nodeId: string
  props: TrackProp[]
  frameStart: number
  pxPerFrame: number
  userKeys: UserKeys
  fcurves: FCurveSet | null
  selection: Selection | null
  muted?: boolean
  readOnly?: boolean
  mutedHint?: string
  onRemoveTransformKeys: (nodeId: string, frame: number) => void
  onSelect: (next: Selection | null) => void
  onSeek: (frame: number) => void
  onMoveKeyframes: (items: { nodeId: string; prop: TrackProp; keyId: string; newFrame: number }[]) => void
}) {
  const openKeyMenu = useKeyframeContextMenu()
  const snap = useSnapFrame(pxPerFrame)
  const drag = useKeyframeDrag(pxPerFrame, onMoveKeyframes, snap)
  const previewDf = muted || readOnly ? null : drag.previewDf
  const draggingKeyIds = muted || readOnly ? null : drag.draggingKeyIds
  const bundles = collectFrameBundles(nodeId, props, userKeys)
  return transformKeyframeFrames(userKeys, fcurves, nodeId, props).map((frame) => {
    const refs = bundles.find((bundle) => Math.abs(bundle.frame - frame) <= 1e-6)?.refs ?? []
    const curves = fcurveRefsAtFrame(fcurves, nodeId, props, frame)
    const selectedRefs = selectedTimelineRefs(selection, userKeys, fcurves)
    const selected = refs.every((ref) => selectedRefs.keys.some((item) => item.keyId === ref.keyId)) &&
      curves.every((ref) => selectedRefs.curves.some((item) => sameFcurve(item, ref))) && refs.length + curves.length > 0
    const tokens = [...refs.map((ref) => ref.keyId), ...curves.map(fcurveToken)]
    const lead = refs[0]
    const diamond = (
      <div
        key={`agg-${nodeId}-${frame}`}
        className={cx('t3d-timeline-kf', curves.length > 0 && 't3d-timeline-kf-xform', selected && 't3d-timeline-kf-selected', muted && 't3d-timeline-kf-suspended')}
        data-kf-node={lead?.nodeId}
        data-kf-prop={lead?.prop}
        data-kf-id={lead?.keyId}
        data-timeline-key-tokens={JSON.stringify(tokens)}
        data-kf-bundle={JSON.stringify(refs)}
        data-fcurve-bundle={JSON.stringify(curves)}
        style={{ left: (frame - frameStart + bundlePreviewOffset(previewDf, tokens, draggingKeyIds)) * pxPerFrame }}
        onPointerDown={(e) => {
          e.stopPropagation()
          if (e.button !== 0) return
          if (muted) { onSeek(frame); return }
          const additive = isAdditiveMod(e)
          const next = curves.length || fcurveRefsOf(selection).length
            ? nextTimelineKeySelection(selection, refs, curves, additive, userKeys, fcurves)
            : nextBundleSelection(selection, nodeId, frame, refs, additive, userKeys)
          if (next !== selection) onSelect(next)
          onSeek(frame)
          if (!readOnly && !additive) drag.begin(e, selectedTimelineDragItems(next, userKeys, fcurves))
        }}
        onPointerMove={muted || readOnly ? undefined : drag.move}
        onPointerUp={muted || readOnly ? undefined : drag.end}
        onPointerCancel={muted || readOnly ? undefined : drag.cancel}
        onDoubleClick={(e) => { e.stopPropagation(); onSelect(nextTimelineKeySelection(selection, refs, curves, false, userKeys, fcurves)); onSeek(frame) }}
        onContextMenu={(e) => openKeyMenu(e, nodeId, frame, refs, curves, selected)}
      />
    )
    return muted && mutedHint ? <Tooltip key={`agg-${nodeId}-${frame}`} label={mutedHint} side="top" delay={120}>{diamond}</Tooltip> : diamond
  })
}
