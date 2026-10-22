import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { bakeUniversalRetargetFrames, estimateUniversalBakeCost, universalFramesToAnimationClip } from '../src/universalBake.ts'
import { transferSkinWeights } from '../src/universalSkin.ts'
import { isMixamo65Topology, MIXAMO65_BONE_PARENTS, MIXAMO65_REFERENCE } from '../src/mixamo65.ts'
import { buildUniversalMappingSuggestions, createUniversalRetargeter, validateUniversalMapping, type RetargetRig } from '../src/universal.ts'

function transform(position: [number, number, number], rotation = new Quaternion()): number[] {
  return new Matrix4().compose(new Vector3(...position), rotation, new Vector3(1, 1, 1)).toArray()
}

const target: RetargetRig = { fingerprint: 'target', bones: [
  { id: 'hips', name: 'Hips', parentId: null, restWorld: transform([0, 1, 0]) },
  { id: 'spine', name: 'Spine', parentId: 'hips', restWorld: transform([0, 1.5, 0]) },
] }

test('rejects singular, projective, reflected, sheared matrices and animated source scale instead of dropping it', () => {
  const source: RetargetRig = { fingerprint: 'matrix-source', bones: [{ id: 'source', parentId: null, restWorld: transform([0, 0, 0]) }] }
  const pairs = [{ sourceBoneId: 'source', targetBoneId: 'hips', enabled: true }]
  for (const invalid of [new Matrix4().makeScale(0, 1, 1), new Matrix4().makeScale(-1, 1, 1)]) {
    assert.throws(() => createUniversalRetargeter({ ...source, bones: [{ ...source.bones[0]!, restWorld: invalid.toArray() }] }, target, pairs), /invertible/)
  }
  const solver = createUniversalRetargeter(source, target, pairs)
  const shear = new Matrix4(); shear.elements[4] = 0.5
  assert.throws(() => solver.evaluate([{ id: 'source', world: shear.toArray() }]), /shear/)
  const projective = new Matrix4(); projective.elements[3] = 0.5
  assert.throws(() => solver.evaluate([{ id: 'source', world: projective.toArray() }]), /affine/)
  assert.throws(() => solver.evaluate([{ id: 'source', world: new Matrix4().makeScale(2, 2, 2).toArray() }]), /animated scale/)
})

test('estimates node-sample and retained-frame memory before starting a large bake', () => {
  const ordinary = estimateUniversalBakeCost(120, 65, 900)
  assert.equal(ordinary.withinBudget, true)
  assert.equal(ordinary.nodeSamples, 166_500)
  assert.equal(estimateUniversalBakeCost(3_000, 65, 18_000).withinBudget, false)
  assert.equal(estimateUniversalBakeCost(120, 2_000, 18_000).withinBudget, false)
  assert.throws(() => estimateUniversalBakeCost(-1, 65, 30), /nonnegative bone counts/)
})

test('retargets distinct arbitrary source hierarchies against a shared target rest pose', () => {
  const sources: RetargetRig[] = [
    { fingerprint: 'a', bones: [{ id: 'pelvis', parentId: null, restWorld: transform([0, 1, 0]) }] },
    { fingerprint: 'b', bones: [{ id: 'root', parentId: null, restWorld: transform([2, 0, 0]) }, { id: 'Hips', parentId: 'root', restWorld: transform([2, 1, 0]) }] },
  ]
  for (const source of sources) {
    const mapped = source.bones.at(-1)!
    const solver = createUniversalRetargeter(source, target, [{ sourceBoneId: mapped.id, targetBoneId: 'hips', enabled: true }])
    const frames = solver.evaluate([{ id: mapped.id, world: transform([2, 1, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)) }, ...(source.bones.length > 1 ? [{ id: 'root', world: transform([2, 0, 0]) }] : [])])
    assert.equal(frames.length, 2)
    assert.deepEqual(frames[0]!.targetBoneId, 'hips')
    assert.ok(Math.abs(frames[0]!.rotation[2]! - Math.SQRT1_2) < 1e-6)
    assert.ok(Math.abs(frames[1]!.world[12]! - (source.bones.length > 1 ? -0.5 : 1.5)) < 1e-6)
    assert.ok(Math.abs(frames[1]!.world[13]! - 1) < 1e-6)
  }
})

test('retargets different source topologies into the pinned canonical Mixamo65 graph', () => {
  const restWorld = new Map<string, Matrix4>()
  const canonical: RetargetRig = { fingerprint: 'canonical65-multi-source', bones: MIXAMO65_BONE_PARENTS.map(([name, parent]) => {
    const rest = parent ? restWorld.get(parent)!.clone().multiply(new Matrix4().makeTranslation(0, 0.1, 0))
      : new Matrix4().makeTranslation(0, 1, 0)
    restWorld.set(name, rest)
    return { id: name, name, parentId: parent, restWorld: rest.toArray() }
  }) }
  assert.equal(isMixamo65Topology(canonical.bones.map((bone) => ({ ...bone, deform: true }))), true)
  const sources: RetargetRig[] = [
    { fingerprint: 'source-pelvis-root', bones: [
      { id: 'pelvis', parentId: null, restWorld: transform([0, 1, 0]) },
    ] },
    { fingerprint: 'source-with-origin-and-spine-helper', bones: [
      { id: 'origin', parentId: null, restWorld: transform([2, 0, 0]) },
      { id: 'helper', parentId: 'origin', restWorld: transform([2, 0.5, 0]) },
      { id: 'pelvis', parentId: 'helper', restWorld: transform([2, 1, 0]) },
    ] },
  ]
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 3)
  for (const source of sources) {
    const solver = createUniversalRetargeter(source, canonical, [{ sourceBoneId: 'pelvis', targetBoneId: 'Hips', enabled: true }])
    const sample = source.bones.map((bone) => ({ id: bone.id, world: bone.id === 'pelvis'
      ? transform(new Vector3().setFromMatrixPosition(new Matrix4().fromArray(bone.restWorld)).toArray() as [number, number, number], turn)
      : bone.restWorld }))
    const frames = solver.evaluate(sample)
    assert.equal(frames.length, 65)
    const hips = frames.find((frame) => frame.targetBoneId === 'Hips')!
    assert.ok(new Quaternion().fromArray(hips.rotation).angleTo(turn) < 1e-6, source.fingerprint)
  }
})

test('rejects cyclic targets, duplicate target mapping, and incomplete samples', () => {
  const cyclic: RetargetRig = { fingerprint: 'cycle', bones: [
    { id: 'a', parentId: 'b', restWorld: transform([0, 0, 0]) },
    { id: 'b', parentId: 'a', restWorld: transform([0, 1, 0]) },
  ] }
  assert.throws(() => createUniversalRetargeter({ fingerprint: 's', bones: [{ id: 's', parentId: null, restWorld: transform([0, 0, 0]) }] }, cyclic, [{ sourceBoneId: 's', targetBoneId: 'a', enabled: true }]), /cycle/)
  const source: RetargetRig = { fingerprint: 's', bones: [{ id: 's', parentId: null, restWorld: transform([0, 0, 0]) }] }
  assert.throws(() => createUniversalRetargeter(source, target, [
    { sourceBoneId: 's', targetBoneId: 'hips', enabled: true }, { sourceBoneId: 's', targetBoneId: 'hips', enabled: true },
  ]), /more than once/)
  assert.throws(() => createUniversalRetargeter(source, target, [{ sourceBoneId: 's', targetBoneId: 'hips', enabled: true }]).evaluate([]), /missing mapped source/)
})

test('mapped child offsets follow the parent without losing root translation', () => {
  const source: RetargetRig = { fingerprint: 'chain', bones: [
    { id: 'pelvis', parentId: null, restWorld: transform([0, 1, 0]) },
    { id: 'chest', parentId: 'pelvis', restWorld: transform([0, 2, 0]) },
  ] }
  const quarterTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const solver = createUniversalRetargeter(source, target, [
    { sourceBoneId: 'pelvis', targetBoneId: 'hips', enabled: true },
    { sourceBoneId: 'chest', targetBoneId: 'spine', enabled: true },
  ])
  const frames = solver.evaluate([{ id: 'pelvis', world: transform([3, 1, 0], quarterTurn) },
    { id: 'chest', world: transform([2, 1, 0], quarterTurn) }])
  assert.ok(new Vector3().fromArray(frames[1]!.position).distanceTo(new Vector3(0, 0.5, 0)) < 1e-6)
  assert.ok(new Vector3().setFromMatrixPosition(new Matrix4().fromArray(frames[1]!.world)).distanceTo(new Vector3(2.5, 1, 0)) < 1e-6)
})

test('mapped wrists preserve animated local translation in the forearm frame while finger translation stays out', () => {
  const sourceForearmRest = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
  const source: RetargetRig = { fingerprint: 'wrist-source', bones: [
    { id: 'srcHips', name: 'Hips', parentId: null, restWorld: transform([0, 0, 0]) },
    { id: 'srcForearm', name: 'LeftForeArm', parentId: 'srcHips', restWorld: transform([0, 1, 0]) },
    { id: 'srcHand', name: 'LeftHand', parentId: 'srcForearm', restWorld: transform([0, 1, 1], sourceForearmRest) },
    { id: 'srcFinger', name: 'LeftHandIndex1', parentId: 'srcHand', restWorld: transform([0.1, 1, 1], sourceForearmRest) },
  ] }
  const target: RetargetRig = { fingerprint: 'wrist-target', bones: [
    { id: 'dstHips', name: 'Hips', parentId: null, restWorld: transform([0, 0, 0]) },
    { id: 'dstForearm', name: 'LeftForeArm', parentId: 'dstHips', restWorld: transform([0, 1, 0]) },
    { id: 'dstHand', name: 'LeftHand', parentId: 'dstForearm', restWorld: transform([0, 2, 0]) },
    { id: 'dstFinger', name: 'LeftHandIndex1', parentId: 'dstHand', restWorld: transform([0.1, 2, 0]) },
  ] }
  const solver = createUniversalRetargeter(source, target, [
    { sourceBoneId: 'srcHips', targetBoneId: 'dstHips', enabled: true },
    { sourceBoneId: 'srcForearm', targetBoneId: 'dstForearm', enabled: true },
    { sourceBoneId: 'srcHand', targetBoneId: 'dstHand', enabled: true },
    { sourceBoneId: 'srcFinger', targetBoneId: 'dstFinger', enabled: true },
  ])
  const sample = [
    { id: 'srcHips', world: source.bones[0]!.restWorld },
    { id: 'srcForearm', world: source.bones[1]!.restWorld },
    { id: 'srcHand', world: transform([0, 1, 1.25], sourceForearmRest) },
    { id: 'srcFinger', world: transform([0.1, 1, 1.35], sourceForearmRest) },
  ]
  const frames = solver.evaluate(sample)
  const hand = frames.find((frame) => frame.targetBoneId === 'dstHand')!
  const finger = frames.find((frame) => frame.targetBoneId === 'dstFinger')!
  assert.ok(new Vector3().setFromMatrixPosition(new Matrix4().fromArray(hand.world)).distanceTo(new Vector3(0, 2, 0.25)) < 1e-6)
  assert.ok(new Vector3().setFromMatrixPosition(new Matrix4().fromArray(finger.world)).distanceTo(new Vector3(0.1, 2, 0.25)) < 1e-6)
})

test('transfers a world rotation delta across distinct rest axes and an unmapped target container', () => {
  const sourceRest = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
  const targetRest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
  const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 3)
  const source: RetargetRig = { fingerprint: 'axis-source', bones: [{ id: 'pelvis', parentId: null, restWorld: transform([0, 1, 0], sourceRest) }] }
  const other: RetargetRig = { fingerprint: 'axis-target', bones: [
    { id: 'container', parentId: null, restWorld: transform([0, 0, 0]) },
    { id: 'hips', parentId: 'container', restWorld: transform([0, 2, 0], targetRest) },
  ] }
  const pose = createUniversalRetargeter(source, other, [{ sourceBoneId: 'pelvis', targetBoneId: 'hips', enabled: true }])
    .evaluate([{ id: 'pelvis', world: transform([4, 1, 0], delta.clone().multiply(sourceRest)) }])
  const actual = new Quaternion().fromArray(pose[1]!.rotation)
  assert.ok(actual.angleTo(delta.clone().multiply(targetRest)) < 1e-6)
  assert.ok(Math.abs(pose[1]!.world[12]! - 4) < 1e-6)
})

test('suggests unique normalized bone names and leaves duplicate names for manual mapping', () => {
  const source: RetargetRig = { fingerprint: 's', bones: [
    { id: 'mixamorig:Hips', parentId: null, restWorld: transform([0, 0, 0]) },
    { id: 'LeftArm', parentId: 'mixamorig:Hips', restWorld: transform([1, 1, 0]) },
  ] }
  const other: RetargetRig = { fingerprint: 't', bones: [
    { id: 'Hips', parentId: null, restWorld: transform([0, 0, 0]) },
    { id: 'left_arm', parentId: 'Hips', restWorld: transform([1, 1, 0]) },
    { id: 'mixamorig:LeftArm', parentId: 'Hips', restWorld: transform([-1, 1, 0]) },
  ] }
  const suggestions = buildUniversalMappingSuggestions(source, other)
  assert.ok(suggestions.some((item) => item.sourceBoneId === 'mixamorig:Hips' && item.targetBoneId === 'Hips'))
  assert.ok(suggestions.some((item) => item.targetBoneId === null && item.ambiguousTarget))
})

test('reports unmapped required target joints and invalid mappings before baking', () => {
  const source: RetargetRig = { fingerprint: 'report-source', bones: [{ id: 'root', parentId: null, restWorld: transform([0, 0, 0]) }] }
  const result = validateUniversalMapping(source, target, [{ sourceBoneId: 'root', targetBoneId: 'hips', enabled: true }], ['hips', 'spine', 'missing'])
  assert.deepEqual(result.missingRequiredTargetBoneIds, ['spine', 'missing'])
  assert.ok(result.errors.some((error) => error.code === 'REQUIRED_TARGET_BONE_MISSING'))
  assert.deepEqual(result.unmappedTargetBoneIds, ['spine'])
})

test('merges an ordered source bone chain with equal-mean rotation and primary-owned root travel', () => {
  const source: RetargetRig = { fingerprint: 'chain-source', bones: [
    { id: 'root', name: 'Root', parentId: null, restWorld: transform([0, 0, 0]) },
    { id: 'mid', name: 'Mid', parentId: 'root', restWorld: transform([0, 1, 0]) },
    { id: 'end', name: 'End', parentId: 'mid', restWorld: transform([0, 2, 0]) },
  ] }
  const quarterTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const pair = { sourceBoneId: 'mid', sourceBoneIds: ['mid', 'end'], targetBoneId: 'hips', enabled: true }
  const report = validateUniversalMapping(source, target, [pair], ['hips'])
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.unmappedSourceBoneIds, ['root'])
  const solver = createUniversalRetargeter(source, target, [pair])
  const result = solver.evaluate([
    { id: 'root', world: transform([0, 0, 0]) },
    { id: 'mid', world: transform([2, 1, 0]) },
    { id: 'end', world: transform([4, 2, 0], quarterTurn) },
  ])[0]!
  assert.ok(new Quaternion().fromArray(result.rotation).angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4)) < 1e-6)
  assert.ok(Math.abs(result.world[12]! - 2) < 1e-6)
  assert.throws(() => createUniversalRetargeter(source, target, [{ ...pair, sourceBoneId: 'end', sourceBoneIds: ['end', 'mid'] }]), /ancestor-ordered/)
})

test('chain weights control rotation while the primary source bone keeps root travel ownership', () => {
  const source: RetargetRig = { fingerprint: 'weighted-chain-source', bones: [
    { id: 'root', parentId: null, restWorld: transform([0, 0, 0]) },
    { id: 'mid', parentId: 'root', restWorld: transform([0, 1, 0]) },
    { id: 'end', parentId: 'mid', restWorld: transform([0, 2, 0]) },
  ] }
  const quarterTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const pair = { sourceBoneId: 'mid', sourceBoneIds: ['mid', 'end'], sourceBoneWeights: [1, 3], targetBoneId: 'hips', enabled: true }
  const result = createUniversalRetargeter(source, target, [pair]).evaluate([
    { id: 'root', world: transform([0, 0, 0]) },
    { id: 'mid', world: transform([2, 1, 0]) },
    { id: 'end', world: transform([4, 2, 0], quarterTurn) },
  ])[0]!
  const expectedAngle = 2 * Math.atan2(3 * Math.sin(Math.PI / 4), 1 + 3 * Math.cos(Math.PI / 4))
  assert.ok(new Quaternion().fromArray(result.rotation).angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), expectedAngle)) < 1e-6)
  assert.ok(Math.abs(result.world[12]! - 2) < 1e-6)
  const baseDisabled = createUniversalRetargeter(source, target, [{ ...pair, sourceBoneWeights: [0, 1] }]).evaluate([
    { id: 'root', world: transform([0, 0, 0]) },
    { id: 'mid', world: transform([2, 1, 0]) },
    { id: 'end', world: transform([4, 2, 0], quarterTurn) },
  ])[0]!
  assert.ok(Math.abs(baseDisabled.world[12]! - 2) < 1e-6)
  for (const weights of [[1], [-1, 2], [0, 0], [Number.NaN, 1]]) {
    assert.throws(() => createUniversalRetargeter(source, target, [{ ...pair, sourceBoneWeights: weights }]), /weight/i)
  }
})

test('local chain composition removes shared parent motion and composes weighted local deltas ancestor-first', () => {
  const sourceRootRest = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.2)
  const sourceMidRest = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3)
  const sourceEndRest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -0.25)
  const source: RetargetRig = { fingerprint: 'local-compose-source', bones: [
    { id: 'root', parentId: null, restWorld: transform([0, 0, 0], sourceRootRest) },
    { id: 'mid', parentId: 'root', restWorld: transform([0, 1, 0], sourceRootRest.clone().multiply(sourceMidRest)) },
    { id: 'end', parentId: 'mid', restWorld: transform([0, 2, 0], sourceRootRest.clone().multiply(sourceMidRest).multiply(sourceEndRest)) },
  ] }
  const targetRootRest = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.35)
  const targetHipsRest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4)
  const targetRig: RetargetRig = { fingerprint: 'local-compose-target', bones: [
    { id: 'targetRoot', parentId: null, restWorld: transform([0, 0, 0], targetRootRest) },
    { id: 'targetHips', parentId: 'targetRoot', restWorld: transform([0, 1, 0], targetRootRest.clone().multiply(targetHipsRest)) },
  ] }
  const parentDelta = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const midDelta = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
  const endDelta = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
  const alignment = targetRootRest.clone().multiply(sourceRootRest.clone().invert())
  const sample = [
    { id: 'root', world: transform([0, 0, 0], parentDelta.clone().multiply(sourceRootRest)) },
    { id: 'mid', world: transform([0, 1, 0], parentDelta.clone().multiply(sourceRootRest).multiply(midDelta).multiply(sourceMidRest)) },
    { id: 'end', world: transform([0, 2, 0], parentDelta.clone().multiply(sourceRootRest).multiply(midDelta).multiply(sourceMidRest).multiply(endDelta).multiply(sourceEndRest)) },
  ]
  const pair = { sourceBoneId: 'mid', sourceBoneIds: ['mid', 'end'], sourceBoneWeights: [1, 1], chainComposition: 'local-compose', targetBoneId: 'targetHips', enabled: true }
  const calibration = { sourceReference: source.bones.map((bone) => ({ id: bone.id, world: bone.restWorld })),
    targetReference: targetRig.bones.map((bone) => ({ id: bone.id, world: bone.restWorld })),
    alignmentRotation: alignment.toArray() as [number, number, number, number], corrections: [] }
  const expected = midDelta.clone().multiply(endDelta).multiply(targetHipsRest)
  const full = createUniversalRetargeter(source, targetRig, [pair], 1, 'in-place', calibration).evaluate(sample).find((bone) => bone.targetBoneId === 'targetHips')!
  assert.ok(new Quaternion().fromArray(full.rotation).angleTo(expected) < 1e-6, `got ${full.rotation}; expected ${expected.toArray()}`)
  const endOnly = createUniversalRetargeter(source, targetRig, [{ ...pair, sourceBoneWeights: [0, 1] }], 1, 'in-place', calibration).evaluate(sample).find((bone) => bone.targetBoneId === 'targetHips')!
  assert.ok(new Quaternion().fromArray(endOnly.rotation).angleTo(endDelta.clone().multiply(targetHipsRest)) < 1e-6)
  assert.throws(() => createUniversalRetargeter(source, targetRig, [{ ...pair, sourceBoneWeights: [0, 1.01] }]), /local-compose weights/)
})

test('universal reference calibration maps its source reference to the selected target reference and rotates root travel once', () => {
  const sourceRestRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 4)
  const sourceReferenceRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const targetReferenceRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3)
  const sourceRig: RetargetRig = { fingerprint: 'cal-source', bones: [{ id: 'srcRoot', parentId: null, restWorld: transform([0, 0, 0], sourceRestRotation) }] }
  const targetRig: RetargetRig = { fingerprint: 'cal-target', bones: [{ id: 'dstRoot', parentId: null, restWorld: transform([0, 0, 0]) }] }
  const alignment = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const calibration = {
    sourceReference: [{ id: 'srcRoot', world: transform([3, 0, 0], sourceReferenceRotation) }],
    targetReference: [{ id: 'dstRoot', world: transform([2, 0, 0], targetReferenceRotation) }],
    alignmentRotation: alignment.toArray() as [number, number, number, number],
    corrections: [],
  }
  const restCalibration = { sourceReference: sourceRig.bones.map((bone) => ({ id: bone.id, world: bone.restWorld })),
    targetReference: targetRig.bones.map((bone) => ({ id: bone.id, world: bone.restWorld })),
    alignmentRotation: [0, 0, 0, 1] as [number, number, number, number], corrections: [] }
  const pair = [{ sourceBoneId: 'srcRoot', targetBoneId: 'dstRoot', enabled: true }]
  const sample = [{ id: 'srcRoot', world: transform([0.3, 0.2, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4).multiply(sourceRestRotation)) }]
  const legacy = createUniversalRetargeter(sourceRig, targetRig, pair).evaluate(sample)[0]!
  const restDefault = createUniversalRetargeter(sourceRig, targetRig, pair, 1, 'preserve', restCalibration).evaluate(sample)[0]!
  assert.ok(legacy.world.every((value, index) => Math.abs(value - restDefault.world[index]!) < 1e-6))
  const solver = createUniversalRetargeter(sourceRig, targetRig, pair, 1, 'preserve', calibration)
  const atReference = solver.evaluate(calibration.sourceReference)[0]!
  assert.ok(new Quaternion().fromArray(atReference.rotation).angleTo(targetReferenceRotation) < 1e-6)
  assert.ok(Math.abs(atReference.world[12]! - 2) < 1e-6)
  const moved = solver.evaluate([{ id: 'srcRoot', world: transform([4, 0, 0], sourceReferenceRotation) }])[0]!
  assert.ok(Math.abs(moved.world[12]! - 2) < 1e-6)
  assert.ok(Math.abs(moved.world[13]! - 1) < 1e-6)
  assert.throws(() => createUniversalRetargeter(sourceRig, targetRig, pair, 1, 'preserve', {
    ...calibration, sourceReference: [],
  }), /every rig bone/)
})

test('bakes sampled retarget frames into named Three.js tracks and enforces frame limits', () => {
  const source: RetargetRig = { fingerprint: 'bake-source', bones: [{ id: 'hips', parentId: null, restWorld: transform([0, 1, 0]) }] }
  const solver = createUniversalRetargeter(source, target, [{ sourceBoneId: 'hips', targetBoneId: 'hips', enabled: true }])
  const frames = bakeUniversalRetargetFrames(solver, (time) => [{ id: 'hips', world: transform([time, 1, 0]) }], { startFrame: 0, endFrame: 2, fps: 30 })
  const clip = universalFramesToAnimationClip(frames, 'walk')
  assert.equal(clip.name, 'walk')
  assert.ok(clip.tracks.some((track) => track.name === 'Hips.position'))
  assert.equal(clip.tracks.length, target.bones.length * 3)
  assert.throws(() => bakeUniversalRetargetFrames(solver, () => [], { startFrame: 0, endFrame: 18_000, fps: 30 }), /limited/)
})

test('transfers and normalizes skin weights while reporting influence loss', () => {
  const result = transferSkinWeights([{ influences: [
    { boneId: 'twist', weight: 0.25 }, { boneId: 'arm', weight: 0.5 }, { boneId: 'arm', weight: 0.25 },
  ] }], new Map([['twist', 'upperArm'], ['arm', 'forearm']]), 1)
  assert.deepEqual(result.vertices[0]!.influences, [{ boneId: 'forearm', weight: 1 }])
  assert.equal(result.affectedVertices, 1)
  assert.equal(result.droppedWeight, 0.25)
  assert.throws(() => transferSkinWeights([{ influences: [{ boneId: 'wing', weight: 1 }] }], new Map()), /unmapped source joint/)
})

test('identifies Mixamo65 by the complete pinned parent graph, not joint count alone', () => {
  const ids = new Map(MIXAMO65_BONE_PARENTS.map(([name], index) => [name, `j${index}`]))
  const bones = MIXAMO65_BONE_PARENTS.map(([name, parent], index) => ({
    id: `j${index}`, name: `mixamorig:${name}`, parentId: parent ? ids.get(parent)! : 'armature', deform: true,
  })).concat([{ id: 'armature', name: 'RigContainer', parentId: null, deform: false }]).map((bone) => ({
    ...bone, parentId: bone.parentId === 'armature' ? 'armature' : bone.parentId,
  }))
  assert.equal(MIXAMO65_BONE_PARENTS.length, 65)
  assert.equal(isMixamo65Topology(bones), true)
  const changed = bones.map((bone) => ({ ...bone }))
  changed.find((bone) => bone.name.endsWith(':LeftArm'))!.parentId = ids.get('Spine2')!
  assert.equal(isMixamo65Topology(changed), false)
  assert.equal(isMixamo65Topology(bones.slice(1)), false)
})

test('locks the canonical Mixamo65 topology to the licensed built-in GLB fixture', async () => {
  const file = new URL(`../../../../builtin-assets/characters/${MIXAMO65_REFERENCE.assetId}.glb`, import.meta.url)
  const bytes = await readFile(file)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), MIXAMO65_REFERENCE.sha256)
  const jsonLength = bytes.readUInt32LE(12)
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as { nodes: Array<{ name?: string; children?: number[] }>; skins: Array<{ joints: number[] }> }
  const parents = new Map<number, number>()
  gltf.nodes.forEach((node, index) => node.children?.forEach((child) => parents.set(child, index)))
  const joints = gltf.skins[0]!.joints
  const jointSet = new Set(joints)
  const profile = joints.map((index) => ({ id: String(index), name: gltf.nodes[index]!.name!,
    parentId: jointSet.has(parents.get(index)!) ? String(parents.get(index)) : null, deform: true }))
  assert.equal(profile.length, 65)
  assert.equal(isMixamo65Topology(profile), true)
})
