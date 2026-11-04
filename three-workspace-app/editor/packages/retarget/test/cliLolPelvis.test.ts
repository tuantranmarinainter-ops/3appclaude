import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { Bone, Group } from 'three'
import { buildAutoMapping } from '../cli/autoMapping.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { createThreeRigAdapter } from '../src/threeRigAdapter.ts'

// Shape of League `jayce.glb`: no Root, Pelvis parents Spine1 and the legs, single L_Knee, L_Shoulder/L_Elbow arms.
const target = createThreeRigAdapter(await loadAsset(readFileSync(new URL('../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb', import.meta.url)), 'glb', { skeletonOnly: true }), { fingerprint: 'target' })
function source(options: { omit?: string; root?: boolean } = {}) {
  const group = new Group(), bones = new Map<string, Bone>()
  const add = (name: string, parent?: string) => {
    if (name === options.omit) return
    const bone = new Bone(); bone.name = name; bone.position.y = .1
    ;(bones.get(parent ?? '') ?? group).add(bone); bones.set(name, bone)
  }
  if (options.root) add('Root')
  add('Pelvis', options.root ? 'Root' : undefined); add('Spine1', 'Pelvis'); add('Spine2', 'Spine1'); add('Spine3', 'Spine2'); add('Neck', 'Spine3'); add('Head', 'Neck')
  for (const side of ['L', 'R']) {
    add(`${side}_Clavicle`, 'Spine3'); add(`${side}_Shoulder`, `${side}_Clavicle`); add(`${side}_Elbow`, `${side}_Shoulder`); add(`${side}_Hand`, `${side}_Elbow`)
    for (const finger of ['Middle', 'Thumb']) for (const index of [1, 2, 3]) add(`${side}_${finger}${index}`, index === 1 ? `${side}_Hand` : `${side}_${finger}${index - 1}`)
    add(`${side}_Hip`, 'Pelvis'); add(`${side}_Knee`, `${side}_Hip`); add(`${side}_Foot`, `${side}_Knee`); add(`${side}_Toe`, `${side}_Foot`)
    add(`${side}_BUFFBONE_GLB_HAND_LOC`, `${side}_Hand`)
  }
  add('BUFFBONE_GLB_CHANNEL_LOC'); add('Weapon')
  return createThreeRigAdapter(group, { fingerprint: 'fixture' })
}
function mapping(options: Parameters<typeof source>[0] = {}) {
  const adapter = source(options)
  try { return buildAutoMapping(adapter.rig, target.rig) } finally { adapter.dispose() }
}

test('LoL Pelvis variant (jayce): Pelvis plays Hips, Spine1..3 the spine, Shoulder/Elbow the arm, single Knee the shin', () => {
  const result = mapping(), of = (name: string) => result.joints.find(j => j.target === name)?.source
  assert.equal(result.family, 'lol'); assert.deepEqual(result.missingRequired, [])
  assert.deepEqual(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'LeftHandMiddle2', 'RightHandThumb3', 'LeftHandIndex1'].map(of),
    ['Pelvis', 'Spine1', 'Spine2', 'Spine3', 'Neck', 'Head', 'L_Clavicle', 'L_Shoulder', 'L_Elbow', 'L_Hand', 'R_Hip', 'R_Knee', 'R_Foot', 'R_Toe', 'L_Middle2', 'R_Thumb3', null])
  assert.equal(new Set(result.pairs.map(p => p.sourceBoneId)).size, result.pairs.length)
})

test('incomplete or Root-parented Pelvis signatures do not claim the variant', () => {
  for (const omit of ['Spine2', 'L_Knee', 'R_Elbow', 'L_Clavicle', 'R_Foot']) {
    const result = mapping({ omit }); assert.equal(result.family, 'unknown', omit); assert.ok(result.missingRequired.length > 0, omit)
  }
  // A Root above Pelvis is not this shape (classic LoL parents Spine1 to Root); leave it to the existing rules.
  assert.notDeepEqual(mapping({ root: true }).joints.find(j => j.target === 'Hips')?.source, 'Pelvis')
})
