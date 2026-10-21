import { FCurveSet } from '@topview/3d-builder/evaluate'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'

const properties = ['position', 'rotation', 'scale'] as const
type Handle = { x: number; y: number }
type Curve = { t: ['node', string]; p: string; i: number; k: Array<[number, number, string, string, Handle?, Handle?]> }
type Placement = { nodeId: string; transform: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } } }

/** Only transform tracks belonging to this node can block a layout edit. */
export function constantPlacementKeys(project: UnifiedProject, nodeId: string) {
  const raw = project.extensions.topview?.fcurves
  const userKeys = FCurveSet.parseUserKeys(raw)
  const encoded = raw ? FCurveSet.parse(raw).encode() : FCurveSet.empty().encode()
  for (const prop of properties) {
    const keys = userKeys[nodeId]?.[prop] ?? []
    if (keys.some(key => key.value.length !== keys[0]!.value.length || key.value.some((value, index) => value !== keys[0]!.value[index]))) {
      throw new TypeError(`Dynamic placement keys on ${nodeId}.${prop}; layout edits require constant values`)
    }
  }
  for (const curve of encoded.fcurves as Curve[]) {
    if (curve.t[1] !== nodeId || !properties.some(prop => curve.p === `transform.${prop}`)) continue
    // Equal endpoints are insufficient: Bezier handles can move between them.
    if (curve.k.some(key => key[1] !== curve.k[0]?.[1] || [key[4], key[5]].some(handle => handle && handle.y !== key[1]))) {
      throw new TypeError(`Dynamic placement fcurve on ${nodeId}.${curve.p}; layout edits require constant values`)
    }
  }
  return { userKeys, encoded }
}

export function updateConstantPlacementKeys(project: UnifiedProject, placements: Placement[]) {
  if (!project.extensions.topview?.fcurves || !placements.length) return null
  const { userKeys, encoded } = constantPlacementKeys(project, placements[0]!.nodeId)
  let changed = false
  for (const placement of placements) {
    constantPlacementKeys(project, placement.nodeId)
    for (const prop of ['position', 'rotation'] as const) {
      const transform = placement.transform[prop], value = [transform.x, transform.y, transform.z]
      for (const key of userKeys[placement.nodeId]?.[prop] ?? []) {
        key.value = [...value]
        changed = true
      }
      for (const curve of encoded.fcurves as Curve[]) {
        if (curve.t[1] !== placement.nodeId || curve.p !== `transform.${prop}`) continue
        for (const key of curve.k) {
          const delta = value[curve.i]!-key[1]
          key[1] += delta
          for (const handle of [key[4], key[5]]) if (handle) handle.y += delta
          changed = true
        }
      }
    }
  }
  return changed ? FCurveSet.persist(FCurveSet.parse(encoded), userKeys) : null
}
