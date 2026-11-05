import type { FCurveSet, FcurveKeyRef } from '../../../evaluate/curves/FCurveSet'
import type { TrackProp, UserKeys } from '../../../evaluate/curves/KeyframeTrack'
import { clipRefsOf, fcurveRefsOf, keyframeRefsOf, makeTimelineBoxSelection, type KeyframeRef, type Selection } from '../../../stores/types'
import { FC_PROP_PATH } from '../constants'
import { fcurveFrames } from './trackRow'
import { selectedKeyframeDragItems, userKeyRefsAtFrame, type KeyframeDragItem } from '../utils'

export const fcurveToken = (ref: FcurveKeyRef): string => `fcurve:${JSON.stringify([ref.nodeId, ref.propPath, ref.frame])}`
export const sameFcurve = (a: FcurveKeyRef, b: FcurveKeyRef): boolean =>
  a.nodeId === b.nodeId && a.propPath === b.propPath && Math.abs(a.frame - b.frame) <= 1e-6

export function fcurveRefsAtFrame(fc: FCurveSet | null, nodeId: string, props: TrackProp[], frame: number): FcurveKeyRef[] {
  return props.flatMap((prop) => {
    const canonical = fcurveFrames(fc, nodeId, prop).find((candidate) => Math.abs(candidate - frame) <= 1e-6)
    return canonical === undefined ? [] : [{ nodeId, propPath: FC_PROP_PATH[prop], frame: canonical }]
  })
}

export function selectedTimelineRefs(selection: Selection | null, userKeys: UserKeys, fc: FCurveSet | null): { keys: KeyframeRef[]; curves: FcurveKeyRef[] } {
  if (selection?.kind === 'transformKeyframe') {
    return { keys: userKeyRefsAtFrame(userKeys, selection.nodeId, selection.frame), curves: fcurveRefsAtFrame(fc, selection.nodeId, ['position', 'rotation', 'scale', 'lookAt', 'fov'], selection.frame) }
  }
  return { keys: keyframeRefsOf(selection), curves: fcurveRefsOf(selection) }
}

export function nextTimelineKeySelection(current: Selection | null, keys: KeyframeRef[], curves: FcurveKeyRef[], additive: boolean, userKeys: UserKeys, fc: FCurveSet | null): Selection | null {
  const existing = selectedTimelineRefs(current, userKeys, fc)
  const hasKey = (ref: KeyframeRef) => existing.keys.some((item) => item.nodeId === ref.nodeId && item.prop === ref.prop && item.keyId === ref.keyId)
  const hasCurve = (ref: FcurveKeyRef) => existing.curves.some((item) => sameFcurve(item, ref))
  const all = keys.every(hasKey) && curves.every(hasCurve) && keys.length + curves.length > 0
  if (!additive) return all ? current : makeTimelineBoxSelection([], keys, curves)
  const nextKeys = all ? existing.keys.filter((item) => !keys.some((ref) => ref.nodeId === item.nodeId && ref.prop === item.prop && ref.keyId === item.keyId)) : [...existing.keys, ...keys.filter((ref) => !hasKey(ref))]
  const nextCurves = all ? existing.curves.filter((item) => !curves.some((ref) => sameFcurve(ref, item))) : [...existing.curves, ...curves.filter((ref) => !hasCurve(ref))]
  return makeTimelineBoxSelection(clipRefsOf(current), nextKeys, nextCurves)
}

/** A context click on a selected part of a visible bundle preserves the group
 * and includes the other keys represented by that same diamond. */
export function contextTimelineKeySelection(current: Selection | null, keys: KeyframeRef[], curves: FcurveKeyRef[], highlighted: boolean, userKeys: UserKeys, fc: FCurveSet | null): Selection | null {
  const existing = selectedTimelineRefs(current, userKeys, fc)
  const hasKey = (ref: KeyframeRef) => existing.keys.some((item) => item.nodeId === ref.nodeId && item.prop === ref.prop && item.keyId === ref.keyId)
  const hasCurve = (ref: FcurveKeyRef) => existing.curves.some((item) => sameFcurve(item, ref))
  if (!highlighted) return makeTimelineBoxSelection([], keys, curves)
  return makeTimelineBoxSelection(clipRefsOf(current), [...existing.keys, ...keys.filter((ref) => !hasKey(ref))], [...existing.curves, ...curves.filter((ref) => !hasCurve(ref))])
}

export function selectedTimelineDragItems(selection: Selection | null, userKeys: UserKeys, fc: FCurveSet | null): KeyframeDragItem[] {
  const refs = selectedTimelineRefs(selection, userKeys, fc)
  const base = selection?.kind === 'transformKeyframe' ? selectedKeyframeDragItems(selection, userKeys) : refs.keys.flatMap((ref) => {
    const frame = userKeys[ref.nodeId]?.[ref.prop]?.find((key) => key.id === ref.keyId)?.frame
    return frame == null ? [] : [{ ...ref, origFrame: frame }]
  })
  const curves = refs.curves.flatMap((ref) => {
    const frames = (fc?.tracksForNode(ref.nodeId) ?? []).filter((track) => track.propPath === ref.propPath)
      .flatMap((track) => track.keys.filter((key) => Math.abs(key.frame - ref.frame) <= 1e-6).map((key) => key.frame))
    return frames.length ? [{ nodeId: ref.nodeId, prop: 'position' as const, keyId: fcurveToken(ref), origFrame: ref.frame, minFrame: Math.min(...frames), maxFrame: Math.max(...frames), fcurve: ref }] : []
  })
  return [...base, ...curves]
}
