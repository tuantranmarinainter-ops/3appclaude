// 相机旋转关键帧的中间过渡：只改一根轴（典型是 Y）时，另两轴在整段过渡里必须保持关键帧的值。
//
// 根因：旋转键存的是 XYZ 欧拉角，而同一个朝向有两组欧拉表示 (x,y,z) ≡ (x+180, 180−y, z+180)。
// 纯绕 Y 转超过 90° 时，Three.js 从四元数 / 矩阵读回来的是后一组（纯 Y 150° → (180, 30, 180)）。
// 逐分量插值 (0,0,0) → (180,30,180) 会让 X、Z 从 0 摆到 180，看上去像「改 Y 联动 X/Z」。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import type { DraftNode } from '../../contract/types'
import { alignEulerDeg, makeKeyframe, type Keyframe } from '../curves/KeyframeTrack'
import { sceneFromDocument } from '../sceneFromDocument'
import type { SceneContract, TransformValue } from '../FrameSnapshot'
import { evalAt } from './helpers'

const D2R = Math.PI / 180

function camNode(): DraftNode {
  return {
    id: 'cam',
    type: 'camera',
    name: '机位',
    visible: true,
    locked: false,
    transform: {
      position: { x: 0, y: 1.6, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    camera: {
      projection: 'perspective',
      fov: 50,
      fovAxis: 'vertical',
      near: 0.1,
      far: 2000,
      isPrimary: true,
      lookAt: { x: 0, y: 1.2, z: 0 },
    },
  }
}

/** 线性插值的键：中间帧的期望值可以直接算出来 */
function linearKey(frame: number, value: number[]): Keyframe {
  return { ...makeKeyframe(frame, value), interpolation: 'linear' }
}

function sceneWithRotationKeys(keys: Keyframe[]): SceneContract {
  const doc = makeEmptyDraft('cam-rot-keys', 30, 120)
  doc.content.nodes.push(camNode())
  return sceneFromDocument(doc, {
    fcurves: null,
    userKeys: { cam: { rotation: keys } },
    userKeysEnabled: true,
    chainCameraMotion: false,
  })
}

function camAt(scene: SceneContract, frame: number): TransformValue {
  return evalAt(scene, frame).transforms.get('cam')!
}

function near(actual: number, expected: number, label: string, eps = 1e-6): void {
  assert.ok(Math.abs(actual - expected) < eps, `${label}：${actual} ≠ ${expected}`)
}

test('只改 Y（普通表示）：X / Z 全程保持关键帧的值', () => {
  const scene = sceneWithRotationKeys([linearKey(0, [-10, 0, 0]), linearKey(60, [-10, 90, 0])])
  for (const frame of [0, 10, 20, 30, 40, 50, 60]) {
    const rot = camAt(scene, frame).rotation
    near(rot.x, -10, `frame ${frame} X`)
    near(rot.y, (90 * frame) / 60, `frame ${frame} Y`)
    near(rot.z, 0, `frame ${frame} Z`)
  }
})

test('只改 Y 超过 90°（引擎读回等价欧拉）：X / Z 不再摆到 180', () => {
  // 纯 Y 150° 被读回成 (180, 30, 180)
  const scene = sceneWithRotationKeys([linearKey(0, [0, 0, 0]), linearKey(60, [180, 30, 180])])
  for (const frame of [0, 10, 20, 30, 40, 50, 60]) {
    const rot = camAt(scene, frame).rotation
    near(rot.x, 0, `frame ${frame} X`)
    near(rot.y, (150 * frame) / 60, `frame ${frame} Y`)
    near(rot.z, 0, `frame ${frame} Z`)
  }
})

test('等价欧拉键：中间帧视线方向 = 绕 Y 平滑转动的方向', () => {
  const scene = sceneWithRotationKeys([linearKey(0, [0, 0, 0]), linearKey(60, [180, 30, 180])])
  for (const frame of [15, 30, 45]) {
    const xf = camAt(scene, frame)
    const yaw = ((150 * frame) / 60) * D2R
    const look = xf.lookAt!
    const dist = Math.hypot(look.x - xf.position.x, look.y - xf.position.y, look.z - xf.position.z)
    // 相机朝 -Z 看，绕 Y 转 yaw：水平面内转，高度不变
    near(look.x - xf.position.x, -Math.sin(yaw) * dist, `frame ${frame} 视线 x`, 1e-9)
    near(look.y - xf.position.y, 0, `frame ${frame} 视线 y（不该抬头 / 低头）`, 1e-9)
    near(look.z - xf.position.z, -Math.cos(yaw) * dist, `frame ${frame} 视线 z`, 1e-9)
  }
})

test('多键连续：每一段都按单轴过渡，键点上表示不跳变', () => {
  // 150° 与 120° 都以等价表示写入
  const scene = sceneWithRotationKeys([
    linearKey(0, [0, 0, 0]),
    linearKey(30, [180, 30, 180]),
    linearKey(60, [180, 60, 180]),
  ])
  const expectY = (frame: number) => (frame <= 30 ? (150 * frame) / 30 : 150 + (-30 * (frame - 30)) / 30)
  for (const frame of [0, 10, 20, 29, 30, 31, 40, 50, 60]) {
    const rot = camAt(scene, frame).rotation
    near(rot.x, 0, `frame ${frame} X`)
    near(rot.y, expectY(frame), `frame ${frame} Y`)
    near(rot.z, 0, `frame ${frame} Z`)
  }
})

test('末键之后钉住最后一键，首键之前钉住第一键', () => {
  const scene = sceneWithRotationKeys([linearKey(10, [0, 0, 0]), linearKey(60, [180, 30, 180])])
  const before = camAt(scene, 0).rotation
  near(before.x, 0, '首键前 X')
  near(before.y, 0, '首键前 Y')
  const after = camAt(scene, 100).rotation
  near(after.x, 0, '末键后 X')
  near(after.y, 150, '末键后 Y')
  near(after.z, 0, '末键后 Z')
})

test('真实的俯仰变化不会被当成等价表示翻掉', () => {
  const scene = sceneWithRotationKeys([linearKey(0, [0, 0, 0]), linearKey(60, [-60, 0, 0])])
  for (const frame of [0, 30, 60]) {
    const rot = camAt(scene, frame).rotation
    near(rot.x, (-60 * frame) / 60, `frame ${frame} X`)
    near(rot.y, 0, `frame ${frame} Y`)
    near(rot.z, 0, `frame ${frame} Z`)
  }
})

test('alignEulerDeg：选离上一键最近的等价表示，单轴不变的轴向钉死', () => {
  assert.deepEqual(alignEulerDeg([0, 0, 0], [180, 30, 180]), [0, 150, 0])
  assert.deepEqual(alignEulerDeg([0, 0, 0], [100, 0, 0]), [100, 0, 0])
  // pitch / roll 差一整圈时折到最近的等价值，不绕一整圈
  assert.deepEqual(alignEulerDeg([0, 0, 0], [350, 0, 0]), [-10, 0, 0])
  assert.deepEqual(alignEulerDeg([180, 30, 180], [-180, 60, -180]), [180, 60, 180])
  // 浮点噪声级别的差异视为没动
  assert.deepEqual(alignEulerDeg([0, 0, 0], [1e-5, 45, -1e-5]), [0, 45, 0])
  // Y 保持用户写入的圈数，不做整圈折叠
  assert.deepEqual(alignEulerDeg([0, 0, 0], [0, 270, 0]), [0, 270, 0])
})
