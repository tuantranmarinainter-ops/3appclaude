import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import { PoseLibraryBank } from '../../data/poseLibraryBank'
import { DirectorDoc } from '../../document/DirectorDoc'
import { buildCharacterNode } from '../../evaluate/studioIntents'
import { applyPosePresets, resetPoses, type LibraryHost } from '../libraryActions'

function hostWith(ids: string[], locked: string[] = []) {
  const doc = makeEmptyDraft('poses', 24, 48)
  const model = new DirectorDoc()
  model.replace(doc)
  for (const id of ids) {
    const node = buildCharacterNode(doc, {
      type: 'add-character',
      libraryId: 'lib',
      name: id,
      modelUrl: 'm.glb',
      nodeId: id,
    })
    if (locked.includes(id)) node.locked = true
    doc.content.nodes.push(node)
  }
  model.touch()
  const snapshots: string[] = []
  const host = {
    docModel: model,
    engine: { poseBank: new PoseLibraryBank() },
    pushDocSnapshot(label: string) {
      snapshots.push(label)
    },
  } as unknown as LibraryHost
  return { host, doc, snapshots }
}

test('applyPosePresets writes the same pose onto every unlocked character in one undo', () => {
  const { host, doc, snapshots } = hostWith(['a', 'b', 'c'], ['c'])
  const error = applyPosePresets(host, ['a', 'b', 'c', 'missing'], 'sit')
  assert.equal(error, null)
  assert.deepEqual(snapshots, ['应用姿势预设'])
  for (const id of ['a', 'b']) {
    const anim = doc.content.nodes.find((node) => node.id === id)?.character?.animation
    assert.equal(anim?.mode, 'pose')
    assert.equal(anim?.posePresetId, 'sit')
    assert.equal(anim?.rootPositionOffset?.y, -0.28)
  }
  const locked = doc.content.nodes.find((node) => node.id === 'c')?.character?.animation
  assert.notEqual(locked?.posePresetId, 'sit')
})

test('resetPoses clears every unlocked character in one undo', () => {
  const { host, doc, snapshots } = hostWith(['a', 'b'])
  applyPosePresets(host, ['a', 'b'], 'sit')
  const error = resetPoses(host, ['a', 'b'])
  assert.equal(error, null)
  assert.deepEqual(snapshots, ['应用姿势预设', '重置姿势'])
  for (const id of ['a', 'b']) {
    const anim = doc.content.nodes.find((node) => node.id === id)?.character?.animation
    assert.equal(anim?.posePresetId, undefined)
    assert.deepEqual(anim?.controlValues, {})
    assert.deepEqual(anim?.rootPositionOffset, { x: 0, y: 0, z: 0 })
  }
})

test('applyPosePresets rejects an unknown preset before mutating', () => {
  const { host, doc, snapshots } = hostWith(['a'])
  const before = doc.content.nodes[0]?.character?.animation.posePresetId
  const error = applyPosePresets(host, ['a'], 'not-a-pose')
  assert.equal(error, 'preset-not-found')
  assert.deepEqual(snapshots, [])
  assert.equal(doc.content.nodes[0]?.character?.animation.posePresetId, before)
})
