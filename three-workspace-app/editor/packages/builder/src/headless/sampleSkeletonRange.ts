import { createFrameSnapshot, evaluateFrame, type SceneContract, type FrameSnapshot } from '../evaluate/evaluateFrame'
import type { SkeletonFrameSample } from './skeletonEvaluator'

export interface SkeletonSampleRange {
  startFrame: number
  endFrame: number
  sampleFps: number
}

export interface SkeletonRangeSample {
  frame: number
  timeSeconds: number
  side: 'left' | 'right'
  skeletonSamples: SkeletonFrameSample[]
}

/** Inclusive editor range -> export grid plus one left-limit endpoint; caller owns the loaded evaluator. */
export function* sampleSkeletonRange(
  scene: SceneContract,
  range: SkeletonSampleRange,
  evaluate: (snapshot: FrameSnapshot) => SkeletonFrameSample[],
): Generator<SkeletonRangeSample> {
  const { startFrame, endFrame, sampleFps } = range
  const span = endFrame - startFrame + 1
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || !Number.isSafeInteger(endFrame + 1) || !Number.isSafeInteger(span) || span <= 0 ||
    startFrame < scene.meta.frameStart || endFrame > scene.meta.frameEnd || !Number.isFinite(scene.meta.fps) || scene.meta.fps <= 0 ||
    !Number.isFinite(sampleFps) || sampleFps <= 0) throw new RangeError('Invalid skeleton sample range or FPS')
  const duration = span / scene.meta.fps
  const count = Math.ceil(duration * sampleFps)
  if (!Number.isSafeInteger(count) || count <= 0 || !Number.isFinite(duration)) throw new RangeError('Skeleton sample count exceeds numerical precision')
  const snapshot = createFrameSnapshot()
  const interior = { ...scene, exportSampleBoundary: 'right' as const }
  for (let i = 0; i < count; i++) {
    const timeSeconds = i / sampleFps
    if (timeSeconds >= duration) break
    const frame = startFrame + timeSeconds * scene.meta.fps
    evaluateFrame(interior, frame, snapshot)
    yield { frame, timeSeconds, side: 'right', skeletonSamples: evaluate(snapshot) }
  }
  const frame = endFrame + 1
  evaluateFrame({ ...scene, exportSampleBoundary: 'left' }, frame, snapshot)
  yield { frame, timeSeconds: duration, side: 'left', skeletonSamples: evaluate(snapshot) }
}
