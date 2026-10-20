import assert from 'node:assert/strict'
import { test } from 'vitest'
import { makeEmptyDraft } from '../../contract/emptyDraft'
import { bakeCameraMotionPoses } from '../camera/bakeMotion'
import { PREVIEW_FRONT, previewCameraMotionPoses } from '../camera/previewLibraryPoses'
import { CAMERA_MOTIONS, CAMERA_PRESETS, type CameraMotionPreset, type CameraPreset } from '../../data/cameraLibrary'

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function requirePreset(id: string): CameraPreset {
  const found = CAMERA_PRESETS.find((item) => item.id === id)
  if (!found) throw new Error(`missing preset ${id}`)
  return found
}

function requireMotion(id: string): CameraMotionPreset {
  const found = CAMERA_MOTIONS.find((item) => item.id === id)
  if (!found) throw new Error(`missing motion ${id}`)
  return found
}

test('机位图标用真实坐标：远近高低左右和库数据一致', () => {
  const close = requirePreset('front-close')
  const medium = requirePreset('front-medium')
  const wide = requirePreset('front-wide')
  assert.ok(dist(close.position, close.lookAt) < dist(medium.position, medium.lookAt))
  assert.ok(dist(medium.position, medium.lookAt) < dist(wide.position, wide.lookAt))
  assert.ok(requirePreset('bird-eye').position.y > requirePreset('top-wide').position.y)
  assert.ok(requirePreset('top-wide').position.y > medium.position.y)
  assert.ok(medium.position.y > requirePreset('low-angle').position.y)
  assert.ok(requirePreset('over-shoulder').position.x < 0)
  assert.ok(requirePreset('over-shoulder-right').position.x > 0)
  assert.ok(requirePreset('dutch').rotation.z !== 0)
})

test('机位旋转值规范：存储值与由 position→lookAt 推出的朝向都只能是 5 的整数倍', () => {
  const isStep5 = (value: number, tolerance: number) => {
    const nearest = Math.round(value / 5) * 5
    return Math.abs(value - nearest) <= tolerance
  }
  for (const preset of CAMERA_PRESETS) {
    const { x, y, z } = preset.rotation
    for (const [axis, value] of [['x', x], ['y', y], ['z', z]] as const) {
      assert.ok(isStep5(value, 0), `${preset.id} rotation.${axis}=${value} 不是 5 的整数倍`)
    }
    const dx = preset.lookAt.x - preset.position.x
    const dy = preset.lookAt.y - preset.position.y
    const dz = preset.lookAt.z - preset.position.z
    const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI
    const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI
    // 位置取三位小数，推出的角度允许 0.05° 以内的舍入误差（检查器只显示一位小数）。
    assert.ok(isStep5(yaw, 0.05), `${preset.id} 推出的 yaw=${yaw.toFixed(3)} 不是 5 的整数倍`)
    assert.ok(isStep5(pitch, 0.05), `${preset.id} 推出的 pitch=${pitch.toFixed(3)} 不是 5 的整数倍`)
  }
})

test('运镜图标用同一套烘焙器：位移和摇镜方向与 recipe 一致', () => {
  const dolly = previewCameraMotionPoses(requireMotion('dolly_in'))
  const tilt = previewCameraMotionPoses(requireMotion('tilt_up'))
  const truck = previewCameraMotionPoses(requireMotion('truck_left'))
  if (!dolly || !tilt || !truck) throw new Error('preview bake failed')
  const dollyStart = dolly[0]
  const dollyEnd = dolly[dolly.length - 1]
  const tiltStart = tilt[0]
  const tiltEnd = tilt[tilt.length - 1]
  const truckStart = truck[0]
  const truckEnd = truck[truck.length - 1]
  if (!dollyStart || !dollyEnd || !tiltStart || !tiltEnd || !truckStart || !truckEnd) {
    throw new Error('empty preview poses')
  }
  assert.ok(dist(dollyEnd.position, dollyStart.lookAt) < dist(dollyStart.position, dollyStart.lookAt))
  assert.ok(tiltEnd.lookAt.y > tiltStart.lookAt.y)
  assert.ok(truckEnd.position.x < truckStart.position.x)
})

test('摇镜和环绕忽略 config.angleDeg，走 recipe 全路径', () => {
  if (!PREVIEW_FRONT) throw new Error('missing front-medium')
  const bake = (id: string, angleDeg?: number) => {
    const preset = requireMotion(id)
    const doc = makeEmptyDraft('angle-ignore', 30, 90, PREVIEW_FRONT)
    const cameraNode = doc.content.nodes[0]
    if (!cameraNode) throw new Error('missing camera')
    const result = bakeCameraMotionPoses(preset, { cameraNode, targetNode: null, doc }, 0, angleDeg == null ? undefined : { angleDeg })
    if (!result.ok || !result.poses) throw new Error(result.reason ?? 'bake failed')
    return result.poses
  }
  const panA = bake('pan_left')
  const panB = bake('pan_left', 90)
  const panEndA = panA[panA.length - 1]
  const panEndB = panB[panB.length - 1]
  if (!panEndA || !panEndB) throw new Error('empty pan poses')
  assert.deepEqual(panEndA.lookAt, panEndB.lookAt)
  const orbitA = bake('orbit_180')
  const orbitB = bake('orbit_180', 90)
  const orbitEndA = orbitA[orbitA.length - 1]
  const orbitEndB = orbitB[orbitB.length - 1]
  if (!orbitEndA || !orbitEndB) throw new Error('empty orbit poses')
  assert.deepEqual(orbitEndA.position, orbitEndB.position)
})
