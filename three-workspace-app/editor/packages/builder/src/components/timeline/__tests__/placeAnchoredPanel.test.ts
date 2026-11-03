import { test } from 'vitest'
import assert from 'node:assert/strict'
import { placeAnchoredPanel } from '../utils/clipMenu'

const vp = { width: 1400, height: 900 }
const size = { width: 225, height: 203 }

test('đủ chỗ: đặt ngay dưới dải', () => {
  const p = placeAnchoredPanel({ left: 400, top: 300, bottom: 322 }, size, vp)
  assert.deepEqual([p.x, p.y], [400, 326])
})

test('sát đáy: lật lên trên dải, không đè lên dải', () => {
  const p = placeAnchoredPanel({ left: 400, top: 775, bottom: 797 }, size, vp)
  assert.equal(p.y, 775 - 4 - 203)
  assert.ok(p.y + size.height <= 775)
})

test('không chỗ trên lẫn dưới: dán vào mép, vẫn nằm trong cửa sổ', () => {
  const p = placeAnchoredPanel({ left: 10, top: 100, bottom: 120 }, { width: 225, height: 500 }, { width: 1400, height: 520 })
  assert.ok(p.y >= 8 && p.y + 500 <= 520 + 1, String(p.y))
  assert.ok(p.maxHeight <= 520 - 16)
})

test('kẹp ngang trong cửa sổ', () => {
  const p = placeAnchoredPanel({ left: 1350, top: 300, bottom: 322 }, size, vp)
  assert.equal(p.x, 1400 - 8 - 225)
  assert.equal(placeAnchoredPanel({ left: -50, top: 0, bottom: 10 }, size, vp).x, 8)
})
