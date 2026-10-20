import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Bone, Group } from 'three'
import { fbxSourceBones } from '../../evaluate/retarget/fbxSourceBones'

test('FBX skeleton profiles exclude only identity aliases of the same source model bone', () => {
  const root = new Group()
  const hips = Object.assign(new Bone(), { name: 'Hips', ID: 10 })
  hips.userData.transformData = {}
  hips.userData.originalName = 'Hips'
  hips.position.y = 100
  const alias = Object.assign(new Bone(), { name: 'Hips', ID: 10 })
  alias.userData.originalName = 'Hips'
  root.add(hips); hips.add(alias)
  assert.deepEqual(fbxSourceBones(root), [hips])
  assert.equal(hips.children[0], alias)
  assert.equal(alias.parent, hips)
  assert.equal(fbxSourceBones(root.clone()).length, 1)
  alias.position.x = 1
  assert.throws(() => fbxSourceBones(root), /duplicate bone name/)
  alias.position.x = 0
  alias.ID = 11
  assert.throws(() => fbxSourceBones(root), /duplicate bone name/)
  alias.ID = 10
  alias.userData.transformData = {}
  assert.throws(() => fbxSourceBones(root), /duplicate bone name/)
})
