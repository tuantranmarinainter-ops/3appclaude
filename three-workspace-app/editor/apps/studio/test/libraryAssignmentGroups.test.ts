import assert from 'node:assert/strict'
import test from 'node:test'
import { ASSIGNMENT_GROUPS, assignmentActions, assignmentGroup, assignmentTargetRig, loadAssignmentPages } from '../app/library/components/assignment/utils'
import { filterLibraryActions } from '../src/libraryFilters'

test('MC20 assignment includes own, other owners and shared MC20, plus true Mixamo only', () => {
  const rows = [
    { uuid: 'own', rig: 'minecraft20', ownerCharId: 'den', name: 'Đứng' },
    { uuid: 'hero', rig: 'minecraft20', ownerCharId: 'hero', name: 'Chạy' },
    { uuid: 'shared', rig: 'minecraft20', name: 'Đi bộ' },
    { uuid: 'mix', rig: 'mixamo65', name: 'Run' },
    { uuid: 'verity', rig: 'mixamo65', skeletonKind: 'verity', ownerCharId: 'verity', name: 'Native' },
    { uuid: 'ambiguous', rig: 'mixamo65+verity', name: 'Unknown' },
  ]
  const actions = assignmentActions([...rows, rows[1]!], 'den')
  assert.deepEqual(actions.map(row => row.uuid), ['own', 'hero', 'shared', 'mix'])
  assert.deepEqual(actions.map(row => assignmentGroup(row, 'den')), ['own', 'minecraft', 'minecraft', 'mixamo'])
  assert.equal(filterLibraryActions(actions, 'chay', '').length, 1)
  assert.deepEqual(ASSIGNMENT_GROUPS.map(group => group.label), ['Của nhân vật này', 'Mixamo65 (tự chuyển)', 'Minecraft20 cùng rig'])
})

test('canonical loader follows all pages, retaining actions outside selected owner', async () => {
  const offsets: number[] = []
  const loaded = await loadAssignmentPages(async offset => {
    offsets.push(offset)
    return { total: 203, items: Array.from({ length: Math.min(100, 203 - offset) }, (_, i) => ({ uuid: String(offset + i), rig: 'minecraft20', ownerCharId: offset + i === 202 ? 'hero' : 'den' })) }
  })
  assert.deepEqual(offsets, [0, 100, 200])
  assert.equal(assignmentActions(loaded, 'den').length, 203)
  assert.equal(assignmentGroup(loaded[202]!, 'den'), 'minecraft')
})

test('empty page terminates even if a stale total is reported', async () => {
  assert.deepEqual(await loadAssignmentPages(async () => ({ total: 10, items: [] })), [])
})

test('target groups follow the actual project skeleton and native base, not selected library filter', () => {
  assert.equal(assignmentTargetRig('minecraft20'), 'minecraft20')
  assert.equal(assignmentTargetRig('custom-preserved', 'minecraft20'), 'minecraft20')
  assert.equal(assignmentTargetRig('mixamo65', 'minecraft20'), 'mixamo65')
  assert.equal(assignmentTargetRig('custom-preserved', 'verity'), 'custom-preserved')
})
