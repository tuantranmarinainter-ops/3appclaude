import assert from 'node:assert/strict'
import test from 'node:test'
import { boneLinePositions } from '../app/workbench/components/normalization/previewUtils'

const bones = [
  { id: 'root', parentId: null, restWorld: [] },
  { id: 'spine', parentId: 'root', restWorld: [] },
]

test('bone preview lines use sampled world transforms and separate the target stage horizontally', () => {
  const worlds = new Map([['root', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 1]], ['spine', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 4, 3, 1]]])
  assert.deepEqual([...boneLinePositions(bones, worlds, 2)], [3, 2, 3, 3, 4, 3])
})

test('bone preview reports incomplete samples instead of drawing broken segments', () => {
  assert.throws(() => boneLinePositions(bones, new Map()), /missing bone world transform/)
})
