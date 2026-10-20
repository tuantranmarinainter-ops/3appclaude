import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createFrameSnapshot } from '../../evaluate/FrameSnapshot'
import { applyMotionAndPose } from '../objects/applySnapshot'
import type { StageGraph } from '../objects/graph'
import type { CharInstance } from '../objects/types'

function bone(name: string, parent: THREE.Object3D, x: number, y: number): THREE.Bone {
  const b = new THREE.Bone()
  b.name = name
  b.position.set(x, y, 0)
  parent.add(b)
  return b
}

function setup() {
  const root = new THREE.Group()
  const inner = new THREE.Group()
  root.add(inner)
  const hips = bone('mixamorigHips', inner, 0, 1)
  const spine = bone('mixamorigSpine', hips, 0, 0.2)
  const chest = bone('mixamorigSpine1', spine, 0, 0.2)
  const shoulder = bone('mixamorigLeftShoulder', chest, 0.1, 0.1)
  const arm = bone('mixamorigLeftArm', shoulder, 0.1, 0)
  const forearm = bone('mixamorigLeftForeArm', arm, 0.3, 0)
  bone('mixamorigLeftHand', forearm, 0.3, 0)
  const restPose = new Map<string, THREE.Quaternion>()
  root.traverse((o) => { if (o.name) restPose.set(o.name, o.quaternion.clone()) })
  const node = {
    id: 'c1', name: 'C', type: 'character' as const, visible: true, locked: false,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    character: { animation: { mode: 'pose', controlValues: { lArmRaise: 60, torsoTurn: 20 } as Record<string, number> } },
  }
  const ch = {
    node, root, inner, rig: 'mixamorig', restPose, restPos: new Map(),
    animator: { stopAll() {}, playAt() {} },
  } as unknown as CharInstance
  let jointBusy = false
  let motionLoaded = true
  const graph = {
    doc: { content: { timeline: { animation: { motionClips: [{ id: 'x', motion: { assetId: 'm' }, playback: { version: 1, speed: 1, loop: true, loopMode: 'repeat' } }] } } } },
    motionPlayer: { getClipForDirectBind: () => (motionLoaded ? {} : null) },
    scene: new THREE.Scene(), nodeById: new Map([['c1', node]]),
    characters: new Map([['c1', ch]]), props: new Map(), primitives: new Map(), groups: new Map(),
    cameras: new Map(), poseBank: new Map(),
    poseJointBusy: () => jointBusy,
    poseJointNodeId: () => 'c1',
  } as unknown as StageGraph
  const quats = () => [arm, chest].map((b) => b.quaternion.toArray())
  return {
    graph, ch, node, arm, quats,
    setJointBusy: (v: boolean) => { jointBusy = v },
    setMotionLoaded: (v: boolean) => { motionLoaded = v },
  }
}

function frame(playing = false) {
  const snap = createFrameSnapshot()
  if (playing) snap.motionPlayback.push({ nodeId: 'c1', clipId: 'x', timeSeconds: 0 } as never)
  return snap
}

function assertSame(a: number[][], b: number[][]) {
  a.forEach((q, i) => q.forEach((v, j) => assert.ok(Math.abs(v - b[i][j]) < 1e-9, `${i}[${j}] ${v} ≠ ${b[i][j]}`)))
}

test('姿势输入不变时不重算，骨骼保持上次结果', () => {
  const { graph, arm } = setup()
  applyMotionAndPose(graph, frame())
  assert.ok(arm.quaternion.angleTo(new THREE.Quaternion()) > 0.1, '抬臂应写进骨骼')
  arm.quaternion.identity()
  applyMotionAndPose(graph, frame())
  assert.ok(arm.quaternion.angleTo(new THREE.Quaternion()) < 1e-9, '签名相同应跳过解算')
})

test('旋钮或缩放变化后重算，结果与首次解算一致', () => {
  const { graph, ch, node, quats } = setup()
  applyMotionAndPose(graph, frame())
  const solved = quats()
  node.character.animation.controlValues = { ...node.character.animation.controlValues, lArmRaise: 10 }
  applyMotionAndPose(graph, frame())
  node.character.animation.controlValues = { ...node.character.animation.controlValues, lArmRaise: 60 }
  applyMotionAndPose(graph, frame())
  assertSame(quats(), solved)
  ch.root.scale.set(2, 2, 2)
  const before = ch.poseCache!.sig
  applyMotionAndPose(graph, frame())
  assert.notEqual(ch.poseCache!.sig, before)
})

test('播放动作片段或关节拖拽后切回姿势必须重算', () => {
  const { graph, arm, quats, setJointBusy } = setup()
  applyMotionAndPose(graph, frame())
  const solved = quats()

  applyMotionAndPose(graph, frame(true))
  arm.quaternion.identity()
  applyMotionAndPose(graph, frame())
  assertSame(quats(), solved)

  setJointBusy(true)
  applyMotionAndPose(graph, frame())
  arm.quaternion.identity()
  setJointBusy(false)
  applyMotionAndPose(graph, frame())
  assertSame(quats(), solved)
})

test('动作素材未加载时片段不覆盖，姿势缓存保持有效', () => {
  const { graph, ch, quats, setMotionLoaded } = setup()
  applyMotionAndPose(graph, frame())
  const solved = quats()
  setMotionLoaded(false)
  applyMotionAndPose(graph, frame(true))
  assert.ok(ch.poseCache, '片段没播出来，骨骼还是姿势结果')
  assertSame(quats(), solved)
})
