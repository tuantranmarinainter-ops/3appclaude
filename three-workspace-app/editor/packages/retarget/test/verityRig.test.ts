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
  projectVerityFrame,
  remapVerityInfluences,
  solverWorldToVerity,
  VERITY_TO_MIXAMO,
} from '../src/verityRig.ts'
import type { MappingSkeleton } from '../src/mapping.ts'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
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
  const matrix = (x: number, y: number, z: number, yaw = 0) => {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    return `${c} 0 ${s} ${x} 0 1 0 ${y} ${-s} 0 ${c} ${z} 0 0 0 1`
  }
  const bone = (name: string, parent: string | null, x: number, y: number, z: number, yaw = 0) =>
    `arm_bone ${name}${parent ? ` ${parent}` : ''} ${x} ${y + 0.1} ${z} ${matrix(x, y, z, yaw)}`
  const mappedBones = Object.keys(VERITY_TO_MIXAMO).filter((name) => name !== 'COG').map((name, index) => {
    const leg = name === 'Upper_Leg_L' || name === 'Upper_Leg_R'
    const x = name === 'Upper_Leg_L' ? -0.2 : name === 'Upper_Leg_R' ? 0.2 : index * 0.001
    return bone(name, leg ? 'Pelvis' : name === 'Head' ? 'COG' : 'Root', x, name === 'Head' ? 2 : 1.2, 0)
  })
  const originalActions = ['idle', 'crouching', 'crouching_idle', 'dead', 'dying', 'running', 'sprinting', 'swipe']
    .flatMap((name) => [`an ${name}`, 'ao Root', 'ag rotation 1', `kf 0 ${Math.PI / 2} LINEAR 0 ${Math.PI / 2} 0 ${Math.PI / 2}`,
      ...(name === 'idle' ? ['ao Wing_Bone_L', 'ag rotation 2', 'kf 0 0 LINEAR 0 0 0 0', 'kf 2 0.4 LINEAR 2 0.4 2 0.4'] : [])])
  const prefix = [
    'arm_name verity.mdl',
    bone('Root', null, 0, 0, 0),
    bone('COG', 'Root', 0, 1, 0),
    bone('Pelvis', 'COG', 0, 1.1, 0, 0.25),
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
  const restWorld = new Map(armature.bones.map((item) => [item.name, new Matrix4().fromArray([...item.restWorld])]))
  const rootDelta = new Matrix4().makeRotationY(Math.PI / 2)
  const facingInverse = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -0.37)
  const facing = facingInverse.clone().invert(), unit = 0.4915394, ground = -0.23
  const toSolver = (nativeWorld: Matrix4) => {
    const inner = rootDelta.clone().invert().multiply(nativeWorld)
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
    inner.decompose(position, rotation, scale)
    position.sub(new Vector3(0, ground, 0)).multiplyScalar(unit).applyQuaternion(facing)
    rotation.premultiply(facing)
    return new Matrix4().compose(position, rotation, scale)
  }
  const legacyWorkbenchInverse = (solverWorld: Matrix4, restScale: Vector3) => {
    const position = new Vector3(), rotation = new Quaternion()
    solverWorld.decompose(position, rotation, new Vector3())
    return rootDelta.clone().multiply(new Matrix4().compose(
      position.multiplyScalar(1 / unit).applyQuaternion(facingInverse).add(new Vector3(0, ground, 0)),
      facingInverse.clone().multiply(rotation),
      restScale,
    ))
  }
  const projected = [0, 1, 2, 3].map((tick) => {
    const cogNative = rootDelta.clone().multiply(restWorld.get('COG')!)
      .multiply(new Matrix4().makeTranslation(tick * 0.125, 0.02 * tick, -0.03 * tick))
      .multiply(new Matrix4().makeRotationY(0.08 * tick))
    const headNative = rootDelta.clone().multiply(restWorld.get('Head')!)
      .multiply(new Matrix4().makeRotationX(0.07 * tick))
    const solverWorlds = new Map([['Hips', toSolver(cogNative)], ['Head', toSolver(headNative)]])
    const wingLocals = new Map([['Wing_Bone_L', rest.get('Wing_Bone_L')!.clone().multiply(new Matrix4().makeRotationZ(0.2 * (tick % 2)))]])
    const frame = projectVerityFrame(solverWorlds, armature.bones.map((item) => ({
      name: item.name, parent: item.parent, restWorld: restWorld.get(item.name)!, restLocal: rest.get(item.name)!,
    })), { metresPerUnit: unit, groundUnits: ground, sourceFacingInverse: facingInverse, rootActionDelta: rootDelta },
    'Root', rootDelta, wingLocals)
    const frameWorlds = new Map<string, Matrix4>()
    for (const item of armature.bones) frameWorlds.set(item.name, (item.parent ? frameWorlds.get(item.parent)!.clone() : new Matrix4()).multiply(frame.get(item.name)!))
    for (const [source, target] of [['COG', 'Hips'], ['Head', 'Head']] as const) {
      const restScale = new Vector3(); restWorld.get(source)!.decompose(new Vector3(), new Quaternion(), restScale)
      const legacy = legacyWorkbenchInverse(solverWorlds.get(target)!, restScale)
      assert.ok(Math.max(...legacy.elements.map((value, index) => Math.abs(value - frameWorlds.get(source)!.elements[index]!))) <= 1e-10)
    }
    return frame
  })
  const frames = projected
  const added: AddedAction[] = [{ name: 'new_idle', ticks: 3, frames }]
  const output = model.appendBobj(added)
  assert.equal(output.slice(0, prefix.length), prefix)
  assert.equal(model.boneCount, 84)
  assert.deepEqual(model.builtInActions, ['idle', 'crouching', 'crouching_idle', 'dead', 'dying', 'running', 'sprinting', 'swipe'])
  const parsed = parseBobjActions(output)
  assert.equal(parsed.get('idle')!.groups.get('Root')!.channels[0]!.keys[0]!.v, Math.PI / 2)
  assert.deepEqual([...parsed.keys()].slice(0, 8), model.builtInActions)
  assert.equal(parsed.get('new_idle')!.groups.has('Jaw'), false)
  assert.equal(parsed.get('new_idle')!.groups.has('Wing_Bone_L'), true)
  const written = parsed.get('new_idle')!
  let maxPositionError = 0, maxHipAngle = 0, maxHeadAngle = 0
  for (const tick of [0, 1, 2, 3]) {
    const actual = new Map(evaluateBobjAction(armature, written, tick).map((item) => [item.name, new Matrix4().fromArray([...item.worldMatrix])]))
    const expected = new Map<string, Matrix4>()
    for (const item of armature.bones) expected.set(item.name, (item.parent ? expected.get(item.parent)!.clone() : new Matrix4()).multiply(frames[tick]!.get(item.name)!))
    for (const name of ['COG', 'Head']) {
      const a = new Vector3().setFromMatrixPosition(actual.get(name)!), e = new Vector3().setFromMatrixPosition(expected.get(name)!)
      maxPositionError = Math.max(maxPositionError, a.distanceTo(e))
    }
    const direction = (worlds: Map<string, Matrix4>) => new Vector3().setFromMatrixPosition(worlds.get('Upper_Leg_L')!)
      .sub(new Vector3().setFromMatrixPosition(worlds.get('Upper_Leg_R')!)).normalize()
    maxHipAngle = Math.max(maxHipAngle, direction(actual).angleTo(direction(expected)))
    const aq = new Quaternion(), eq = new Quaternion()
    actual.get('Head')!.decompose(new Vector3(), aq, new Vector3()); expected.get('Head')!.decompose(new Vector3(), eq, new Vector3())
    maxHeadAngle = Math.max(maxHeadAngle, aq.angleTo(eq))
  }
  const referenceWorld = solverWorldToVerity(toSolver(rootDelta.clone().multiply(restWorld.get('COG')!)), {
    metresPerUnit: unit, groundUnits: ground, sourceFacingInverse: facingInverse, rootActionDelta: rootDelta, restScale: new Vector3(1, 1, 1),
  })
  const referenceExpected = rootDelta.clone().multiply(restWorld.get('COG')!)
  assert.ok(Math.max(...referenceWorld.elements.map((value, index) => Math.abs(value - referenceExpected.elements[index]!))) <= 1e-10)
  console.log('Verity84 original-rig measurements', JSON.stringify({ bones: model.boneCount, originalActions: model.builtInActions.length,
    sampledTimestamps: 4, maxJointPositionErrorUnits: maxPositionError, maxHipAngleDegrees: maxHipAngle * 180 / Math.PI, maxHeadAngleDegrees: maxHeadAngle * 180 / Math.PI }))
  assert.ok(maxPositionError <= 1e-4)
  assert.ok(maxHipAngle * 180 / Math.PI <= 2)
  assert.ok(maxHeadAngle * 180 / Math.PI <= 2)
})
