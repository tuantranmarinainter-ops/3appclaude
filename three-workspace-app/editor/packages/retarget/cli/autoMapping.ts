import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import { applyMixamo65MappingPreset } from '../src/mappingPreset.ts'
import type { MappingSkeleton } from '../src/mapping.ts'
import type { RetargetBonePair, RetargetRig } from '../src/universal.ts'

export type SourceFamily = 'mixamo' | 'ue' | 'cc' | 'unknown'
export interface MappedJoint { target: string; targetId: string; source: string | null; sourceId: string | null; via: string | null; ambiguous?: boolean }
export interface AutoMapping { family: SourceFamily; joints: MappedJoint[]; pairs: RetargetBonePair[]; missingRequired: string[]; requiredTargetIds: string[] }

/** Losing any of these blocks export (DECISIONS: "thiếu role chính"). */
export const MIXAMO65_REQUIRED_JOINTS = Object.freeze(['Hips', 'Spine', 'Head',
  ...['Left', 'Right'].flatMap((side) => ['Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot'].map((part) => `${side}${part}`))])

export function canonical(name: string): string {
  return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/^cc_?base_?/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const
const LIMBS = { Shoulder: ['clavicle', 'clavicle'], Arm: ['upperarm', 'upperarm'], ForeArm: ['lowerarm', 'forearm'], Hand: ['hand', 'hand'],
  UpLeg: ['thigh', 'thigh'], Leg: ['calf', 'calf'], Foot: ['foot', 'foot'], ToeBase: ['ball', 'toebase'] } as const

/** Canonical alias per Mixamo joint; UE uses `name_l` suffixes, CC uses `CC_Base_L_Name` prefixes. */
function familyAliases(family: 'ue' | 'cc', names: ReadonlySet<string>): Map<string, string> {
  const result = new Map<string, string>()
  if (family === 'ue') {
    const ue5 = names.has('spine05')
    result.set('Hips', 'pelvis').set('Spine', 'spine01').set('Spine1', ue5 ? 'spine03' : 'spine02').set('Spine2', ue5 ? 'spine05' : 'spine03')
      .set('Neck', 'neck01').set('Head', 'head')
  } else {
    result.set('Hips', 'hip').set('Spine', 'waist').set('Spine1', 'spine01').set('Spine2', 'spine02').set('Neck', 'necktwist01').set('Head', 'head')
  }
  for (const [side, s] of [['Left', 'l'], ['Right', 'r']] as const) {
    for (const [part, [ue, cc]] of Object.entries(LIMBS)) result.set(`${side}${part}`, family === 'ue' ? `${ue}${s}` : `${s}${cc}`)
    for (const finger of FINGERS) for (const index of [1, 2, 3]) {
      const lower = finger.toLowerCase()
      result.set(`${side}Hand${finger}${index}`, family === 'ue' ? `${lower}0${index}${s}` : `${s}${lower}${index}`)
    }
  }
  return result
}

function detectFamily(names: ReadonlySet<string>, raw: readonly string[]): SourceFamily {
  if (['hips', 'leftupleg', 'leftarm', 'rightarm'].every((name) => names.has(name))) return 'mixamo'
  if (raw.some((name) => /^cc_?base_/i.test(name.split(':').pop()!))) return 'cc'
  if (names.has('pelvis') && names.has('thighl')) return 'ue'
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
  const aliases = family === 'ue' || family === 'cc' ? familyAliases(family, names) : new Map<string, string>()
  const sourceName = new Map(source.bones.map((bone) => [bone.id, bone.name ?? bone.id]))
  const joints = [...targetIds(target)].map(([name, targetId]): MappedJoint => {
    for (const [key, via] of [[aliases.get(name), `alias:${family}`], [canonical(name), 'exact']] as const) {
      const ids = key ? byName.get(key) ?? [] : []
      if (ids.length > 1) return { target: name, targetId, source: null, sourceId: null, via, ambiguous: true }
      if (ids.length === 1) return { target: name, targetId, source: sourceName.get(ids[0]!)!, sourceId: ids[0]!, via }
    }
    return { target: name, targetId, source: null, sourceId: null, via: null }
  })
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
