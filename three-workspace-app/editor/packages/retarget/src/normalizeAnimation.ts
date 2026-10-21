import { lockFeet, type FootLockMode } from './footLock'
import type { Object3D } from 'three'
import { createThreeRigAdapter, type ThreeRigAdapterOptions } from './threeRigAdapter'
import { createUniversalRetargeter, validateUniversalMapping, type RetargetBonePair } from './universal'
import { universalFramesToGlb } from './universalGlb'
import { estimateUniversalBakeCost } from './universalBake'
import type { UniversalBakeFrame } from './universalBake'
import { adjustGround, type GroundMode } from './groundAdjust'
import { applyFootDirection, planFootDirection } from './footDirection'
import { applyFingerCurl, DISTAL_FROM_MIDDLE, planFingerCurl } from './fingerCurl'
import { createNormalizationMetrics } from './normalizationMetrics'
import type { UniversalCalibrationRuntime } from './universalCalibration'

export interface NormalizeAnimationInput {
  source: Object3D
  target: Object3D
  sourceOptions: ThreeRigAdapterOptions
  targetOptions: ThreeRigAdapterOptions
  pairs: readonly RetargetBonePair[]
  excludedSourceBones?: readonly { sourceBoneId: string; name: string; reason: string }[]
  range?: readonly [number, number]
  actionIndex: number
  fps: number
  rootTranslationScale?: number
  /** Vertical foot-floor fix (default 'off' here; the CLI/Workbench pass their own default). */
  footLock?: FootLockMode
  groundMode?: GroundMode
  /** Feet follow the source ankle→ball direction instead of its rotation delta (see footDirection.ts). */
  footDirection?: boolean
  rootTranslationPolicy?: 'preserve' | 'in-place'
  calibration?: UniversalCalibrationRuntime
  requiredTargetJointIds?: readonly string[]
}

/** Produces a staged derivative; the host must validate revision and commit it through shared history. */
export async function normalizeAnimation(input: NormalizeAnimationInput, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!Number.isFinite(input.fps) || input.fps < 1 || input.fps > 240) throw new RangeError('Normalization FPS must be in [1, 240]')
  const source = createThreeRigAdapter(input.source, input.sourceOptions)
  let target: ReturnType<typeof createThreeRigAdapter> | undefined
  try {
    target = createThreeRigAdapter(input.target, input.targetOptions)
    const action = source.actions[input.actionIndex]
    if (!Number.isInteger(input.actionIndex) || !action || !(action.durationSeconds > 0)) throw new TypeError('Select an existing source action with positive duration')
    const report = validateUniversalMapping(source.rig, target.rig, input.pairs, input.requiredTargetJointIds)
    if (report.errors.length || report.missingRequiredTargetBoneIds.length) throw new TypeError('Resolve invalid or missing required target mappings before normalization')
    const [start, end] = input.range ?? [0, action.durationSeconds]
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > action.durationSeconds + 1e-6) throw new RangeError('Action range must satisfy 0 <= start < end <= duration')
    const duration = end - start
    const steps = Math.ceil(duration * input.fps)
    if (steps + 1 > 18_000) throw new RangeError('Normalization exceeds the 18000-sample budget; shorten the clip or lower FPS')
    const resourceCost = estimateUniversalBakeCost(source.rig.bones.length, target.rig.bones.length, steps + 1)
    if (!resourceCost.withinBudget) throw new RangeError('Normalization exceeds the node-sample or estimated-memory budget; shorten the clip, lower FPS, or inspect a smaller rig')
    const solver = createUniversalRetargeter(source.rig, target.rig, input.pairs, input.rootTranslationScale, input.rootTranslationPolicy, input.calibration)
    const frames: UniversalBakeFrame[] = []
    const feet = input.footDirection ? planFootDirection(source.rig, target.rig, input.pairs, input.calibration) : []
    const fingers = planFingerCurl(target.rig, input.pairs)
    const metrics = createNormalizationMetrics(source.rig, target.rig, input.pairs, input.rootTranslationPolicy ?? 'preserve', input.rootTranslationScale ?? 1)
    for (let index = 0; index <= steps; index++) {
      signal?.throwIfAborted()
      const timeSeconds = Math.min(index / input.fps, duration)
      const sample = source.sample(input.actionIndex, start + timeSeconds), bones = solver.evaluate(sample)
      applyFootDirection(feet, target.rig, sample, bones, input.calibration?.alignmentRotation)
      applyFingerCurl(fingers, target.rig, bones)
      metrics.observe(sample, bones)
      frames.push({ frame: index, timeSeconds, bones })
      if (index % 32 === 31) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    const ground = adjustGround(target.rig, frames, input.groundMode ?? 'off')
    const footLock = input.footLock === 'on' ? lockFeet(target.rig, frames) : undefined
    signal?.throwIfAborted()
    const bytes = universalFramesToGlb(target.rig, target.joints, frames, action.name)
    return { bytes, report: { ...report, sourceFingerprint: source.rig.fingerprint, targetFingerprint: target.rig.fingerprint,
      actionIndex: action.index, actionName: action.name, durationSeconds: duration, sampleFps: input.fps,
      sampleCount: frames.length, sourceJointCount: source.joints.length, targetJointCount: target.joints.length,
      resourceCost, ground, ...(footLock ? { footLock } : {}),
      fingerCurl: { distalFromMiddle: DISTAL_FROM_MIDDLE, fingers: fingers.map((plan) => plan.finger) },
      excludedSourceBones: input.excludedSourceBones ?? [], metrics: metrics.report(),
      rootTranslationScale: input.rootTranslationScale ?? 1, rootTranslationPolicy: input.rootTranslationPolicy ?? 'preserve', outputMode: 'animation-only' as const } }
  } finally { source.dispose(); target?.dispose() }
}
