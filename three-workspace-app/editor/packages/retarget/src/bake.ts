import type { MixamoPoseBone, RetargetedBone, ReverseRetargetSettings } from './reverse'
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'

export interface RetargetBakeRange {
  startFrame: number
  endFrame: number
  fps: 15 | 24 | 30
}

export interface RetargetBakeFrame {
  frame: number
  timeSeconds: number
  bones: RetargetedBone[]
}

export interface ReverseRetargetSolver {
  evaluate(sourceBones: readonly MixamoPoseBone[], settings?: Partial<ReverseRetargetSettings>): RetargetedBone[]
}

const MAX_BAKE_FRAMES = 18_000

/** Samples a source pose on each inclusive target frame and applies the existing V9.12 reverse solver. */
export function bakeReverseRetargetFrames(
  solver: ReverseRetargetSolver,
  sampleSource: (timeSeconds: number) => readonly MixamoPoseBone[],
  range: RetargetBakeRange,
  settings: Partial<ReverseRetargetSettings> = {},
): RetargetBakeFrame[] {
  if (!solver || typeof solver.evaluate !== 'function' || typeof sampleSource !== 'function' || !range || typeof range !== 'object') throw new TypeError('Retarget bake requires a solver, source sampler, and frame range')
  if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.startFrame < 0 || range.endFrame < range.startFrame ||
      ![15, 24, 30].includes(range.fps)) throw new RangeError('Retarget bake requires a valid inclusive frame range and 15, 24, or 30 fps')
  const frameCount = range.endFrame - range.startFrame + 1
  if (frameCount > MAX_BAKE_FRAMES) throw new RangeError(`Retarget bake is limited to ${MAX_BAKE_FRAMES} frames`)

  const frames: RetargetBakeFrame[] = []
  for (let frame = range.startFrame; frame <= range.endFrame; frame += 1) {
    const timeSeconds = frame / range.fps
    const bones = solver.evaluate(sampleSource(timeSeconds), settings)
    if (!bones.length || bones.some((bone) => ![...bone.position, ...bone.rotation, ...bone.scale, ...bone.worldMatrix].every(Number.isFinite))) {
      throw new TypeError(`Retarget solver returned an invalid pose at frame ${frame}`)
    }
    frames.push({ frame, timeSeconds, bones })
  }
  return frames
}

export function retargetFramesToAnimationClip(frames: readonly RetargetBakeFrame[], name = 'Retargeted motion'): AnimationClip {
  if (!frames.length) throw new TypeError('Retarget clip requires at least one sampled frame')
  const first = frames[0]!
  const names = first.bones.map((bone) => bone.name)
  if (!names.length || new Set(names).size !== names.length) throw new TypeError('Retarget clip contains missing or duplicate target bones')
  const start = first.timeSeconds
  const times = frames.map((frame) => {
    if (!Number.isFinite(frame.timeSeconds) || frame.timeSeconds < start || frame.bones.length !== names.length ||
        frame.bones.some((bone, index) => bone.name !== names[index] || ![...bone.position, ...bone.rotation, ...bone.scale].every(Number.isFinite))) {
      throw new TypeError('Retarget frames must have matching bones and finite, increasing sample times')
    }
    return frame.timeSeconds - start
  })
  if (times.some((time, index) => index > 0 && time <= times[index - 1]!)) throw new TypeError('Retarget frame times must increase')
  const tracks = names.flatMap((name, boneIndex) => {
    const values = (key: 'position' | 'rotation' | 'scale') => frames.flatMap((frame) => [...frame.bones[boneIndex]![key]])
    return [
      new VectorKeyframeTrack(`${name}.position`, times, values('position')),
      new QuaternionKeyframeTrack(`${name}.quaternion`, times, values('rotation')),
      new VectorKeyframeTrack(`${name}.scale`, times, values('scale')),
    ]
  })
  return new AnimationClip(name, times[times.length - 1] ?? 0, tracks)
}
