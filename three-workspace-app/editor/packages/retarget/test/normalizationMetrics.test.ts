import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { createNormalizationMetrics } from '../src/normalizationMetrics.ts'
import { createUniversalRetargeter } from '../src/universal.ts'

test('consistency metrics detect changed output rotation/root/segment rather than imply semantic quality', () => {
  const rig = { fingerprint: 'metric-rig', bones: [
    { id: 'root', parentId: null, restWorld: new Matrix4().toArray() },
    { id: 'child', parentId: 'root', restWorld: new Matrix4().makeTranslation(0, 1, 0).toArray() },
  ] }
  const pairs = rig.bones.map((bone) => ({ sourceBoneId: bone.id, targetBoneId: bone.id, enabled: true }))
  const sample = rig.bones.map((bone) => ({ id: bone.id, world: bone.restWorld }))
  const result = createUniversalRetargeter(rig, rig, pairs).evaluate(sample)
  const correct = createNormalizationMetrics(rig, rig, pairs, 'preserve', 1)
  correct.observe(sample, result)
  assert.equal(correct.report().rootTranslationMaxErrorMeters, 0)
  assert.equal(correct.report().segmentLengthMaxErrorMeters, 0)
  assert.equal(correct.report().semanticMappingAccuracy, null)
  assert.equal(correct.report().contactDrift, null)
  result[0]!.world = new Matrix4().compose(new Vector3(2, 0, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(1, 1, 1)).toArray()
  const wrong = createNormalizationMetrics(rig, rig, pairs, 'preserve', 1)
  wrong.observe(sample, result)
  assert.ok(Math.abs(wrong.report().mappedRotationMaxDegrees - 90) < 1e-6)
  assert.equal(wrong.report().rootTranslationMaxErrorMeters, 2)
  assert.ok(wrong.report().segmentLengthMaxErrorMeters > 1)
})

test('normalization metrics use the same weighted quaternion mean as the retarget solver', () => {
  const source = { fingerprint: 'weighted-source', bones: [
    { id: 'root', parentId: null, restWorld: new Matrix4().toArray() },
    { id: 'mid', parentId: 'root', restWorld: new Matrix4().makeTranslation(0, 1, 0).toArray() },
    { id: 'end', parentId: 'mid', restWorld: new Matrix4().makeTranslation(0, 2, 0).toArray() },
  ] }
  const target = { fingerprint: 'weighted-target', bones: [{ id: 'hips', parentId: null, restWorld: new Matrix4().toArray() }] }
  const weights = [1, 3], pair = { sourceBoneId: 'mid', sourceBoneIds: ['mid', 'end'], sourceBoneWeights: weights, targetBoneId: 'hips', enabled: true }
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const sample = [
    { id: 'root', world: new Matrix4().toArray() },
    { id: 'mid', world: new Matrix4().makeTranslation(2, 1, 0).toArray() },
    { id: 'end', world: new Matrix4().compose(new Vector3(4, 2, 0), turn, new Vector3(1, 1, 1)).toArray() },
  ]
  const result = createUniversalRetargeter(source, target, [pair]).evaluate(sample)
  const metrics = createNormalizationMetrics(source, target, [pair], 'preserve', 1)
  metrics.observe(sample, result)
  assert.ok(metrics.report().mappedRotationMaxDegrees! < 1e-5)
  assert.ok(metrics.report().rootTranslationMaxErrorMeters < 1e-6)
})
