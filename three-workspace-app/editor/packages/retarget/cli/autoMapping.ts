import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { applyMixamo65MappingPreset } from '../src/mappingPreset.ts'
import type { MappingSkeleton } from '../src/mapping.ts'
import type { RetargetBonePair, RetargetRig } from '../src/universal.ts'

export type SourceFamily = 'mixamo' | 'ue' | 'cc' | 'lol' | 'wc3r' | 'wow' | 'unknown'
export interface MappedJoint { target: string; targetId: string; source: string | null; sourceId: string | null; via: string | null; ambiguous?: boolean }
export interface AutoMapping { family: SourceFamily; joints: MappedJoint[]; pairs: RetargetBonePair[]; missingRequired: string[]; requiredTargetIds: string[] }

/** Losing any of these blocks export (DECISIONS: "thiếu role chính"). */
export const MIXAMO65_REQUIRED_JOINTS = Object.freeze(['Hips', 'Spine', 'Head',
  ...['Left', 'Right'].flatMap((side) => ['Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot'].map((part) => `${side}${part}`))])

export function canonical(name: string): string {
  return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/^cc_?base_?/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const
/** [UE suffix form, CC prefix form, LoL prefix form]; LoL `KneeLower` sits on `KneeUpper` and carries the shin rotation. */
const LIMBS = { Shoulder: ['clavicle', 'clavicle', 'clavicle'], Arm: ['upperarm', 'upperarm', 'shoulder'], ForeArm: ['lowerarm', 'forearm', 'elbow'],
  Hand: ['hand', 'hand', 'hand'], UpLeg: ['thigh', 'thigh', 'hip'], Leg: ['calf', 'calf', 'kneelower'], Foot: ['foot', 'foot', 'foot'],
  ToeBase: ['ball', 'toebase', 'toe'] } as const

/**
 * Canonical alias per Mixamo joint; UE uses `name_l` suffixes, CC `CC_Base_L_Name`, LoL (lol2gltf) `L_Name` prefixes.
 * LoL `Root` is the hip-level parent of both `Spine1` and `Pelvis`, so it plays Mixamo `Hips`.
 */
function familyAliases(family: 'ue' | 'cc' | 'lol', names: ReadonlySet<string>): Map<string, string> {
  const result = new Map<string, string>()
  if (family === 'ue') {
    const ue5 = names.has('spine05')
    result.set('Hips', 'pelvis').set('Spine', 'spine01').set('Spine1', ue5 ? 'spine03' : 'spine02').set('Spine2', ue5 ? 'spine05' : 'spine03')
      .set('Neck', 'neck01').set('Head', 'head')
  } else if (family === 'lol') {
    result.set('Hips', 'root').set('Spine', 'spine1').set('Spine1', 'spine2').set('Spine2', 'spine3').set('Neck', 'neck').set('Head', 'head')
  } else {
    result.set('Hips', 'hip').set('Spine', 'waist').set('Spine1', 'spine01').set('Spine2', 'spine02').set('Neck', 'necktwist01').set('Head', 'head')
  }
  for (const [side, s] of [['Left', 'l'], ['Right', 'r']] as const) {
    for (const [part, [ue, cc, lol]] of Object.entries(LIMBS)) result.set(`${side}${part}`, family === 'ue' ? `${ue}${s}` : `${s}${family === 'lol' ? lol : cc}`)
    for (const finger of FINGERS) for (const index of [1, 2, 3]) {
      const lower = finger.toLowerCase()
      result.set(`${side}Hand${finger}${index}`, family === 'ue' ? `${lower}0${index}${s}` : `${s}${lower}${index}`)
    }
  }
  return result
}

/**
 * Warcraft III Reforged rigs (WhiteoutLib GltfConverter): limbs are 5-joint chains `arm_L0_0..4` + `_end` with twist
 * joints at odd indices (0 shoulder, 2 elbow, end wrist; legs: 0 hip, 2 knee, end ankle, foot_0 ball). `spine_C0_0` is
 * the parent of legs and spine, so it plays Hips; the rig has two spine joints, so Mixamo Spine1 stays unmapped.
 * Finger order (finger_L0..L3) is not verified yet; only thumbs are mapped.
 */
function wc3ReforgedAliases(): Map<string, string> {
  const result = new Map<string, string>([['Hips', 'spinec00jnt'], ['Spine', 'spinec01jnt'], ['Spine2', 'bonechest'], ['Neck', 'neckc00jnt'], ['Head', 'bonehead']])
  for (const [side, s] of [['Left', 'l'], ['Right', 'r']] as const) {
    result.set(`${side}Shoulder`, `shoulder${s}0shoulderjnt`).set(`${side}Arm`, `arm${s}00jnt`).set(`${side}ForeArm`, `arm${s}02jnt`).set(`${side}Hand`, `arm${s}0endjnt`)
      .set(`${side}UpLeg`, `leg${s}00jnt`).set(`${side}Leg`, `leg${s}02jnt`).set(`${side}Foot`, `leg${s}0endjnt`).set(`${side}ToeBase`, `foot${s}00jnt`)
    for (const index of [1, 2, 3]) result.set(`${side}HandThumb${index}`, `thumb${s}0${index - 1}jnt`)
  }
  return result
}

/**
 * World of Warcraft (wow.export glTF): named `bone_<Name>` joints, each under a non-bone `<name>_p` pivot. `bone_Root`
 * parents both `bone_SpineLow` and `bone_Waist` (legs), so it plays Hips. Forearm is `ForearmL` or `ElbowL` by model.
 * Knee and mid-spine are unnamed (`bone_10`, `bone_4`, numbering varies) and are resolved by structure afterwards.
 */
function wowAliases(names: ReadonlySet<string>): Map<string, string> {
  const pick = (...candidates: string[]) => candidates.find((name) => names.has(name)) ?? candidates[0]!
  const result = new Map<string, string>([['Hips', 'boneroot'], ['Spine', 'bonespinelow'], ['Spine2', 'bonechest'], ['Neck', 'boneneck'], ['Head', 'bonehead']])
  for (const [side, s] of [['Left', 'l'], ['Right', 'r']] as const) {
    result.set(`${side}Shoulder`, `boneshoulder${s}`).set(`${side}Arm`, `bonearm${s}`).set(`${side}ForeArm`, pick(`boneforearm${s}`, `boneelbow${s}`))
      .set(`${side}Hand`, `bonehand${s}`).set(`${side}UpLeg`, `boneleg${s}`).set(`${side}Foot`, `bonefoot${s}`).set(`${side}ToeBase`, pick(`bonetoes${s}`, `bonetoe${s}`))
      .set(`${side}HandThumb1`, `bonethumb${s}`).set(`${side}HandIndex1`, `boneindexfinger${s}`).set(`${side}HandMiddle1`, `bonemiddlefinger${s}`)
      .set(`${side}HandRing1`, `boneringfinger${s}`)
  }
  return result
}

/** wow: the Bone strictly between two mapped joints (pivots `*_p` skipped); several → the middle one. */
function resolveBetween(source: RetargetRig, joints: MappedJoint[], target: string, upper: string, lower: string) {
  const joint = joints.find((item) => item.target === target), top = joints.find((item) => item.target === upper)?.sourceId
  const bottom = joints.find((item) => item.target === lower)?.sourceId
  if (!joint || joint.sourceId || !top || !bottom) return
  const parent = new Map(source.bones.map((bone) => [bone.id, bone.parentId])), name = new Map(source.bones.map((bone) => [bone.id, bone.name ?? bone.id]))
  const between: string[] = []
  let id = parent.get(bottom) ?? null
  for (; id && id !== top; id = parent.get(id) ?? null) if (!/_p$/.test(name.get(id)!)) between.unshift(id)
  if (id !== top || !between.length) return // lower joint is not under the upper one, or nothing sits between them
  const pick = between[Math.floor((between.length - 1) / 2)]!
  Object.assign(joint, { source: name.get(pick)!, sourceId: pick, via: 'structure:wow' })
}

function detectFamily(names: ReadonlySet<string>, raw: readonly string[]): SourceFamily {
  if (['hips', 'leftupleg', 'leftarm', 'rightarm'].every((name) => names.has(name))) return 'mixamo'
  if (raw.some((name) => /^cc_?base_/i.test(name.split(':').pop()!))) return 'cc'
  if (names.has('pelvis') && names.has('thighl')) return 'ue'
  if (names.has('pelvis') && names.has('lkneeupper') && names.has('lkneelower')) return 'lol'
  if (names.has('spinec00jnt') && names.has('bonechest') && names.has('arml00jnt')) return 'wc3r'
  if (names.has('boneroot') && names.has('bonelegl') && names.has('bonefootl')) return 'wow'
  return 'unknown'
}

function finish(family: SourceFamily, joints: MappedJoint[]): AutoMapping {
  const pairs = joints.filter((joint) => joint.sourceId).map((joint) => ({ sourceBoneId: joint.sourceId!, targetBoneId: joint.targetId, enabled: true }))
  const missingRequired = MIXAMO65_REQUIRED_JOINTS.filter((name) => !joints.find((joint) => joint.target === name)?.sourceId)
  const requiredTargetIds = MIXAMO65_REQUIRED_JOINTS.map((name) => joints.find((joint) => joint.target === name)!.targetId)
  return { family, joints, pairs, missingRequired, requiredTargetIds }
}

function targetIds(target: RetargetRig): Map<string, string> {
  const result = new Map<string, string>()
  for (const [name] of MIXAMO65_BONE_PARENTS) {
    const matches = target.bones.filter((bone) => canonical(bone.name ?? bone.id) === canonical(name))
    if (matches.length !== 1) throw new TypeError(`Target is not Mixamo65: joint ${name} is missing or ambiguous`)
    result.set(name, matches[0]!.id)
  }
  return result
}

/** Name-based suggestions only; ambiguous names stay unmapped and are reported, never guessed. */
export function buildAutoMapping(source: RetargetRig, target: RetargetRig): AutoMapping {
  const byName = new Map<string, string[]>()
  for (const bone of source.bones) {
    const key = canonical(bone.name ?? bone.id)
    if (key) byName.set(key, [...(byName.get(key) ?? []), bone.id])
  }
  const names = new Set(byName.keys())
  const family = detectFamily(names, source.bones.map((bone) => bone.name ?? bone.id))
  const aliases = family === 'wow' ? wowAliases(names) : family === 'wc3r' ? wc3ReforgedAliases() : family === 'ue' || family === 'cc' || family === 'lol' ? familyAliases(family, names) : new Map<string, string>()
  const sourceName = new Map(source.bones.map((bone) => [bone.id, bone.name ?? bone.id]))
  const joints = [...targetIds(target)].map(([name, targetId]): MappedJoint => {
    for (const [key, via] of [[aliases.get(name), `alias:${family}`], [canonical(name), 'exact']] as const) {
      const ids = key ? byName.get(key) ?? [] : []
      if (ids.length > 1) return { target: name, targetId, source: null, sourceId: null, via, ambiguous: true }
      if (ids.length === 1) return { target: name, targetId, source: sourceName.get(ids[0]!)!, sourceId: ids[0]!, via }
    }
    return { target: name, targetId, source: null, sourceId: null, via: null }
  })
  if (family === 'wow') {
    resolveBetween(source, joints, 'Spine1', 'Spine', 'Spine2')
    for (const side of ['Left', 'Right']) resolveBetween(source, joints, `${side}Leg`, `${side}UpLeg`, `${side}Foot`)
  }
  return finish(family, joints)
}

/** Applies a saved `bbs.mixamo65-mapping-preset` (the Studio export format) instead of name suggestions. */
export function buildPresetMapping(preset: unknown, source: RetargetRig, target: RetargetRig): AutoMapping & { fingerprintsMatch: boolean } {
  const skeleton = (rig: RetargetRig, id: string): MappingSkeleton => ({ id, family: 'custom-preserved', fingerprint: rig.fingerprint,
    bones: rig.bones.map((bone) => ({ id: bone.id, name: bone.name ?? bone.id, parentId: bone.parentId })) })
  const applied = applyMixamo65MappingPreset(preset, skeleton(source, 'source'), skeleton(target, 'target'))
  const sourceName = new Map(source.bones.map((bone) => [bone.id, bone.name ?? bone.id]))
  const joints = [...targetIds(target)].map(([name, targetId]): MappedJoint => {
    const sourceId = applied.assignments[name] ?? null
    return { target: name, targetId, source: sourceId ? sourceName.get(sourceId)! : null, sourceId, via: sourceId ? 'preset' : null,
      ...(applied.ambiguousSource.includes(name) ? { ambiguous: true } : {}) }
  })
  const result = finish('unknown', joints)
  result.pairs = joints.filter((joint) => joint.sourceId).map((joint) => {
    const extra = applied.chainAssignments[joint.target]
    return { sourceBoneId: joint.sourceId!, targetBoneId: joint.targetId, enabled: true,
      ...(extra ? { sourceBoneIds: [joint.sourceId!, ...extra] } : {}),
      ...(applied.chainWeights[joint.target] ? { sourceBoneWeights: applied.chainWeights[joint.target] } : {}),
      ...(extra ? { chainComposition: applied.chainCompositions[joint.target] } : {}) }
  })
  return { ...result, fingerprintsMatch: applied.fingerprintsMatch }
}
