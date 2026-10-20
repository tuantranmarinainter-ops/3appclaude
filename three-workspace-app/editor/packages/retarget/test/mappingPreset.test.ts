import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMixamo65MappingPreset, createMixamo65MappingPreset } from '../src/mappingPreset.ts'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import type { MappingSkeleton } from '../src/mapping.ts'

function rig(prefix: string, fingerprint: string, duplicateHips = false): MappingSkeleton {
  return {
    id: prefix, family: 'custom-preserved', fingerprint,
    bones: [...MIXAMO65_BONE_PARENTS.map(([name], index) => ({ id: `${prefix}-${index}`, name: `${prefix}${name}`, deform: true })),
      { id: `${prefix}-chain`, name: `${prefix}HipsTwist`, parentId: `${prefix}-0`, deform: true },
      ...(duplicateHips ? [{ id: `${prefix}-duplicate`, name: `${prefix}Hips`, deform: true }] : [])],
  }
}

test('portable mapping preset resolves names across different profile IDs and requires no stale IDs', () => {
  const source = rig('mixamorig:', 'a'.repeat(64))
  const target = rig('', 'b'.repeat(64))
  const assignments = Object.fromEntries(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, `${source.id}-${index}`]))
  const preset = createMixamo65MappingPreset(source, target, assignments)
  const nextSource = rig('mixamorig:', 'c'.repeat(64))
  const nextTarget = rig('', 'd'.repeat(64))
  const applied = applyMixamo65MappingPreset(JSON.parse(JSON.stringify(preset)), nextSource, nextTarget)
  assert.equal(Object.keys(applied.assignments).length, 65)
  assert.deepEqual(applied.missingSource, [])
  assert.equal(applied.fingerprintsMatch, false)
  assert.equal(applied.assignments.Hips, `${nextSource.id}-0`)
})

test('version 3 preset preserves chain weights and older presets remain importable', () => {
  const source = rig('mixamorig:', 'a'.repeat(64)), target = rig('', 'b'.repeat(64))
  const assignments = Object.fromEntries(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, `${source.id}-${index}`]))
  const preset = createMixamo65MappingPreset(source, target, assignments, { Hips: [`${source.id}-chain`] }, { Hips: [1, 3] })
  assert.equal(preset.version, 3)
  const nextSource = rig('mixamorig:', 'c'.repeat(64)), nextTarget = rig('', 'd'.repeat(64))
  const applied = applyMixamo65MappingPreset(preset, nextSource, nextTarget)
  assert.deepEqual(applied.chainAssignments.Hips, [`${nextSource.id}-chain`])
  assert.deepEqual(applied.chainWeights.Hips, [1, 3])
  const v2 = { ...preset, version: 2 as const, roles: preset.roles.map(({ sourceBoneWeights: _discard, ...role }) => role) }
  const appliedV2 = applyMixamo65MappingPreset(v2, nextSource, nextTarget)
  assert.deepEqual(appliedV2.chainAssignments.Hips, [`${nextSource.id}-chain`])
  assert.deepEqual(appliedV2.chainWeights, {})
  const v1 = { ...v2, version: 1 as const, roles: v2.roles.map(({ additionalSourceBoneNames: _discard, ...role }) => role) }
  assert.deepEqual(applyMixamo65MappingPreset(v1, nextSource, nextTarget).chainAssignments, {})
})

test('preset leaves duplicate and missing bone names unmapped and reports target ambiguity', () => {
  const source = rig('', 'a'.repeat(64), true)
  const target = rig('', 'b'.repeat(64), true)
  const preset = createMixamo65MappingPreset(source, rig('', 'c'.repeat(64)), Object.fromEntries(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, `${source.id}-${index}`])))
  const applied = applyMixamo65MappingPreset(preset, source, target)
  assert.equal(applied.assignments.Hips, undefined)
  assert.deepEqual(applied.ambiguousSource, ['Hips'])
  assert.deepEqual(applied.ambiguousTarget, ['Hips'])
})

test('rejects malformed and role-reordered presets', () => {
  const source = rig('', 'a'.repeat(64)), target = rig('', 'b'.repeat(64))
  const preset = createMixamo65MappingPreset(source, target, {})
  const reordered = structuredClone(preset)
  ;[reordered.roles[0], reordered.roles[1]] = [reordered.roles[1]!, reordered.roles[0]!]
  assert.throws(() => applyMixamo65MappingPreset(reordered, source, target), /roles are invalid/)
  assert.throws(() => applyMixamo65MappingPreset({ ...preset, unexpected: true }, source, target), /malformed/)
  const invalidWeights = { ...preset, roles: preset.roles.map((role, index) => index === 0 ? { ...role, sourceBoneWeights: [1] } : role) }
  assert.throws(() => applyMixamo65MappingPreset(invalidWeights, source, target), /roles are invalid/)
})
