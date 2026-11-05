import type { TrackProp, UserKeys } from '../../../evaluate/curves/KeyframeTrack'
import type { FCurveSet } from '../../../evaluate/curves/FCurveSet'
import { buildNodeSelection, nodeIdsOf, toggleNodeIds } from '../../../stores/nodeSelection'
import type { Selection } from '../../../stores/types'
import { FC_PROP_PATH } from '../constants'

/**
 * Bấm tên dòng timeline: thường thì chọn riêng node đó; Ctrl/Cmd/Shift + bấm thì thêm/bỏ node khỏi nhóm đang chọn
 * (chọn nhiều dòng tuỳ ý). Bỏ node cuối cùng thì giữ lại chính nó để luôn có một lựa chọn.
 */
export function nextRowSelection(current: Selection | null, nodeId: string, additive: boolean): Selection {
  const single: Selection = { kind: 'node', nodeId }
  if (!additive || current?.kind !== 'node') return single
  const ids = toggleNodeIds(nodeIdsOf(current), current.nodeId, nodeId)
  return buildNodeSelection(ids) ?? single
}

export function box(frameStart: number, pxPerFrame: number, start: number, end: number) {
  return {
    left: (start - frameStart) * pxPerFrame,
    width: Math.max(3, (end - start) * pxPerFrame),
  }
}

/** Collapse component frames that represent the same timeline key. */
export function mergeKeyFrames(frames: number[]): number[] {
  const merged: number[] = []
  for (const frame of [...frames].sort((a, b) => a - b)) {
    if (!merged.length || frame - merged[merged.length - 1] > 1e-6) merged.push(frame)
  }
  return merged
}

export function fcurveFrames(fcurves: FCurveSet | null, nodeId: string, prop: TrackProp): number[] {
  if (!fcurves) return []
  const propPath = FC_PROP_PATH[prop]
  const frames = new Set<number>()
  for (let i = 0; i < 3; i++) {
    for (const k of fcurves.keyframesForTrack(nodeId, propPath, i)) frames.add(k.frame)
  }
  return mergeKeyFrames([...frames])
}

export function transformKeyframeFrames(
  userKeys: UserKeys,
  fcurves: FCurveSet | null,
  nodeId: string,
  props: TrackProp[],
): number[] {
  const frames = new Set<number>()
  for (const prop of props) {
    for (const k of userKeys[nodeId]?.[prop] ?? []) frames.add(k.frame)
    for (const f of fcurveFrames(fcurves, nodeId, prop)) frames.add(f)
  }
  return mergeKeyFrames([...frames])
}

export function isAdditiveMod(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.shiftKey || e.metaKey || e.ctrlKey
}
