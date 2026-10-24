import assert from 'node:assert/strict'
import test from 'node:test'
import { mappingTransaction } from '../workbench/public/mapping-transaction.js'

const row = (target, source) => ({ target, source, original: source, via: 'alias' })
const unique = (rows) => {
  const sources = rows.map(row => row.source).filter(Boolean)
  assert.equal(new Set(sources).size, sources.length)
}
test('moves an alias atomically, preserves input and restores the complete prior transaction', () => {
  const rows = [row('LeftLeg', 'L_Foot'), row('LeftFoot', null), row('RightFoot', 'R_Foot')]
  const snapshot = structuredClone(rows)
  const tx = mappingTransaction(rows, 'LeftFoot', 'L_Foot')
  assert.deepEqual(rows, snapshot)
  assert.deepEqual(tx.before, snapshot)
  assert.equal(tx.rows[0].source, null)
  assert.equal(tx.rows[0].via, null)
  assert.equal(tx.rows[0].needsChoice, true)
  assert.equal(tx.rows[1].source, 'L_Foot')
  assert.equal(tx.rows[1].needsChoice, false)
  unique(tx.rows); unique(tx.before)
})
test('clears all hidden collisions, including optional joints, and repairs unrelated imported duplicates', () => {
  const rows = [row('LeftLeg', 'L_Foot'), row('LeftToeBase', 'L_Foot'), row('LeftFoot', 'L_Foot'), row('Head', 'head'), row('Neck', 'head')]
  const tx = mappingTransaction(rows, 'LeftFoot', 'L_Foot')
  assert.equal(tx.rows[2].source, 'L_Foot')
  for (const i of [0, 1, 4]) {
    assert.equal(tx.rows[i].source, null)
    assert.equal(tx.rows[i].needsChoice, true)
  }
  unique(tx.rows); unique(tx.before)
})
test('self assignment and missing targets are no-ops; clearing and choosing again removes the warning', () => {
  const rows = [row('LeftFoot', 'L_Foot'), row('LeftLeg', null)]
  assert.equal(mappingTransaction(rows, 'LeftFoot', 'L_Foot'), null)
  assert.equal(mappingTransaction(rows, 'unknown', 'L_Foot'), null)
  const cleared = mappingTransaction(rows, 'LeftFoot', null)
  assert.equal(cleared.rows[0].source, null)
  const moved = mappingTransaction(rows, 'LeftLeg', 'L_Foot')
  const chosen = mappingTransaction(moved.rows, 'LeftFoot', 'L_Foot')
  assert.equal(chosen.rows[0].needsChoice, false)
  unique(chosen.rows)
})
