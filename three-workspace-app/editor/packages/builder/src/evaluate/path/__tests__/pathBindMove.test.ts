import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../../contract/emptyDraft'
import type { PathMotionClip } from '../../../contract/types'
import { positionMoved, userPathBindingAtFrame } from '../pathBindMove'

const CAM = {
  fov: 50,
  position: { x: 0, y: 1.7, z: 5 },
  rotation: { x: 0, y: 0, z: 0 },
  lookAt: { x: 0, y: 1.2, z: 0 },
}

function clip(lockedReason?: string): PathMotionClip {
  return {
    id: 'path_clip',
    target: { type: 'node', nodeId: 'prop_1' },
    pathNodeId: 'path_1',
    pathName: '轨迹',
    frameStart: 0,
    frameEnd: 48,
    pathStartPercent: 0,
    pathEndPercent: 100,
    direction: 'forward',
    facing: 'path-tangent',
    playback: { version: 1, speed: 1, loop: false, loopMode: 'ping-pong', baseDurationFrames: 48 },
    pathLength: 2,
    status: 'active',
    source: 'semantic',
    locked: false,
    lockedReason,
  }
}

test('当前帧的用户轨迹算绑定，派生走位和片段外不算', () => {
  const doc = makeEmptyDraft('path', 24, 120, CAM)
  doc.content.nodes.push({
    id: 'prop_1',
    type: 'prop',
    name: 'Box',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    prop: { category: 'box' },
  })
  doc.content.timeline.animation.pathMotionClips = [clip()]
  assert.equal(userPathBindingAtFrame(doc, 'prop_1', 10), true)
  assert.equal(userPathBindingAtFrame(doc, 'prop_1', 80), false)
  doc.content.timeline.animation.pathMotionClips = [clip('derived-from-keyframes')]
  assert.equal(userPathBindingAtFrame(doc, 'prop_1', 10), false)
  assert.equal(positionMoved({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), true)
  assert.equal(positionMoved([0, 0, 0], [0, 0, 0]), false)
})
