import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalJoint, DEFAULT_JOINT_SETTINGS, jointSettings, showJointLabel } from '../workbench/public/joint-overlay.js'

test('joint display validates persisted values without accepting invalid CSS or non-finite sizes', () => {
  assert.deepEqual(jointSettings(null), DEFAULT_JOINT_SETTINGS)
  assert.deepEqual(jointSettings({ points: 'false', color: 'red;display:none', size: Infinity, labels: 1, fontSize: NaN, scope: 'bogus' }), DEFAULT_JOINT_SETTINGS)
  assert.deepEqual(jointSettings({ points: false, color: '#abcdef', size: 99, labels: true, fontSize: 1, scope: 'all' }), { points: false, color: '#abcdef', size: 20, labels: true, fontSize: 8, scope: 'all' })
})

test('label scopes distinguish selected and unmapped joints, independent of point visibility', () => {
  for (const points of [true, false]) {
    for (const selected of [true, false]) for (const mapped of [true, false]) {
      const settings = { ...DEFAULT_JOINT_SETTINGS, points, labels: true }
      assert.equal(showJointLabel({ ...settings, scope: 'all' }, selected, mapped), true)
      assert.equal(showJointLabel({ ...settings, scope: 'selected' }, selected, mapped), selected)
      assert.equal(showJointLabel({ ...settings, scope: 'unmapped' }, selected, mapped), !mapped)
      assert.equal(showJointLabel({ ...settings, labels: false }, selected, mapped), false)
    }
  }
  assert.equal(canonicalJoint('mixamorig:Hips'), 'Hips')
  assert.equal(canonicalJoint('mixamorigLeftArm'), 'LeftArm')
  assert.equal(canonicalJoint('joint_Hip'), 'joint_Hip')
})
