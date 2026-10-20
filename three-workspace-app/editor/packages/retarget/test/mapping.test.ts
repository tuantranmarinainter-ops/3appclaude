import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSkeletonMappingSuggestions, validateSemanticMapping, type SemanticBonePair } from '../src/mapping.ts'
import type { SkeletonProfile } from '@bbs/animation-workspace-shared'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'

test('canonical joint roles map all65 slots and reject role/target mismatch without weakening legacy validation', () => {
  const target = profile('target', MIXAMO65_BONE_PARENTS.map(([name]) => name), 'mixamo65')
  for (const [index, [, parent]] of MIXAMO65_BONE_PARENTS.entries()) target.bones[index]!.parentId = parent ? String(MIXAMO65_BONE_PARENTS.findIndex(([name]) => name === parent)) : null
  const source = { ...structuredClone(target), id: 'source', family: 'custom-preserved' as const }
  const pairs = target.bones.map((bone) => ({ role: `mixamo65:${bone.name}`, sourceBoneId: bone.id, targetBoneId: bone.id, enabled: true }))
  assert.deepEqual(validateSemanticMapping(source, target, pairs).errors, [])
  assert.deepEqual(validateSemanticMapping(source, target, pairs).missingRequiredRoles, [])
  const changed = structuredClone(pairs); changed[0]!.targetBoneId = '1'
  assert.ok(validateSemanticMapping(source, target, changed).errors.some((error) => error.code === 'TARGET_ROLE_MISMATCH'))
  assert.ok(validateSemanticMapping(source, target, pairs.filter((pair) => pair.role !== 'mixamo65:Hips')).missingRequiredRoles.includes('mixamo65:Hips'))
})

function profile(id: string, names: string[], family: SkeletonProfile['family'] = 'custom-preserved'): SkeletonProfile {
  const hash = id === 'source' ? 'a' : 'b'
  return {
    id, family,
    bones: names.map((name, index) => ({ id: String(index), name, parentId: index ? String(index - 1) : null,
      rest: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, deform: true })),
    rootBoneId: '0', metersPerUnit: 1, basisToScene: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    fingerprint: hash.repeat(64), nativeFingerprint: null,
    provenance: { sourceKey: 'fixture', sourceVersion: '1', sourceHash: hash.repeat(64), original: { path: `assets/${hash}/${hash}.fbx`, sha256: hash.repeat(64), mediaType: 'application/vnd.autodesk.fbx', byteLength: 1 } },
  }
}

test('suggests a semantic role only when each exact alias resolves uniquely', () => {
  const source = profile('source', ['mixamorig:Hips', 'mixamorig:LeftArm'])
  const target = profile('target', ['pelvis', 'left_upper_arm'])
  const suggestions = buildSkeletonMappingSuggestions(source, target)
  assert.deepEqual(suggestions.find((item) => item.role === 'pelvis'), { role: 'pelvis', sourceBoneId: '0', targetBoneId: '0', ambiguousSource: false, ambiguousTarget: false })
  assert.deepEqual(suggestions.find((item) => item.role === 'leftUpperArm'), { role: 'leftUpperArm', sourceBoneId: '1', targetBoneId: '1', ambiguousSource: false, ambiguousTarget: false })
})

test('does not guess when aliases are ambiguous and reports required gaps and extras', () => {
  const source = profile('source', ['hips', 'pelvis', 'left_arm'])
  const target = profile('target', ['hips', 'pelvis', 'left_arm'])
  const suggestion = buildSkeletonMappingSuggestions(source, target).find((item) => item.role === 'pelvis')!
  assert.equal(suggestion.sourceBoneId, null)
  assert.equal(suggestion.targetBoneId, null)
  assert.equal(suggestion.ambiguousSource, true)

  const pair: SemanticBonePair = { role: 'leftUpperArm', sourceBoneId: '2', targetBoneId: '2', enabled: true }
  const report = validateSemanticMapping(source, target, [pair])
  assert.equal(report.errors.length, 0)
  assert.ok(report.missingRequiredRoles.includes('pelvis'))
  assert.ok(report.unmappedSourceBoneIds.includes('0'))
  assert.ok(report.unmappedTargetBoneIds.includes('1'))
})

test('semantic mapping accepts an ordered descendant chain per target role and rejects unrelated bones', () => {
  const source = profile('source', ['Hips', 'Spine', 'SpineTwist', 'LeftArm'])
  const target = profile('target', ['pelvis', 'torso', 'arm'])
  const pair: SemanticBonePair = { role: 'pelvis', sourceBoneId: '1', sourceBoneIds: ['1', '2'], targetBoneId: '0', enabled: true }
  assert.deepEqual(validateSemanticMapping(source, target, [pair]).errors, [])
  const invalid = validateSemanticMapping(source, target, [{ ...pair, sourceBoneId: '2', sourceBoneIds: ['2', '1'] }])
  assert.ok(invalid.errors.some((error) => error.code === 'SOURCE_CHAIN_NOT_CONTIGUOUS'))
})

test('semantic mapping rejects malformed source-chain weights', () => {
  const source: MappingSkeleton = { id: 'source', family: 'custom-preserved', fingerprint: 's', bones: [
    { id: 'root', name: 'root', parentId: null }, { id: 'a', name: 'a', parentId: 'root' }, { id: 'b', name: 'b', parentId: 'a' },
  ] }
  const target: MappingSkeleton = { id: 'target', family: 'custom-preserved', fingerprint: 't', bones: [{ id: 'root', name: 'root', parentId: null }] }
  const pair: SemanticBonePair = { role: 'pelvis', sourceBoneId: 'a', sourceBoneIds: ['a', 'b'], sourceBoneWeights: [1, 3], targetBoneId: 'root', enabled: true }
  assert.deepEqual(validateSemanticMapping(source, target, [pair], { sourceFingerprint: 's', targetFingerprint: 't' }).errors, [])
  for (const sourceBoneWeights of [[1], [-1, 2], [0, 0], [Number.POSITIVE_INFINITY, 1]]) {
    const result = validateSemanticMapping(source, target, [{ ...pair, sourceBoneWeights }], { sourceFingerprint: 's', targetFingerprint: 't' })
    assert.ok(result.errors.some((error) => error.code === 'SOURCE_CHAIN_WEIGHTS_INVALID'))
  }
})

test('Minecraft20 requires its supported limb roles without demanding absent toes, feet, chest, or neck', () => {
  const source = profile('source', ['Hips', 'Spine', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'])
  const target = profile('target', ['anchor', 'body', 'low_body', 'head', 'left_arm', 'low_left_arm', 'low_left_arm.end', 'right_arm', 'low_right_arm', 'low_right_arm.end', 'left_leg', 'low_left_leg', 'right_leg', 'low_leg_right'], 'minecraft20')
  const pairs = buildSkeletonMappingSuggestions(source, target).flatMap((suggestion) => suggestion.sourceBoneId && suggestion.targetBoneId
    ? [{ role: suggestion.role, sourceBoneId: suggestion.sourceBoneId, targetBoneId: suggestion.targetBoneId, enabled: true }]
    : [])
  const report = validateSemanticMapping(source, target, pairs)
  assert.equal(report.errors.length, 0)
  assert.deepEqual(report.missingRequiredRoles, [])
  assert.ok(pairs.some((pair) => pair.role === 'leftShin'))
  assert.ok(!pairs.some((pair) => pair.role.endsWith('Toe') || pair.role.endsWith('Foot') || pair.role === 'chest' || pair.role === 'neck'))
})

test('rejects stale fingerprints, unknown roles, and duplicate target assignments', () => {
  const source = profile('source', ['hips', 'head'])
  const target = profile('target', ['pelvis', 'head'])
  const report = validateSemanticMapping(source, target, [
    { role: 'pelvis', sourceBoneId: '0', targetBoneId: '0', enabled: true },
    { role: 'madeUp', sourceBoneId: '1', targetBoneId: '0', enabled: true },
  ], { sourceFingerprint: 'f'.repeat(64), targetFingerprint: target.fingerprint })
  assert.ok(report.errors.some((error) => error.code === 'SOURCE_FINGERPRINT_MISMATCH'))
  assert.ok(report.errors.some((error) => error.code === 'UNKNOWN_ROLE'))
  assert.ok(report.errors.some((error) => error.code === 'DUPLICATE_TARGET_BONE'))
})
