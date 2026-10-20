import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DraftNode, MotionClip } from '../../contract/types'
import { FCurveSet } from '../../evaluate/curves/FCurveSet'
import { duplicateDocumentNodes } from '../duplicateDocumentNodes'

test('duplicateDocumentNodes copies node, motion clip and FCurves without mutating its input', () => {
  const document = makeEmptyDraft('duplicate-document', 30, 60)
  const actor: DraftNode = {
    id: 'actor', type: 'character', name: 'Actor', visible: true, locked: false,
    transform: { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    character: { placeholder: false, gender: 'unknown', motionId: null, appearance: { color: '#7fb2e0' }, label: { showLabel: true, scale: 1, yOffset: 0 }, animation: { mode: 'pose', posePresetId: 'tpose', controlValues: {} } },
  }
  document.content.nodes.push(actor)
  const clip: MotionClip = {
    id: 'motion-1', source: 'library', sourceDuration: 1, frameStart: 0, frameEnd: 30,
    target: { type: 'character', nodeId: actor.id },
    playback: { version: 1, speed: 1, loop: false, loopMode: 'none' },
    motion: { assetId: 'walk', name: 'Walk', source: 'library', sourceRig: 'mixamorig', url: 'walk.fbx', inPlace: true, loop: false, speed: 1, time: 0 },
  }
  document.content.timeline.animation.motionClips.push(clip)
  const curves = FCurveSet.empty()
  curves.upsertKey(actor.id, 'transform.position', 0, 0, 1)
  const fcurves = FCurveSet.persist(curves, {})
  const original = JSON.stringify({ document, fcurves })

  const result = duplicateDocumentNodes({ document, fcurves, selectedIds: [actor.id], delta: { position: [2, 0, 0] } })
  const cloneId = result.nodeIdMap[actor.id]!
  const clone = result.document.content.nodes.find((node) => node.id === cloneId)!
  assert.equal(clone.transform.position.x, 3)
  assert.equal(result.clipIdMap[clip.id], result.document.content.timeline.animation.motionClips.find((item) => item.id !== clip.id)!.id)
  assert.equal(result.document.content.timeline.animation.motionClips.find((item) => item.id === result.clipIdMap[clip.id])?.target.nodeId, cloneId)
  assert.equal(FCurveSet.parse(result.fcurves).tracksForNode(cloneId)[0]?.keys[0]?.value, 3)
  assert.notEqual(FCurveSet.parse(result.fcurves).tracksForNode(cloneId)[0]?.keys[0]?.id, curves.tracksForNode(actor.id)[0]?.keys[0]?.id)
  assert.notEqual(cloneId, actor.id)
  assert.equal(JSON.stringify({ document, fcurves }), original)
})
