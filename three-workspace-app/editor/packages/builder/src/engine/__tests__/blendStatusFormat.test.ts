import { test } from 'vitest'
import assert from 'node:assert/strict'
import { blendOffsetText, vnNumber, type BlendStatus } from '../objects/blendStatus'

test('vnNumber không in dấu âm cho giá trị làm tròn về 0', () => {
  assert.equal(vnNumber(-0.2, 0), '0')
  assert.equal(vnNumber(-0, 0), '0')
  assert.equal(vnNumber(-0.004, 2), '0,00')
  assert.equal(vnNumber(-0.6, 0), '-1')
  assert.equal(vnNumber(-1.234, 2), '-1,23')
  assert.equal(vnNumber(0.5, 2), '0,50')
})

test('blendOffsetText: yaw âm rất nhỏ hiện "xoay 0°"', () => {
  const status = { aligned: true, offsetMeters: 0.004, yawDegrees: -0.3 } as unknown as BlendStatus
  const text = blendOffsetText(status)
  assert.equal(text, 'Clip sau dời 0,00 m, xoay 0°')
  assert.ok(!text.includes('-'))
})
