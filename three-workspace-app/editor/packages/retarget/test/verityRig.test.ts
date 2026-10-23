import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { applyMixamo65MappingPreset } from '../src/mappingPreset.ts'
import { MIXAMO65_BONE_PARENTS } from '../src/mixamo65.ts'
import {
  createVerityMixamo65Preset,
  MIXAMO_TO_VERITY,
  remapVerityInfluences,
  solverWorldToVerity,
  VERITY_TO_MIXAMO,
} from '../src/verityRig.ts'
import type { MappingSkeleton } from '../src/mapping.ts'
import { parseBobjActions } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'
import { loadVerityModel, type AddedAction } from '../workbench/verity.ts'

function verityRig(): MappingSkeleton {
  const parentByTarget = new Map(MIXAMO65_BONE_PARENTS)
  const bones = Object.entries(VERITY_TO_MIXAMO).map(([source, target], index) => ({
    id: `v${index}`,
    name: source,
    parentId: parentByTarget.get(target) ? `v${Object.keys(VERITY_TO_MIXAMO).indexOf(MIXAMO_TO_VERITY[parentByTarget.get(target)!]!)}` : null,
    deform: true,
  }))
  bones.push(
    { id: 'root', name: 'Root', parentId: null, deform: true },
    { id: 'pelvis', name: 'Pelvis', parentId: bones.find((bone) => bone.name === 'COG')!.id, deform: true },
    { id: 'jaw', name: 'Jaw', parentId: bones.find((bone) => bone.name === 'Head')!.id, deform: true },
    { id: 'wing', name: 'Wing_Bone_L', parentId: bones.find((bone) => bone.name === 'Chest')!.id, deform: true },
    { id: 'camera', name: 'camera', parentId: 'root', deform: true },
    { id: 'terminal', name: 'Jaw_end_end', parentId: 'jaw', deform: true },
  )
  return { id: 'verity', family: 'custom-preserved', fingerprint: 'a'.repeat(64), bones }
}

function mixamoRig(): MappingSkeleton {
  const ids = new Map(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, `m${index}`]))
  return {
    id: 'mixamo65',
    family: 'mixamo65',
    fingerprint: 'b'.repeat(64),
    bones: MIXAMO65_BONE_PARENTS.map(([name, parent]) => ({
      id: ids.get(name)!,
      name,
      parentId: parent ? ids.get(parent)! : null,
      deform: true,
    })),
  }
}

test('Verity preset maps exactly 65 joints with COG as Hips and excludes original-rig helpers', () => {
  assert.equal(Object.keys(VERITY_TO_MIXAMO).length, 65)
  assert.equal(VERITY_TO_MIXAMO.COG, 'Hips')
  for (const excluded of ['Pelvis', 'Root', 'camera', 'Jaw', 'Wing_Bone_L', 'Jaw_end_end']) {
    assert.equal(VERITY_TO_MIXAMO[excluded], undefined)
  }
  const source = verityRig()
  const applied = applyMixamo65MappingPreset(createVerityMixamo65Preset(source, mixamoRig()), source, mixamoRig())
  assert.equal(Object.keys(applied.assignments).length, 65)
  assert.deepEqual(applied.missingSource, [])
  assert.deepEqual(applied.missingTarget, [])
  assert.equal(applied.assignments.Hips, source.bones.find((bone) => bone.name === 'COG')!.id)
})

test('intermediate skin collapses Pelvis, Jaw and wings to mapped ancestors and keeps 65-only names', () => {
  const parents = { Pelvis: 'COG', Jaw: 'Head', Wing_Bone_L: 'Chest', camera: 'Root', Root: null }
  const mapped = remapVerityInfluences([
    { bone: 'Pelvis', weight: 2 },
    { bone: 'Jaw', weight: 1 },
    { bone: 'Wing_Bone_L', weight: 1 },
    { bone: 'camera', weight: 10 },
  ], parents)
  assert.deepEqual(mapped, [
    { bone: 'Hips', weight: 0.5 },
    { bone: 'Head', weight: 0.25 },
    { bone: 'Spine2', weight: 0.25 },
  ])
  assert.ok(mapped.every(({ bone }) => MIXAMO65_BONE_PARENTS.some(([name]) => name === bone)))
})

test('inverse transform applies unit, floor, source basis and original Root action delta once', () => {
  const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
  const root = new Matrix4().makeRotationY(-0.3)
  const original = new Matrix4().compose(
    new Vector3(2, 3, -1),
    new Quaternion().setFromEuler(new Euler(0.2, -0.1, 0.05, 'XYZ')),
    new Vector3(1, 1, 1),
  )
  const sourceFacing = facing.clone().invert()
  const metresPerUnit = 0.5
  const nativePosition = new Vector3()
  const nativeRotation = new Quaternion()
  original.clone().premultiply(root.clone().invert()).decompose(nativePosition, nativeRotation, new Vector3())
  const solver = new Matrix4().compose(
    nativePosition.clone().sub(new Vector3(0, 0.4, 0)).applyQuaternion(sourceFacing).multiplyScalar(metresPerUnit),
    sourceFacing.clone().multiply(nativeRotation),
    new Vector3(1, 1, 1),
  )
  const roundTrip = solverWorldToVerity(solver, {
    metresPerUnit,
    groundUnits: 0.4,
    sourceFacingInverse: facing,
    rootActionDelta: root,
    restScale: new Vector3(1, 1, 1),
  })
  const expectedPosition = new Vector3()
  const actualPosition = new Vector3()
  const expectedRotation = new Quaternion()
  const actualRotation = new Quaternion()
  original.decompose(expectedPosition, expectedRotation, new Vector3())
  roundTrip.decompose(actualPosition, actualRotation, new Vector3())
  assert.ok(actualPosition.distanceTo(expectedPosition) <= 1e-10)
  assert.ok(actualRotation.angleTo(expectedRotation) <= 1e-7)
  assert.throws(() => solverWorldToVerity(solver, {
    metresPerUnit: 0,
    groundUnits: 0,
    sourceFacingInverse: facing,
    rootActionDelta: root,
    restScale: new Vector3(1, 1, 1),
  }), /positive finite unit/)
})

test('original-rig append preserves the raw prefix, all bones and original action while wings loop and Jaw rests', () => {
  const matrix = (x: number, y: number, z: number) => `1 0 0 ${x} 0 1 0 ${y} 0 0 1 ${z} 0 0 0 1`
  const bone = (name: string, parent: string | null, x: number, y: number, z: number) =>
    `arm_bone ${name}${parent ? ` ${parent}` : ''} ${x} ${y + 0.1} ${z} ${matrix(x, y, z)}`
  const mappedBones = Object.keys(VERITY_TO_MIXAMO).filter((name) => name !== 'COG').map((name, index) => {
    const leg = name === 'Upper_Leg_L' || name === 'Upper_Leg_R'
    const x = name === 'Upper_Leg_L' ? -0.2 : name === 'Upper_Leg_R' ? 0.2 : index * 0.001
    return bone(name, leg ? 'Pelvis' : 'Root', x, name === 'Head' ? 2 : 1.2, 0)
  })
  const originalActions = ['idle', 'crouching', 'crouching_idle', 'dead', 'dying', 'running', 'sprinting', 'swipe']
    .flatMap((name) => [`an ${name}`, 'ao Root', 'ag rotation 1', 'kf 0 0.5 LINEAR 0 0.5 0 0.5',
      ...(name === 'idle' ? ['ao Wing_Bone_L', 'ag rotation 2', 'kf 0 0 LINEAR 0 0 0 0', 'kf 2 0.4 LINEAR 2 0.4 2 0.4'] : [])])
  const prefix = [
    'arm_name verity.mdl',
    bone('Root', null, 0, 0, 0),
    bone('COG', 'Root', 0, 1, 0),
    bone('Pelvis', 'COG', 0, 1.1, 0),
    ...mappedBones,
    bone('Jaw', 'Head', 0, 1.9, 0.1),
    bone('Wing_Bone_L', 'COG', -0.4, 1.5, 0),
    bone('camera', 'Root', 0, -2, 0),
    bone('Jaw_end_end', 'Jaw', 0, 1.8, 0.1),
    ...Array.from({ length: 13 }, (_, index) => bone(`Helper_${index}`, 'Root', 0, 0, index * 0.01)),
    'o body',
    'v 0 0 0',
    'vw COG 1',
    ...originalActions,
  ].join('\r\n') + '\r\n'
  const dir = mkdtempSync(join(tmpdir(), 'verity-rig-'))
  const path = join(dir, 'model.bbs.bobj')
  writeFileSync(path, prefix)
  const model = loadVerityModel(path)
  const armature = parseBobjArmature(prefix)
  const rest = new Map(armature.bones.map((item) => [item.name, new Matrix4().fromArray([...item.restLocal])]))
  const frames = [0, 1, 2, 3].map((tick) => new Map(armature.bones.map((item) => {
    const local = rest.get(item.name)!.clone()
    if (item.name === 'COG') local.multiply(new Matrix4().makeTranslation(tick * 0.125, 0, 0))
    if (item.name === 'Wing_Bone_L') local.multiply(new Matrix4().makeRotationZ(tick * 0.2))
    return [item.name, local] as const
  })))
  const added: AddedAction[] = [{ name: 'new_idle', ticks: 3, frames }]
  const output = model.appendBobj(added)
  assert.equal(output.slice(0, prefix.length), prefix)
  assert.equal(model.boneCount, 84)
  assert.deepEqual(model.builtInActions, ['idle', 'crouching', 'crouching_idle', 'dead', 'dying', 'running', 'sprinting', 'swipe'])
  const parsed = parseBobjActions(output)
  assert.equal(parsed.get('idle')!.groups.get('Root')!.channels[0]!.keys[0]!.v, 0.5)
  assert.deepEqual([...parsed.keys()].slice(0, 8), model.builtInActions)
  assert.equal(parsed.get('new_idle')!.groups.has('Jaw'), false)
  assert.equal(parsed.get('new_idle')!.groups.has('Wing_Bone_L'), true)
  const error = model.roundTripError(output, added)
  console.log('Verity84 original-rig measurements', JSON.stringify({ bones: model.boneCount, originalActions: model.builtInActions.length, sampledTimestamps: 4, maxJointPositionErrorUnits: error }))
  assert.ok(error <= 1e-4)
})
