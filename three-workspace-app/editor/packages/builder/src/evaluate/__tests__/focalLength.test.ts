import assert from 'node:assert/strict'
import { test } from 'vitest'
import { cameraAspectSetting, cameraNumericAspect } from '../../contract/cameraAspect'
import { CAMERA_FOV_MAX, CAMERA_FOV_MIN } from '../../data/cameraLibrary'
import { focalLengthToFov, fovToFocalLength, SENSOR_HEIGHT_MM } from '../camera/focalLength'

test('焦距与垂直视角按 24mm 竖边互逆', () => {
  assert.equal(SENSOR_HEIGHT_MM, 24)
  for (const fov of [12, 35, 50, 70, 90, 120]) {
    const back = focalLengthToFov(fovToFocalLength(fov))
    assert.ok(Math.abs(back - fov) < 1e-6, `${fov} → ${back}`)
  }
  assert.ok(fovToFocalLength(50) > fovToFocalLength(70))
  assert.equal(focalLengthToFov(1), CAMERA_FOV_MAX)
  assert.equal(focalLengthToFov(10_000), CAMERA_FOV_MIN)
})

test('机位画幅缺省时用文档画幅，写了就用自己的', () => {
  assert.equal(cameraAspectSetting(undefined, '16:9'), '16:9')
  assert.equal(cameraAspectSetting({ aspectRatio: '9:16' }, '16:9'), '9:16')
  assert.equal(cameraNumericAspect({ aspectRatio: '1:1' }, '16:9', 1.5), 1)
})
