import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRigTreeRows } from '../app/workbench/components/normalization/RigTree'

const bones = [
  { id: 'root', name: 'Armature', parentId: null, restWorld: [] },
  { id: 'hips', name: 'Hips', parentId: 'root', restWorld: [] },
  { id: 'spine', name: 'Spine', parentId: 'hips', restWorld: [] },
  { id: 'wing', name: 'Wing.L', parentId: 'root', restWorld: [] },
]

test('rig tree collapses branches and search keeps matching bones with their ancestors', () => {
  assert.deepEqual(buildRigTreeRows(bones, new Set()).map(({ bone }) => bone.id), ['root'])
  assert.deepEqual(buildRigTreeRows(bones, new Set(['root', 'hips'])).map(({ bone }) => bone.id), ['root', 'hips', 'spine', 'wing'])
  assert.deepEqual(buildRigTreeRows(bones, new Set(), 'wing.l').map(({ bone }) => bone.id), ['root', 'wing'])
})

test('rig tree search is case-insensitive and empty matches are explicit', () => {
  assert.deepEqual(buildRigTreeRows(bones, new Set(), 'SPINE').map(({ bone }) => bone.id), ['root', 'hips', 'spine'])
  assert.deepEqual(buildRigTreeRows(bones, new Set(), 'missing'), [])
})
