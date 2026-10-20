import { Matrix4, Vector3 } from 'three'
import type { RetargetPoseBone, RetargetRig } from '../src/universal.ts'
import { finalizeMapping, type AutoMapping, type MappedJoint } from './autoMapping.ts'

export type SwapSidesMode = 'auto' | 'on' | 'off'

interface SampleableRig {
  rig: RetargetRig
  actions: ReadonlyArray<{ index: number; durationSeconds: number; ready: boolean }>
  sample(actionIndex: number, timeSeconds: number): RetargetPoseBone[]
}

const SAMPLES_PER_ACTION = 48, MAX_ACTIONS = 150
/**
 * Stepping must amount to at least one hips height before it may re-orient the rest pose: dance steps slide feet too
 * (Mixamo Samba/Michelle give 0.3–0.4 m), while LoL Lux gives 2.3 m ≈ 3.4 hips heights at agreement −0.99.
 */
const MIN_EVIDENCE_HIPS_RATIO = 1
const AGREE = 0.7

const at = (world: readonly number[]) => new Vector3(world[12], world[13], world[14])
const yawDegrees = (from: Vector3, to: Vector3) => Math.atan2(from.z * to.x - from.x * to.z, from.x * to.x + from.z * to.z) * 180 / Math.PI || 0

/** Left↔Right exchange of every mapped joint (`LeftArm` takes what `RightArm` had, and vice versa). */
export function swapMappingSides<T extends AutoMapping>(mapping: T): T {
  const byTarget = new Map(mapping.joints.map((joint) => [joint.target, joint]))
  const joints = mapping.joints.map((joint): MappedJoint => {
    const mirror = /^Left/.test(joint.target) ? byTarget.get(joint.target.replace(/^Left/, 'Right'))
      : /^Right/.test(joint.target) ? byTarget.get(joint.target.replace(/^Right/, 'Left')) : undefined
    if (!mirror) return joint
    return { target: joint.target, targetId: joint.targetId, source: mirror.source, sourceId: mirror.sourceId, via: mirror.via ? `${mirror.via}+swap` : null,
      ...(mirror.ambiguous ? { ambiguous: true } : {}) }
  })
  const { joints: _joints, pairs: _pairs, missingRequired: _missing, requiredTargetIds: _required, notInSourceRig: _absent, ...rest } = mapping
  return { ...rest, ...finalizeMapping(mapping.family, joints) } as T
}

/**
 * Three independent facing cues of the source:
 * - names: mapped left-hip→right-hip × up on the rest pose (what calibration uses);
 * - toes: foot→toe on the rest pose — anatomy, independent of the names;
 * - motion: steps — a planted foot slides backwards relative to the hips (in-place and root-motion walks alike),
 *   summed over Actions. Hips travel alone is not used: deaths and knock-backs move the hips any way.
 */
export function measureFacingCues(source: SampleableRig, mapping: AutoMapping) {
  const id = (name: string) => mapping.joints.find((joint) => joint.target === name)?.sourceId ?? null
  const bone = (boneId: string) => source.rig.bones.find((item) => item.id === boneId)!
  const hips = id('Hips'), leftUpLeg = id('LeftUpLeg'), rightUpLeg = id('RightUpLeg')
  // Only real feet touch the ground; a shin's head is the knee (Minecraft20 has no foot), which would fake "contacts".
  const feet = [id('LeftFoot'), id('RightFoot')].filter((value): value is string => !!value)
  if (!hips || !leftUpLeg || !rightUpLeg) return { names: null, toes: null, motion: null, evidenceMeters: 0 }
  const names = new Vector3().crossVectors(at(bone(leftUpLeg).restWorld).sub(at(bone(rightUpLeg).restWorld)).setY(0), new Vector3(0, 1, 0)).normalize()
  const toeVector = new Vector3()
  for (const side of ['Left', 'Right']) {
    const foot = id(`${side}Foot`), toe = id(`${side}ToeBase`)
    if (foot && toe) toeVector.add(at(bone(toe).restWorld).sub(at(bone(foot).restWorld)).setY(0))
  }
  const toes = toeVector.lengthSq() > 1e-8 ? toeVector.normalize() : null
  if (feet.length < 2) return { names, toes, motion: null, evidenceMeters: 0 }
  const hipsHeight = Math.max(1e-6, at(bone(hips).restWorld).y - Math.min(...feet.map((foot) => at(bone(foot).restWorld).y)))

  const total = new Vector3()
  const usable = source.actions.filter((action) => action.ready && action.durationSeconds > 0).slice(0, MAX_ACTIONS)
  for (const action of usable) {
    let poses: Array<Map<string, Vector3>>
    try {
      poses = Array.from({ length: SAMPLES_PER_ACTION }, (_, index) => new Map(source.sample(action.index, action.durationSeconds * index / (SAMPLES_PER_ACTION - 1))
        .filter((item) => item.id === hips || feet.includes(item.id)).map((item) => [item.id, at(item.world)])))
    } catch { continue }
    for (const foot of feet) {
      // Heel→toe roll lifts a planted foot a few cm, so the band is not tighter than 4 cm.
      const ground = Math.min(...poses.map((pose) => pose.get(foot)!.y)), band = Math.max(0.04, 0.06 * hipsHeight)
      for (let index = 1; index < poses.length; index++) {
        const was = poses[index - 1]!, now = poses[index]!
        if (now.get(foot)!.y - ground > band || was.get(foot)!.y - ground > band) continue
        const relativeNow = now.get(foot)!.clone().sub(now.get(hips)!), relativeWas = was.get(foot)!.clone().sub(was.get(hips)!)
        total.sub(relativeNow.sub(relativeWas).setY(0)) // foot backwards relative to hips = body forwards
      }
    }
  }
  const evidenceMeters = total.length()
  return { names, toes, motion: evidenceMeters >= MIN_EVIDENCE_HIPS_RATIO * hipsHeight ? total.normalize() : null, evidenceMeters }
}

/**
 * Side and rest-facing policy, decided from the cues above:
 * - **Mirrored names** (`L_` bones on the anatomical right): the rest toes contradict the names. `auto` swaps
 *   Left↔Right; `on`/`off` force it. A user-confirmed preset is never swapped automatically.
 * - **Rest/animation facing mismatch** (LoL Lux: rest pose faces −Z while every Action faces +Z, i.e. the root is
 *   turned 180° in the clips): the steps contradict the (possibly swapped) names. The world-delta solver would copy that
 *   turn onto the target, so the source reference pose is turned about the hips' vertical axis to face like the Actions
 *   (`restTurnDegrees`, quarter turns snapped within 15°). The hips stay in place, so root travel is unchanged.
 */
export function resolveSides<T extends AutoMapping>(source: SampleableRig, mapping: T, mode: SwapSidesMode, fromPreset: boolean) {
  const cues = measureFacingCues(source, mapping)
  const toesVsNames = cues.names && cues.toes ? cues.toes.dot(cues.names) : null
  const mirrored = toesVsNames !== null && toesVsNames <= -0.5
  const swapped = mode === 'on' || (mode === 'auto' && mirrored && !fromPreset)
  const names = cues.names && swapped ? cues.names.clone().negate() : cues.names
  const motionVsNames = names && cues.motion ? names.dot(cues.motion) : null
  let restTurnDegrees = 0
  if (names && cues.motion && motionVsNames! < AGREE) {
    const yaw = yawDegrees(names, cues.motion), quarter = Math.round(yaw / 90) * 90
    const turn = Math.abs(yaw - quarter) <= 15 ? quarter : yaw
    restTurnDegrees = Math.abs(turn) < 45 ? 0 : ((turn + 540) % 360) - 180 || 0
    if (restTurnDegrees === -180) restTurnDegrees = 180
  }
  const warnings: Array<{ code: string; message: string; suggestion?: string }> = []
  if (mirrored) warnings.push({ code: 'SIDES_MIRRORED', message: `Left/Right bone names contradict the rest toes (agreement ${toesVsNames!.toFixed(2)})`,
    ...(swapped ? {} : { suggestion: fromPreset ? 'The confirmed preset was kept; re-check its Left/Right rows or pass --swap-sides on' : 'Pass --swap-sides on to mirror the mapping' }) })
  if (restTurnDegrees) warnings.push({ code: 'REST_FACING_TURNED', message: `The Actions face ${restTurnDegrees}° away from the rest pose (steps over ${cues.evidenceMeters.toFixed(2)} m, agreement ${motionVsNames!.toFixed(2)}); the source reference was turned to match` })
  return {
    mapping: swapped ? swapMappingSides(mapping) : mapping, restTurnDegrees,
    report: { mode, mirrored, swapped, restTurnDegrees, evidence: cues.motion ? 'motion' as const : 'insufficient' as const, evidenceMeters: cues.evidenceMeters,
      agreement: motionVsNames, toesAgreement: toesVsNames, warnings },
  }
}

/** The rest pose turned about the vertical axis through the hips (used as the solver's source reference). */
export function turnRig(rig: RetargetRig, hipsId: string, degrees: number): RetargetRig {
  if (!degrees) return rig
  const pivot = at(rig.bones.find((bone) => bone.id === hipsId)!.restWorld)
  const turn = new Matrix4().makeTranslation(pivot.x, 0, pivot.z).multiply(new Matrix4().makeRotationY(degrees * Math.PI / 180)).multiply(new Matrix4().makeTranslation(-pivot.x, 0, -pivot.z))
  return { ...rig, bones: rig.bones.map((bone) => ({ ...bone, restWorld: turn.clone().multiply(new Matrix4().fromArray(bone.restWorld)).toArray() })) }
}
