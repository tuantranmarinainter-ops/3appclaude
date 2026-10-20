import {
  resetFrameSnapshot,
  type FrameSnapshot,
  type SceneContract,
} from './FrameSnapshot'
import {
  evaluateCameras,
  evaluateCharacters,
  evaluatePaths,
  evaluateStaticNodes,
  evaluateUserKeys,
  indexSceneNodes,
} from './evaluateSteps'

export type { FrameSnapshot, SceneContract } from './FrameSnapshot'
export { createFrameSnapshot, prepareFrameSnapshot } from './FrameSnapshot'

export function evaluateFrame(
  scene: SceneContract,
  frame: number,
  out: FrameSnapshot,
): void {
  resetFrameSnapshot(out)
  out.frame = frame
  if (scene.exportSampleBoundary) out.sampleBoundary = scene.exportSampleBoundary
  else delete out.sampleBoundary
  indexSceneNodes(scene.nodes)
  evaluateCharacters(scene, frame, out)
  evaluateStaticNodes(scene, frame, out)
  evaluatePaths(scene, frame, out)
  evaluateUserKeys(scene, frame, out)
  scene.resolveEffectiveWorldSubjects?.(out)
  evaluateCameras(scene, frame, out)
}
