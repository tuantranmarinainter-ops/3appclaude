import type { DirectorDocument } from '../contract/types'
import { FCurveSet } from '../evaluate/curves/FCurveSet'
import { rederiveWalkPaths } from '../evaluate/path/deriveWalk'
import { applyFcurveDelta, duplicateNodes, type TransformDelta } from './duplicateNodes'

export interface DuplicateDocumentNodesInput {
  document: DirectorDocument
  fcurves: unknown
  selectedIds: readonly string[]
  delta?: TransformDelta
}

export function duplicateDocumentNodes(input: DuplicateDocumentNodesInput) {
  const originalNodeIds = new Set(input.document.content.nodes.map((node) => node.id))
  const userKeys = FCurveSet.parseUserKeys(input.fcurves)
  const fcurves = input.fcurves == null ? FCurveSet.empty() : FCurveSet.parse(input.fcurves)
  const duplicated = duplicateNodes({ document: input.document, selectedIds: input.selectedIds, userKeys, delta: input.delta })
  for (const plan of duplicated.fcurveCopies) fcurves.copyNode(plan.fromId, plan.toId, (key, curve) => applyFcurveDelta(key, curve, input.delta ?? {}))
  for (const id of duplicated.rederiveIds) rederiveWalkPaths(duplicated.document, id, fcurves, duplicated.userKeys)
  return {
    document: duplicated.document,
    fcurves: FCurveSet.persist(fcurves, duplicated.userKeys),
    nodeIdMap: Object.fromEntries(duplicated.idMap),
    clipIdMap: Object.fromEntries(duplicated.clipIdMap),
    newNodeIds: duplicated.document.content.nodes.filter((node) => !originalNodeIds.has(node.id)).map((node) => node.id),
    topLevelNewIds: duplicated.topLevelNewIds,
  }
}
