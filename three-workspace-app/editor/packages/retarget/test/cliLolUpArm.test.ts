import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { Bone, Group } from 'three'
import { buildAutoMapping } from '../cli/autoMapping.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'

const target = createThreeRigAdapter(await loadAsset(readFileSync(new URL('../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb', import.meta.url)), 'glb', { skeletonOnly: true }), { fingerprint: 'target' })
function source(options: { omit?: string; classic?: boolean; duplicate?: string } = {}) {
  const root = new Group(), bones = new Map<string, Bone>()
  const add = (name: string, parent?: string) => {
    if (name === options.omit) return
    const bone = new Bone(); bone.name = name; bone.position.y = .1
    ;(bones.get(parent ?? '') ?? root).add(bone); bones.set(name, bone)
    if (name === options.duplicate) { const duplicate = new Bone(); duplicate.name = `rig:${name}`; root.add(duplicate) }
  }
  add('Root'); add('Pelvis', 'Root'); add('Spine', 'Root'); add('Chest', 'Spine'); add('Neck', 'Chest'); add('Head', 'Neck')
  for (const side of ['L', 'R']) {
    add(`${side}_Shoulder`, 'Chest'); add(`${side}_UpArm`, `${side}_Shoulder`); add(`${side}_ForeArm`, `${side}_UpArm`); add(`${side}_Hand`, `${side}_ForeArm`)
    add(`${side}_Hip`, 'Pelvis'); add(`${side}_Knee`, `${side}_Hip`); add(`${side}_Foot`, `${side}_Knee`); add(`${side}_Toe`, `${side}_Foot`)
    if (options.classic) { add(`${side}_KneeUpper`, `${side}_Hip`); add(`${side}_KneeLower`, `${side}_KneeUpper`); add(`${side}_Elbow`, `${side}_Shoulder`); add(`${side}_Clavicle`, 'Chest') }
  }
  if (options.classic) { add('Spine1', 'Root'); add('Spine2', 'Spine1'); add('Spine3', 'Spine2') }
  return createThreeRigAdapter(root, { fingerprint: 'fixture' })
}
function mapping(options: Parameters<typeof source>[0] = {}) {
  const adapter = source(options)
  try { return buildAutoMapping(adapter.rig, target.rig) } finally { adapter.dispose() }
}
test('LoL UpArm variant maps Root and distinct arms/knees, leaving absent fingers unmapped', () => {
  const result = mapping(), of = (name: string) => result.joints.find(j => j.target === name)?.source
  assert.equal(result.family, 'lol'); assert.deepEqual(result.missingRequired, [])
  assert.deepEqual(['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftLeg', 'RightLeg', 'LeftHandIndex3'].map(of),
    ['Root', 'Spine', null, 'Chest', 'L_Shoulder', 'L_UpArm', 'L_ForeArm', 'L_Knee', 'R_Knee', null])
  assert.equal(new Set(result.pairs.map(p => p.sourceBoneId)).size, result.pairs.length)
})
test('incomplete UpArm signatures do not claim LoL or fill missing roles', () => {
  for (const omit of ['Root', 'Chest', 'R_Foot', 'L_Hand', 'R_UpArm']) {
    const result = mapping({ omit }); assert.equal(result.family, 'unknown', omit); assert.ok(result.missingRequired.length > 0, omit)
  }
})
test('ambiguous variant aliases remain blocked', () => {
  const result = mapping({ duplicate: 'L_UpArm' })
  assert.equal(result.family, 'lol'); assert.deepEqual(result.missingRequired, ['LeftArm'])
  assert.equal(result.joints.find(j => j.target === 'LeftArm')?.ambiguous, true)
})
test('classic KneeLower LoL wins even when UpArm variant names coexist', () => {
  const result = mapping({ classic: true }), of = (name: string) => result.joints.find(j => j.target === name)?.source
  assert.equal(result.family, 'lol'); assert.deepEqual(result.missingRequired, [])
  assert.deepEqual(['Hips', 'Spine', 'Spine2', 'LeftArm', 'LeftForeArm', 'LeftLeg'].map(of), ['Root', 'Spine1', 'Spine3', 'L_Shoulder', 'L_Elbow', 'L_KneeLower'])
})
