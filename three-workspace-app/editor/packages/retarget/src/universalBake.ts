import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
import type { RetargetPoseBone, UniversalRetargetFrame } from './universal'

export interface UniversalBakeRange { startFrame: number; endFrame: number; fps: number }
export interface UniversalBakeFrame { frame: number; timeSeconds: number; bones: UniversalRetargetFrame[] }
export interface UniversalRetargetSolver { evaluate(sample: readonly RetargetPoseBone[]): UniversalRetargetFrame[] }

export const MAX_UNIVERSAL_BAKE_FRAMES = 18_000
export const MAX_UNIVERSAL_BAKE_NODE_SAMPLES = 50_000_000
export const MAX_UNIVERSAL_BAKE_ESTIMATED_BYTES = 768 * 1024 * 1024

export function estimateUniversalBakeCost(sourceBoneCount: number, targetBoneCount: number, sampleCount: number) {
  if (![sourceBoneCount, targetBoneCount, sampleCount].every(Number.isSafeInteger) || sourceBoneCount < 0 || targetBoneCount < 1 || sampleCount < 1) {
    throw new RangeError('Bake cost requires nonnegative bone counts and a positive integer sample count')
  }
  const nodeSamples = (sourceBoneCount + targetBoneCount) * sampleCount
  // shortcut: 512 bytes per retained target pose is a conservative estimate; replace it with profiled peak memory if valid rigs approach this guard.
  const estimatedPeakBytes = sourceBoneCount * 256 + targetBoneCount * 256 + sampleCount * targetBoneCount * 512
  return { nodeSamples, estimatedPeakBytes, maxNodeSamples: MAX_UNIVERSAL_BAKE_NODE_SAMPLES,
    maxEstimatedBytes: MAX_UNIVERSAL_BAKE_ESTIMATED_BYTES,
    withinBudget: nodeSamples <= MAX_UNIVERSAL_BAKE_NODE_SAMPLES && estimatedPeakBytes <= MAX_UNIVERSAL_BAKE_ESTIMATED_BYTES }
}

export function bakeUniversalRetargetFrames(
  solver: UniversalRetargetSolver,
  sampleSource: (timeSeconds: number) => readonly RetargetPoseBone[],
  range: UniversalBakeRange,
): UniversalBakeFrame[] {
  if (!solver || typeof solver.evaluate !== 'function' || typeof sampleSource !== 'function' || !range || typeof range !== 'object') throw new TypeError('Universal bake requires a solver, source sampler, and frame range')
  if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.startFrame < 0 || range.endFrame < range.startFrame ||
      !Number.isFinite(range.fps) || range.fps <= 0 || range.fps > 240) throw new RangeError('Universal bake requires a valid frame range and FPS in (0, 240]')
  const frameCount = range.endFrame - range.startFrame + 1
  if (frameCount > MAX_UNIVERSAL_BAKE_FRAMES) throw new RangeError(`Universal bake is limited to ${MAX_UNIVERSAL_BAKE_FRAMES} frames`)
  const frames: UniversalBakeFrame[] = []
  for (let frame = range.startFrame; frame <= range.endFrame; frame += 1) {
    const bones = solver.evaluate(sampleSource(frame / range.fps))
    if (!bones.length || bones.some((bone) => ![...bone.position, ...bone.rotation, ...bone.scale, ...bone.world].every(Number.isFinite))) throw new TypeError(`Universal solver returned an invalid pose at frame ${frame}`)
    frames.push({ frame, timeSeconds: frame / range.fps, bones })
  }
  return frames
}

export function universalFramesToAnimationClip(frames: readonly UniversalBakeFrame[], name = 'Normalized motion'): AnimationClip {
  if (!frames.length) throw new TypeError('Universal clip requires sampled frames')
  const first = frames[0]!
  const bones = first.bones.map(({ targetBoneId, targetBoneName }) => ({ targetBoneId, targetBoneName }))
  if (!bones.length || new Set(bones.map((bone) => bone.targetBoneId)).size !== bones.length || new Set(bones.map((bone) => bone.targetBoneName)).size !== bones.length) throw new TypeError('Target rig has missing or duplicate bone identities/names')
  const start = first.timeSeconds
  const times = frames.map((frame) => {
    if (!Number.isFinite(frame.timeSeconds) || frame.timeSeconds < start || frame.bones.length !== bones.length || frame.bones.some((bone, index) => {
      const identity = bones[index]!
      return bone.targetBoneId !== identity.targetBoneId || bone.targetBoneName !== identity.targetBoneName || ![...bone.position, ...bone.rotation, ...bone.scale].every(Number.isFinite)
    })) throw new TypeError('Universal frames must have matching target bones and finite transforms')
    return frame.timeSeconds - start
  })
  if (times.some((time, index) => index > 0 && time <= times[index - 1]!)) throw new TypeError('Universal frame times must increase')
  const tracks = bones.flatMap(({ targetBoneName }, index) => {
    const values = (key: 'position' | 'rotation' | 'scale') => frames.flatMap((frame) => [...frame.bones[index]![key]])
    return [new VectorKeyframeTrack(`${targetBoneName}.position`, times, values('position')),
      new QuaternionKeyframeTrack(`${targetBoneName}.quaternion`, times, values('rotation')),
      new VectorKeyframeTrack(`${targetBoneName}.scale`, times, values('scale'))]
  })
  return new AnimationClip(name, times[times.length - 1] ?? 0, tracks)
}
