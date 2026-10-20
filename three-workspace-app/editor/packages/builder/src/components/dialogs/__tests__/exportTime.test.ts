import assert from 'node:assert/strict'
import { test } from 'vitest'
import { formatExportTime, parseExportTime } from '../utils'

test('裸数字按当前单位解析', () => {
  assert.equal(parseExportTime('120', 30, 'frames'), 120)
  assert.equal(parseExportTime('2.5', 30, 'seconds'), 75)
  assert.equal(parseExportTime(' 10.6 ', 30, 'frames'), 11)
})

test('后缀 s / f 覆盖当前单位', () => {
  assert.equal(parseExportTime('2.5s', 30, 'frames'), 75)
  assert.equal(parseExportTime('4 S', 24, 'frames'), 96)
  assert.equal(parseExportTime('60f', 30, 'seconds'), 60)
})

test('非法输入返回 null', () => {
  for (const text of ['', 'abc', '-3', '1.2.3', '5x', 's']) {
    assert.equal(parseExportTime(text, 30, 'frames'), null, text)
  }
})

test('按单位格式化，秒保留两位小数并去掉尾零', () => {
  assert.equal(formatExportTime(75.4, 30, 'frames'), '75')
  assert.equal(formatExportTime(75, 30, 'seconds'), '2.5')
  assert.equal(formatExportTime(300, 30, 'seconds'), '10')
  assert.equal(formatExportTime(10, 30, 'seconds'), '0.33')
})
