import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { createFrameSnapshot, evaluateFrame } from '@topview/3d-builder/evaluate'
import { projectEvaluationScene } from './unifiedSkeletonEvaluation'

/** evaluateFrame returns local TRS; resolve the same XYZ parent hierarchy used by scene GLB export. */
export function filmSceneWorldMatrices(project: UnifiedProject, sourceFrame: number) {
  const snapshot = createFrameSnapshot()
  evaluateFrame(projectEvaluationScene(project), sourceFrame, snapshot)
  const matrices = new Map<string, Matrix4>(), visiting = new Set<string>()
  const worldMatrix = (nodeId: string): Matrix4 => {
    const cached = matrices.get(nodeId)
    if (cached) return cached
    const node = project.scene.content.nodes.find((item) => item.id === nodeId)
    const transform = snapshot.transforms.get(nodeId)
    if (!node || !transform || visiting.has(nodeId)) throw new TypeError('Backdrop has missing or cyclic evaluated parent transforms')
    visiting.add(nodeId)
    const { position, rotation, scale } = transform, radians = Math.PI / 180
    // Same local Euler convention and parent composition as the scene GLB/runtime world hierarchy.
    const local = new Matrix4().compose(new Vector3(position.x, position.y, position.z),
      new Quaternion().setFromEuler(new Euler(rotation.x * radians, rotation.y * radians, rotation.z * radians, 'XYZ')),
      new Vector3(scale.x, scale.y, scale.z))
    const world = node.parentId ? worldMatrix(node.parentId).clone().multiply(local) : local
    visiting.delete(nodeId); matrices.set(nodeId, world)
    return world
  }
  return worldMatrix
}
