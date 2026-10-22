import assert from 'node:assert/strict'
import test from 'node:test'
import { describeExtraBones, forExtendedRig, isExtraBoneName, MIXAMO65_BONE_PARENTS } from './extra_bones.js'

const core = { id: 'b0', name: 'Hips', parent: null, rest: { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } }
const extra = (id, name, parent, p = [0, 0.1, 0]) => ({ id, name, parent, rest: { p, q: [0, 0, 0, 1], s: [1, 1, 1] } })
const mixamo65 = () => {
  const ids = new Map(), records = []
  for (const [name, parent] of MIXAMO65_BONE_PARENTS) {
    const id = 'core-' + name
    records.push({ id, name, parent: parent ? ids.get(parent) : null, rest: { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } })
    ids.set(name, id)
  }
  return { ids, records }
}

test('recognizes and describes v1.1 extra-bone chains with local rest transforms', () => {
  const records = [core, extra('b1', 'X_Hips_Tail1', 'b0'), extra('b2', 'X_Hips_Tail2', 'b1', [0, 0.2, 0])]
  assert.equal(isExtraBoneName('X_Head_Jaw'), true)
  const { ids: coreIds, records: headCoreRecords } = mixamo65()
  assert.equal(describeExtraBones([...headCoreRecords, extra('head-extra', 'X_HeadTop_End_1', coreIds.get('HeadTop_End'))])[0].parent, 'HeadTop_End')
  assert.deepEqual(describeExtraBones(records), [
    { name: 'X_Hips_Tail1', parent: 'Hips', rest: { position: [0, 0.1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    { name: 'X_Hips_Tail2', parent: 'X_Hips_Tail1', rest: { position: [0, 0.2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
  ])
  const { ids, records: coreRecords } = mixamo65()
  assert.equal(forExtendedRig([...coreRecords, extra('extra1', 'X_Hips_Tail1', ids.get('Hips')), extra('extra2', 'X_Hips_Tail2', 'extra1')], 'Mixamo').length, 2)
})

test('rejects an extra whose named core attachment is not an ancestor', () => {
  const records = [core, extra('b1', 'X_Spine_Tail1', 'b0')]
  assert.throws(() => describeExtraBones(records), /core ancestor/)
})

test('rejects malformed names, duplicate names, and non-finite rest values', () => {
  assert.throws(() => describeExtraBones([core, extra('b1', 'X_Hips_', 'b0')]), /Invalid extra bone name/)
  assert.throws(() => describeExtraBones([core, extra('b1', 'X_Hips_Jaw', 'b0'), extra('b2', 'X_Hips_Jaw', 'b0')]), /duplicate bone names/)
  assert.throws(() => describeExtraBones([core, extra('b1', 'X_Hips_Jaw', 'b0', [NaN, 0, 0])]), /invalid rest transform/)
})

test('keeps ordinary rigs on the v1.0 path and rejects non-Mixamo extras', () => {
  assert.deepEqual(forExtendedRig([core], 'Mixamo'), [])
  assert.throws(() => forExtendedRig([core, extra('b1', 'X_Hips_Jaw', 'b0')], 'Other'), /Mixamo65 core/)
  const { records } = mixamo65()
  assert.deepEqual(forExtendedRig(records, 'Mixamo'), [])
})
