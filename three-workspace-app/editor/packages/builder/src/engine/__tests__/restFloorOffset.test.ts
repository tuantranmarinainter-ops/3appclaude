import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createFrameSnapshot } from '../../evaluate/FrameSnapshot'
import { applyMotionAndPose } from '../objects/applySnapshot'
import type { StageGraph } from '../objects/graph'

// B24: library character (Gỗ Xưa) whose rest pose stands on y=0 but whose node kept a stale
// rootPositionOffset (-0.3205) after the library link removed posePresetId.
const SCALE = 1.8947369861703993

function setup(animation: Record<string, unknown>) {
  const node = {
    id: 'g', name: 'G', type: 'character' as const, visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: SCALE, y: SCALE, z: SCALE } },
    character: { animation },
  }
  const root = new THREE.Group(); root.scale.setScalar(SCALE)
  const inner = new THREE.Group(); root.add(inner)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.9, 0.2)); body.position.y = 0.95; inner.add(body) // bind minY = 0
  const clip = { id: 'c', motion: { assetId: 'm' }, playback: { version: 1, speed: 1, loop: true, loopMode: 'repeat' } }
  const graph = {
    doc: { content: { timeline: { animation: { motionClips: [clip] } } } },
    scene: new THREE.Scene(), nodeById: new Map([['g', node]]),
    characters: new Map([['g', { node, root, inner, rig: 'direct', restPose: new Map(), restPos: new Map(), animator: { playAt() {}, stopAll() {} } }]]),
    props: new Map(), primitives: new Map(), groups: new Map(), cameras: new Map(), poseBank: new Map(),
    motionPlayer: { getClipForDirectBind: () => ({}), getRaw: () => null },
  } as unknown as StageGraph
  const minY = () => { root.updateMatrixWorld(true); return new THREE.Box3().setFromObject(root).min.y }
  const run = (playing: boolean) => {
    const snap = createFrameSnapshot()
    if (playing) snap.motionPlayback.push({ nodeId: 'g', clipId: 'c', timeSeconds: 0 } as never)
    applyMotionAndPose(graph, snap)
    return minY()
  }
  return { run, inner }
}

test('rest pose with stale rootPositionOffset and no posePresetId stays on the floor; clip frame unchanged', () => {
  const stale = { mode: 'pose', controlValues: {}, rootPositionOffset: { x: 0.000293, y: -0.320459, z: -0.00036 } }
  const { run, inner } = setup(stale)
  assert.ok(Math.abs(run(false)) < 0.01, 'rest minY ' + minOf(run(false)))
  assert.equal(inner.position.y, 0)
  assert.ok(Math.abs(run(true)) < 0.01, 'clip frame minY')
})

test('a real pose preset (sit) still sinks the root by its offset', () => {
  const { run, inner } = setup({ mode: 'pose', posePresetId: 'sit', controlValues: {}, rootPositionOffset: { x: 0, y: -0.3, z: 0 } })
  assert.ok(Math.abs(run(false) - -0.3 * SCALE) < 0.01)
  assert.equal(inner.position.y, -0.3)
  run(true)
  assert.equal(inner.position.y, 0)
})

function minOf(n: number) { return n.toFixed(4) }
