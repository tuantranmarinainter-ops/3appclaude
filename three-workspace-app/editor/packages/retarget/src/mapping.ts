import { defaultReverseRetargetSettings, validateReverseRetargetSettings, type ReverseRetargetSettings } from './reverse'
import { isMixamo65Topology, MIXAMO65_BONE_PARENTS } from './mixamo65'

export interface MappingSkeleton {
  id: string
  family: 'metarig' | 'mixamo65' | 'minecraft20' | 'custom-preserved'
  fingerprint: string
  bones: Array<{ id: string; name: string; parentId?: string | null; deform?: boolean }>
}
export interface SemanticRole { id: string; label: string; aliases: readonly string[]; familyAliases?: Partial<Record<MappingSkeleton['family'], readonly string[]>> }
export interface SemanticBonePair { role: string; sourceBoneId: string; sourceBoneIds?: string[]; sourceBoneWeights?: number[]; targetBoneId: string; enabled: boolean }
export interface MappingSuggestion extends Omit<SemanticBonePair, 'enabled' | 'sourceBoneId' | 'targetBoneId'> {
  sourceBoneId: string | null
  targetBoneId: string | null
  ambiguousSource: boolean
  ambiguousTarget: boolean
}
export interface MappingValidationReport {
  errors: Array<{ code: string; role?: string; boneId?: string }>
  missingRequiredRoles: string[]
  unmappedSourceBoneIds: string[]
  unmappedTargetBoneIds: string[]
}
export interface RetargetCalibrationV1 {
  type: 'bbs.retarget-calibration'
  version: 1
  engine: 'retarget-9.12'
  sourceFingerprint: string
  targetFingerprint: string
  settings: ReverseRetargetSettings
}

export const RETARGET_SEMANTIC_ROLES: readonly SemanticRole[] = [
  { id: 'root', label: 'Root', aliases: ['root', 'armature', 'master'], familyAliases: { minecraft20: ['anchor'] } },
  { id: 'pelvis', label: 'Pelvis', aliases: ['hips', 'pelvis'], familyAliases: { minecraft20: ['body'] } },
  { id: 'spine', label: 'Spine', aliases: ['spine', 'spine1', 'lowbody'], familyAliases: { minecraft20: ['low_body'] } },
  { id: 'chest', label: 'Chest', aliases: ['spine2', 'chest', 'chest1', 'upperbody'] },
  { id: 'neck', label: 'Neck', aliases: ['neck', 'neck1'] },
  { id: 'head', label: 'Head', aliases: ['head'] },
  { id: 'leftUpperArm', label: 'Left upper arm', aliases: ['leftarm', 'leftupperarm', 'left_arm', 'upperarml'], familyAliases: { minecraft20: ['left_arm'] } },
  { id: 'leftForearm', label: 'Left forearm', aliases: ['leftforearm', 'leftlowerarm', 'lowleftarm', 'forearml'], familyAliases: { minecraft20: ['low_left_arm'] } },
  { id: 'leftHand', label: 'Left hand', aliases: ['lefthand', 'lowleftarmend', 'handl'], familyAliases: { minecraft20: ['low_left_arm.end'] } },
  { id: 'rightUpperArm', label: 'Right upper arm', aliases: ['rightarm', 'rightupperarm', 'right_arm', 'upperarmr'], familyAliases: { minecraft20: ['right_arm'] } },
  { id: 'rightForearm', label: 'Right forearm', aliases: ['rightforearm', 'rightlowerarm', 'lowrightarm', 'forearmr'], familyAliases: { minecraft20: ['low_right_arm'] } },
  { id: 'rightHand', label: 'Right hand', aliases: ['righthand', 'lowrightarmend', 'handr'], familyAliases: { minecraft20: ['low_right_arm.end'] } },
  { id: 'leftThigh', label: 'Left thigh', aliases: ['leftupleg', 'leftthigh', 'thighl'], familyAliases: { minecraft20: ['left_leg'] } },
  { id: 'leftShin', label: 'Left shin', aliases: ['leftleg', 'leftcalf', 'calfl'], familyAliases: { minecraft20: ['low_left_leg'] } },
  { id: 'leftFoot', label: 'Left foot', aliases: ['leftfoot', 'lowleftlegend', 'footl'] },
  { id: 'leftToe', label: 'Left toe', aliases: ['lefttoebase', 'lefttoe', 'toel'] },
  { id: 'rightThigh', label: 'Right thigh', aliases: ['rightupleg', 'rightthigh', 'thighr'], familyAliases: { minecraft20: ['right_leg'] } },
  { id: 'rightShin', label: 'Right shin', aliases: ['rightleg', 'rightcalf', 'calfr'], familyAliases: { minecraft20: ['low_leg_right'] } },
  { id: 'rightFoot', label: 'Right foot', aliases: ['rightfoot', 'lowrightlegend', 'footr'] },
  { id: 'rightToe', label: 'Right toe', aliases: ['righttoebase', 'righttoe', 'toer'] },
]

function canonical(name: string): string {
  return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[|]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

function matches(profile: MappingSkeleton, role: Pick<SemanticRole, 'aliases' | 'familyAliases'>): string[] {
  const aliases = new Set((role.familyAliases?.[profile.family] ?? role.aliases).map(canonical))
  return profile.bones.filter((bone) => aliases.has(canonical(bone.name))).map((bone) => bone.id)
}

/** Suggestions use exact normalized aliases; ambiguous names stay unassigned for user confirmation. */
export function buildSkeletonMappingSuggestions(source: MappingSkeleton, target: MappingSkeleton): MappingSuggestion[] {
  return RETARGET_SEMANTIC_ROLES.map((role) => {
    const sources = matches(source, role)
    const targets = matches(target, role)
    return {
      role: role.id,
      sourceBoneId: sources.length === 1 ? sources[0]! : null,
      targetBoneId: targets.length === 1 ? targets[0]! : null,
      ambiguousSource: sources.length > 1,
      ambiguousTarget: targets.length > 1,
    }
  })
}

export function validateSemanticMapping(
  source: MappingSkeleton,
  target: MappingSkeleton,
  pairs: readonly SemanticBonePair[],
  fingerprints = { sourceFingerprint: source.fingerprint, targetFingerprint: target.fingerprint },
): MappingValidationReport {
  const errors: MappingValidationReport['errors'] = []
  if (fingerprints.sourceFingerprint !== source.fingerprint) errors.push({ code: 'SOURCE_FINGERPRINT_MISMATCH' })
  if (fingerprints.targetFingerprint !== target.fingerprint) errors.push({ code: 'TARGET_FINGERPRINT_MISMATCH' })
  const sourceBones = new Set(source.bones.map((bone) => bone.id))
  const targetBones = new Set(target.bones.map((bone) => bone.id))
  const jointMapping = pairs.some((pair) => pair.role.startsWith('mixamo65:'))
  const jointRoles = MIXAMO65_BONE_PARENTS.map(([name]) => `mixamo65:${name}`)
  if (jointMapping && (target.family !== 'mixamo65' || target.bones.some((bone) => bone.parentId === undefined) ||
      !isMixamo65Topology(target.bones as Array<{ id: string; name: string; parentId: string | null; deform?: boolean }>))) errors.push({ code: 'CANONICAL_TARGET_REQUIRED' })
  const roles = new Set(jointMapping ? jointRoles : RETARGET_SEMANTIC_ROLES.map((role) => role.id))
  const seenRoles = new Set<string>()
  const usedSources = new Set<string>()
  const usedTargets = new Set<string>()
  for (const pair of pairs) {
    const sourceIds = pair.sourceBoneIds ?? [pair.sourceBoneId]
    if (!roles.has(pair.role)) errors.push({ code: 'UNKNOWN_ROLE', role: pair.role })
    if (seenRoles.has(pair.role)) errors.push({ code: 'DUPLICATE_ROLE', role: pair.role })
    seenRoles.add(pair.role)
    if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds[0] !== pair.sourceBoneId || new Set(sourceIds).size !== sourceIds.length) errors.push({ code: 'SOURCE_CHAIN_INVALID', role: pair.role, boneId: pair.sourceBoneId })
    const weights = pair.sourceBoneWeights
    if (weights !== undefined && (!Array.isArray(weights) || weights.length !== sourceIds.length || weights.some((weight) => !Number.isFinite(weight) || weight < 0) || !weights.some((weight) => weight > 0))) errors.push({ code: 'SOURCE_CHAIN_WEIGHTS_INVALID', role: pair.role, boneId: pair.sourceBoneId })
    for (const sourceId of Array.isArray(sourceIds) ? sourceIds : []) if (!sourceBones.has(sourceId)) errors.push({ code: 'SOURCE_BONE_MISSING', role: pair.role, boneId: sourceId })
    if (Array.isArray(sourceIds) && sourceIds.length > 1) {
      for (let index = 1; index < sourceIds.length; index += 1) {
        let ancestor = source.bones.find((bone) => bone.id === sourceIds[index]!)?.parentId ?? null
        while (ancestor && ancestor !== sourceIds[index - 1]) ancestor = source.bones.find((bone) => bone.id === ancestor)?.parentId ?? null
        if (ancestor !== sourceIds[index - 1]) errors.push({ code: 'SOURCE_CHAIN_NOT_CONTIGUOUS', role: pair.role, boneId: sourceIds[index] })
      }
    }
    if (!targetBones.has(pair.targetBoneId)) errors.push({ code: 'TARGET_BONE_MISSING', role: pair.role, boneId: pair.targetBoneId })
    if (jointMapping && canonical(target.bones.find((bone) => bone.id === pair.targetBoneId)?.name ?? '') !== canonical(pair.role.slice('mixamo65:'.length))) errors.push({ code: 'TARGET_ROLE_MISMATCH', role: pair.role, boneId: pair.targetBoneId })
    if (pair.enabled && targetBones.has(pair.targetBoneId) && usedTargets.has(pair.targetBoneId)) errors.push({ code: 'DUPLICATE_TARGET_BONE', role: pair.role, boneId: pair.targetBoneId })
    if (pair.enabled) for (const sourceId of Array.isArray(sourceIds) ? sourceIds : []) if (sourceBones.has(sourceId)) usedSources.add(sourceId)
    if (pair.enabled && targetBones.has(pair.targetBoneId)) usedTargets.add(pair.targetBoneId)
  }
  return {
    errors,
    missingRequiredRoles: jointMapping
      ? jointRoles.filter((role) => /^(Hips|Spine|Head|(?:Left|Right)(?:Arm|ForeArm|Hand|UpLeg|Leg|Foot))$/.test(role.slice('mixamo65:'.length)) && !pairs.some((pair) => pair.enabled && pair.role === role))
      : RETARGET_SEMANTIC_ROLES.filter((role) => isRequired(role.id, target) && !pairs.some((pair) => pair.enabled && pair.role === role.id)).map((role) => role.id),
    unmappedSourceBoneIds: source.bones.filter((bone) => !usedSources.has(bone.id)).map((bone) => bone.id),
    unmappedTargetBoneIds: target.bones.filter((bone) => !usedTargets.has(bone.id)).map((bone) => bone.id),
  }
}

function isRequired(role: string, target: MappingSkeleton): boolean {
  if (role === 'root' || role.endsWith('Toe')) return false
  if (target.family === 'minecraft20') return !['chest', 'neck', 'leftFoot', 'rightFoot'].includes(role)
  return true
}

export function createRetargetCalibration(sourceFingerprint: string, targetFingerprint: string, settings: ReverseRetargetSettings = defaultReverseRetargetSettings): RetargetCalibrationV1 {
  if (!/^[a-f0-9]{64}$/.test(sourceFingerprint) || !/^[a-f0-9]{64}$/.test(targetFingerprint)) throw new TypeError('Retarget calibration requires profile fingerprints')
  validateReverseRetargetSettings(settings)
  return {
    type: 'bbs.retarget-calibration', version: 1, engine: 'retarget-9.12', sourceFingerprint, targetFingerprint,
    settings: { ...settings },
  }
}

export function isRetargetCalibrationV1(value: unknown, sourceFingerprint: string, targetFingerprint: string): value is RetargetCalibrationV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const calibration = value as Partial<RetargetCalibrationV1>
  const settings = calibration.settings
  if (Object.keys(calibration).some((key) => !['type', 'version', 'engine', 'sourceFingerprint', 'targetFingerprint', 'settings'].includes(key)) || Object.keys(calibration).length !== 6 ||
    calibration.type !== 'bbs.retarget-calibration' || calibration.version !== 1 || calibration.engine !== 'retarget-9.12' ||
    calibration.sourceFingerprint !== sourceFingerprint || calibration.targetFingerprint !== targetFingerprint || !settings || typeof settings !== 'object') return false
  try {
    if (Object.keys(settings).length !== 13 || Object.keys(settings).some((key) => !['intensity', 'stride', 'vertical', 'mirror', 'proportionSide', 'motionSide', 'rootMotion', 'rootTravelMode', 'shoulderWidth', 'upperArm', 'forearm', 'legLength', 'armSpace'].includes(key))) return false
    validateReverseRetargetSettings(settings as ReverseRetargetSettings)
    return ['both', 'left', 'right'].includes(settings.proportionSide) && ['both', 'left', 'right'].includes(settings.motionSide) &&
      typeof settings.mirror === 'boolean' && typeof settings.rootMotion === 'boolean' && ['inPlace', 'follow'].includes(settings.rootTravelMode)
  } catch { return false }
}
