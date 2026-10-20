import { MIXAMO65_BONE_PARENTS } from './mixamo65'
import type { MappingSkeleton } from './mapping'

const TYPE = 'bbs.mixamo65-mapping-preset'

export interface Mixamo65MappingPreset {
  type: typeof TYPE
  version: 1 | 2 | 3 | 4
  sourceFingerprint: string
  targetFingerprint: string
  roles: Array<{ role: string; sourceBoneName: string | null; additionalSourceBoneNames?: string[]; sourceBoneWeights?: number[]; chainComposition?: 'world-average' | 'local-compose'; targetBoneName: string }>
}

export interface AppliedMappingPreset {
  assignments: Record<string, string>
  missingSource: string[]
  ambiguousSource: string[]
  missingTarget: string[]
  ambiguousTarget: string[]
  invalidSourceChain: string[]
  chainWeights: Record<string, number[]>
  chainAssignments: Record<string, string[]>
  chainCompositions: Record<string, 'world-average' | 'local-compose'>
  fingerprintsMatch: boolean
}

function canonical(name: string): string {
  return name.split(':').pop()!.replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

export function createMixamo65MappingPreset(
  source: MappingSkeleton,
  target: MappingSkeleton,
  assignments: Readonly<Record<string, string>>,
  chainAssignments: Readonly<Record<string, string[]>> = {},
  chainWeights: Readonly<Record<string, number[]>> = {},
  chainCompositions: Readonly<Record<string, 'world-average' | 'local-compose'>> = {},
): Mixamo65MappingPreset {
  const version = Object.values(chainCompositions).includes('local-compose') ? 4 : 3
  const roles = MIXAMO65_BONE_PARENTS.map(([name]) => {
    const sourceBone = source.bones.find((bone) => bone.id === assignments[name])
    const targets = target.bones.filter((bone) => bone.deform !== false && canonical(bone.name) === canonical(name))
    if (targets.length !== 1) throw new TypeError(`Target joint ${name} must resolve uniquely`)
    const extraIds = chainAssignments[name] ?? []
    if (!sourceBone && extraIds.length) throw new TypeError(`Source chain for ${name} requires a mapped base bone`)
    const extraNames = extraIds.map((id) => source.bones.find((bone) => bone.id === id)?.name)
    if (extraNames.some((boneName) => !boneName)) throw new TypeError(`Source chain for ${name} contains a missing bone`)
    let previous = sourceBone?.id
    for (const id of extraIds) {
      let ancestor = source.bones.find((bone) => bone.id === id)?.parentId ?? null
      while (ancestor && ancestor !== previous) ancestor = source.bones.find((bone) => bone.id === ancestor)?.parentId ?? null
      if (!previous || ancestor !== previous) throw new TypeError(`Source chain for ${name} must follow descendant hierarchy order`)
      previous = id
    }
    const weights = chainWeights[name]
    const composition = chainCompositions[name] ?? 'world-average'
    if (weights !== undefined && (weights.length !== extraIds.length + 1 || weights.some((weight) => !Number.isFinite(weight) || weight < 0 || composition === 'local-compose' && weight > 1) || !weights.some((weight) => weight > 0))) throw new TypeError(`Source-chain weights for ${name} must match the chain and contain a positive value`)
    if (composition === 'local-compose' && (!sourceBone || extraIds.length < 1)) throw new TypeError(`Local composition for ${name} requires at least two source bones`)
    return { role: `mixamo65:${name}`, sourceBoneName: sourceBone?.name ?? null,
      ...(extraNames.length ? { additionalSourceBoneNames: extraNames as string[] } : {}), ...(weights ? { sourceBoneWeights: weights } : {}),
      ...(version === 4 ? { chainComposition: composition } : {}), targetBoneName: targets[0]!.name }
  })
  return { type: TYPE, version, sourceFingerprint: source.fingerprint, targetFingerprint: target.fingerprint, roles }
}

export function applyMixamo65MappingPreset(
  value: unknown,
  source: MappingSkeleton,
  target: MappingSkeleton,
): AppliedMappingPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Mapping preset must be an object')
  const preset = value as Partial<Mixamo65MappingPreset>
  if (Object.keys(preset).sort().join(',') !== 'roles,sourceFingerprint,targetFingerprint,type,version' ||
      preset.type !== TYPE || ![1, 2, 3, 4].includes(preset.version as number) || typeof preset.sourceFingerprint !== 'string' || typeof preset.targetFingerprint !== 'string' ||
      !Array.isArray(preset.roles) || preset.roles.length !== MIXAMO65_BONE_PARENTS.length) throw new TypeError('Unsupported or malformed mapping preset')
  const expected = MIXAMO65_BONE_PARENTS.map(([name]) => `mixamo65:${name}`)
  if (preset.roles.some((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.role !== expected[index] ||
        (item.sourceBoneName !== null && (typeof item.sourceBoneName !== 'string' || !item.sourceBoneName.trim())) ||
        item.additionalSourceBoneNames !== undefined && (!Array.isArray(item.additionalSourceBoneNames) || item.additionalSourceBoneNames.some((name) => typeof name !== 'string' || !name.trim())) ||
        item.chainComposition !== undefined && item.chainComposition !== 'world-average' && item.chainComposition !== 'local-compose' ||
        item.chainComposition === 'local-compose' && ((item.additionalSourceBoneNames?.length ?? 0) < 1 || item.sourceBoneWeights?.some((weight) => weight > 1)) ||
        item.sourceBoneWeights !== undefined && (!Array.isArray(item.sourceBoneWeights) || item.sourceBoneWeights.length !== (item.sourceBoneName === null ? 0 : 1 + (item.additionalSourceBoneNames?.length ?? 0)) || item.sourceBoneWeights.some((weight) => !Number.isFinite(weight) || weight < 0) || !item.sourceBoneWeights.some((weight) => weight > 0)) ||
        typeof item.targetBoneName !== 'string' || !item.targetBoneName.trim()) return true
    const keys = Object.keys(item).sort().join(',')
    const legacyKeys = 'role,sourceBoneName,targetBoneName'
    const chainKeys = 'additionalSourceBoneNames,role,sourceBoneName,targetBoneName'
    const weightKeys = 'role,sourceBoneName,sourceBoneWeights,targetBoneName'
    const chainWeightKeys = 'additionalSourceBoneNames,role,sourceBoneName,sourceBoneWeights,targetBoneName'
    const compositionKeys = 'chainComposition,role,sourceBoneName,targetBoneName'
    const chainCompositionKeys = 'additionalSourceBoneNames,chainComposition,role,sourceBoneName,targetBoneName'
    const weightedCompositionKeys = 'chainComposition,role,sourceBoneName,sourceBoneWeights,targetBoneName'
    const fullCompositionKeys = 'additionalSourceBoneNames,chainComposition,role,sourceBoneName,sourceBoneWeights,targetBoneName'
    return keys !== legacyKeys && !([2, 3].includes(preset.version as number) && keys === chainKeys) && !(preset.version === 3 && (keys === weightKeys || keys === chainWeightKeys)) &&
      !(preset.version === 4 && [compositionKeys, chainCompositionKeys, weightedCompositionKeys, fullCompositionKeys].includes(keys))
  })) throw new TypeError('Mapping preset roles are invalid or out of order')

  const assignments: Record<string, string> = {}
  const chainAssignments: Record<string, string[]> = {}
  const chainWeights: Record<string, number[]> = {}
  const chainCompositions: Record<string, 'world-average' | 'local-compose'> = {}
  const missingSource: string[] = [], ambiguousSource: string[] = [], missingTarget: string[] = [], ambiguousTarget: string[] = [], invalidSourceChain: string[] = []
  for (const item of preset.roles) {
    const name = item.role.slice('mixamo65:'.length)
    chainCompositions[name] = item.chainComposition ?? 'world-average'
    const targets = target.bones.filter((bone) => bone.deform !== false && canonical(bone.name) === canonical(item.targetBoneName))
    if (!targets.length) missingTarget.push(name)
    else if (targets.length > 1) ambiguousTarget.push(name)
    if (item.sourceBoneName === null) { missingSource.push(name); continue }
    const sources = source.bones.filter((bone) => canonical(bone.name) === canonical(item.sourceBoneName!))
    if (!sources.length) missingSource.push(name)
    else if (sources.length > 1) ambiguousSource.push(name)
    else {
      assignments[name] = sources[0]!.id
      const extraIds: string[] = []
      let valid = true
      for (const boneName of item.additionalSourceBoneNames ?? []) {
        const matches = source.bones.filter((bone) => canonical(bone.name) === canonical(boneName))
        if (!matches.length) { missingSource.push(name); valid = false; break }
        if (matches.length > 1) { ambiguousSource.push(name); valid = false; break }
        extraIds.push(matches[0]!.id)
      }
      const chain = [sources[0]!.id, ...extraIds]
      for (let index = 1; index < chain.length && valid; index += 1) {
        let ancestor = source.bones.find((bone) => bone.id === chain[index]!)?.parentId ?? null
        while (ancestor && ancestor !== chain[index - 1]) ancestor = source.bones.find((bone) => bone.id === ancestor)?.parentId ?? null
        if (ancestor !== chain[index - 1]) { invalidSourceChain.push(name); valid = false }
      }
      if (valid && extraIds.length) chainAssignments[name] = extraIds
      if (valid && item.sourceBoneWeights) chainWeights[name] = item.sourceBoneWeights.slice()
    }
  }
  return {
    assignments, chainAssignments, chainWeights, chainCompositions, missingSource, ambiguousSource, missingTarget, ambiguousTarget, invalidSourceChain,
    fingerprintsMatch: preset.sourceFingerprint === source.fingerprint && preset.targetFingerprint === target.fingerprint,
  }
}
