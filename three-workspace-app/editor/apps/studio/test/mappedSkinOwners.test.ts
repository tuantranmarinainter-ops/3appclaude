import assert from 'node:assert/strict'
import test from 'node:test'
import type { SkeletonMapping, SkeletonProfile } from '@bbs/animation-workspace-shared'
import { mappedSkinOwners } from '../app/workbench/components/normalization/modelUtils.ts'

test('every source bone in an ordered mapping chain defaults to the target joint as skin owner', () => {
  const source = { bones: [{ id: 'spine', name: 'Spine' }, { id: 'twist', name: 'SpineTwist' }] } as SkeletonProfile
  const target = { bones: [{ id: 'mixamo-spine', name: 'Spine' }] } as SkeletonProfile
  const mapping = { pairs: [{ sourceBoneId: 'spine', sourceBoneIds: ['spine', 'twist'], targetBoneId: 'mixamo-spine', enabled: true }] } as SkeletonMapping

  assert.deepEqual(mappedSkinOwners(mapping, source, target), { Spine: 'Spine', SpineTwist: 'Spine' })
})
