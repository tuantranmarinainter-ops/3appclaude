import type { DirectorDocument } from '../contract/types'
import { createFrameSnapshot, evaluateFrame } from '../evaluate/evaluateFrame'
import { sceneFromDocument } from '../evaluate/sceneFromDocument'
import { FCurveSet, type FcurveKeyRef } from '../evaluate/curves/FCurveSet'
import { makeKeyframe, type UserKeys } from '../evaluate/curves/KeyframeTrack'
import type { KeyframeRef, Selection } from '../stores/types'
import { fcurveRefsOf, keyframeRefsOf } from '../stores/types'
import { cameraMotionOwnsKeyframes } from '../evaluate/camera/cameraMotionExclusive'
import { PerspectiveCamera, Vector3, MathUtils } from 'three'
import { applyEvaluatedCamera } from '../engine/objects/cameraTransform'

export type TransformProp = 'position' | 'rotation' | 'scale'
export type TransformClipboard = Record<TransformProp, number[]>
export type PasteTarget = { nodeId: string; frame: number }
export type TransformPastePlan = { userKeys: UserKeys; fcurves: FCurveSet | null; changed: boolean; skipped: number; positionNodes: string[] }
const props: TransformProp[] = ['position', 'rotation', 'scale']
const EPS = 1e-6
let clipboard: TransformClipboard | null = null
export function getTransformClipboard() { return clipboard }
export function copyTransform(doc: DirectorDocument, fc: FCurveSet | null, keys: UserKeys, nodeId: string, frame: number, enabled = true, chainCameraMotion = false): boolean {
  const out = createFrameSnapshot()
  evaluateFrame(sceneFromDocument(doc, { fcurves: fc, userKeys: keys, userKeysEnabled: enabled, chainCameraMotion }), frame, out)
  const value = out.transforms.get(nodeId)
  const node = doc.content.nodes.find((item) => item.id === nodeId)
  if (!value || !node) return false
  const rotation = { ...value.rotation }
  // Resolve the actual camera orientation with the same rules as the viewport.
  if (node.type === 'camera' && !value.useEuler && value.lookAt) {
    const camera = new PerspectiveCamera()
    applyEvaluatedCamera(camera, new Vector3(), value, node.transform.rotation)
    rotation.x = MathUtils.radToDeg(camera.rotation.x)
    rotation.y = MathUtils.radToDeg(camera.rotation.y)
    rotation.z = MathUtils.radToDeg(camera.rotation.z)
  }
  clipboard = { position: [value.position.x, value.position.y, value.position.z], rotation: [rotation.x, rotation.y, rotation.z], scale: [value.scale.x, value.scale.y, value.scale.z] }
  return true
}
export function selectedPasteTargets(selection: Selection | null, keys: UserKeys): PasteTarget[] {
  const targets: PasteTarget[] = []
  const add = (nodeId: string, frame: number) => {
    if (!targets.some((t) => t.nodeId === nodeId && Math.abs(t.frame - frame) <= EPS)) targets.push({ nodeId, frame })
  }
  if (selection?.kind === 'transformKeyframe') add(selection.nodeId, selection.frame)
  for (const ref of keyframeRefsOf(selection)) {
    const key = keys[ref.nodeId]?.[ref.prop]?.find((k) => k.id === ref.keyId)
    if (key) add(ref.nodeId, key.frame)
  }
  for (const ref of fcurveRefsOf(selection)) add(ref.nodeId, ref.frame)
  return targets
}
/** When user keys are disabled, every component must be represented by a
 * destination fcurve; otherwise the pasted value would not be visible.
 * Position is never pasted while user keys are off (user decision 2026-11-05): the derived walk path
 * is rebuilt from the layer being evaluated, so it would drift once user keys are turned back on. */
export function canPasteWithoutUserKeys(doc: DirectorDocument, fc: FCurveSet | null, targets: PasteTarget[], mask: TransformProp[]): boolean {
  return targets.every(({ nodeId, frame }) => {
    const node = doc.content.nodes.find((item) => item.id === nodeId)
    if (!node || node.locked || cameraMotionOwnsKeyframes(doc, nodeId)) return true
    if (mask.includes('position')) return false
    return mask.every((prop) => {
      if (node.type === 'camera' && prop === 'scale') return true
      const tracks = (fc?.tracksForNode(nodeId) ?? []).filter((track) => track.propPath === `transform.${prop}` && track.keys.some((key) => Math.abs(key.frame - frame) <= EPS))
      return [0, 1, 2].every((index) => tracks.some((track) => track.index === index))
    })
  })
}
export function buildTransformPastePlan(doc: DirectorDocument, fc: FCurveSet | null, keys: UserKeys, source: TransformClipboard, targets: PasteTarget[], mask: TransformProp[]): TransformPastePlan {
  const next: UserKeys = structuredClone(keys)
  const curves = fc ? FCurveSet.parse(structuredClone(fc.encode())) : null
  const positionNodes = new Set<string>()
  let skipped = 0, changed = false
  for (const target of targets) {
    const node = doc.content.nodes.find((item) => item.id === target.nodeId)
    if (!node || node.locked || cameraMotionOwnsKeyframes(doc, target.nodeId)) { skipped++; continue }
    for (const prop of mask) {
      if (node.type === 'camera' && prop === 'scale') continue
      const value = source[prop]
      const track = next[target.nodeId]?.[prop] ?? []
      const existing = track.filter((k) => Math.abs(k.frame - target.frame) <= EPS)
      const fcKeys = (curves?.tracksForNode(target.nodeId) ?? []).filter((t) => t.propPath === `transform.${prop}`).flatMap((t) => t.keys.filter((k) => Math.abs(k.frame - target.frame) <= EPS).map((k) => ({ key: k, index: t.index })))
      for (const key of existing) key.value = [...value]
      for (const entry of fcKeys) entry.key.value = value[entry.index] ?? entry.key.value
      // A user track can override the fcurve at this frame, and a sparse fcurve
      // cannot represent a complete vector. Add a user key to guarantee the pose.
      const sparseCurve = fcKeys.length > 0 && new Set(fcKeys.map((entry) => entry.index)).size < 3
      if (!existing.length && (!fcKeys.length || track.length > 0 || sparseCurve)) {
        next[target.nodeId] ??= {}
        next[target.nodeId][prop] = [...track, makeKeyframe(target.frame, [...value])].sort((a, b) => a.frame - b.frame)
      }
      if (prop === 'position') positionNodes.add(target.nodeId)
      changed = true
    }
  }
  return { userKeys: next, fcurves: curves, changed, skipped, positionNodes: [...positionNodes] }
}
export function keySelectionOnly(selection: Selection | null): { keys: KeyframeRef[]; fcurves: FcurveKeyRef[] } {
  return { keys: keyframeRefsOf(selection), fcurves: fcurveRefsOf(selection) }
}
