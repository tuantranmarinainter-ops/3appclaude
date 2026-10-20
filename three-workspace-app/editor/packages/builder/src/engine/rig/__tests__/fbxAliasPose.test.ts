import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as THREE from 'three'
import { applyPose } from '../applyPose'
import { fbxSourceBones } from '../../../evaluate/retarget/fbxSourceBones'

test('pose reset and library application leave FBX multi-mesh bone aliases at identity', () => {
  const root = new THREE.Group()
  const hips = new THREE.Bone(), alias = new THREE.Bone()
  hips.name = alias.name = 'mixamorigHips'
  hips.userData = { originalName: hips.name, transformData: {} }
  alias.userData.originalName = hips.name
  hips.rotation.x = 0.3; hips.position.y = 100
  root.add(hips); hips.add(alias)
  const rest = new Map([[hips.name, hips.quaternion.clone()]])
  for (const library of [undefined, { mixamorigHips: [0, 0, 0, 1] as const }]) {
    applyPose(root, rest, {}, undefined, library)
    assert.deepEqual(alias.quaternion.toArray(), [0, 0, 0, 1])
    assert.deepEqual(alias.position.toArray(), [0, 0, 0])
    assert.deepEqual(fbxSourceBones(root), [hips])
  }
})
