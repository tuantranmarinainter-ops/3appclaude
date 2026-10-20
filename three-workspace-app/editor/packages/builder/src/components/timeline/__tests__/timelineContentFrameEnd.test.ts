import assert from 'node:assert/strict'
import { test } from 'vitest'
import { timelineContentFrameEnd, timelineFitPx } from '../utils'

test('适配范围覆盖时间轴、运镜和轨迹里最远的一帧', () => {
  const end = timelineContentFrameEnd(48, [
    { frameEnd: 120 },
    { frameEnd: 80 },
    { frameEnd: 30 },
  ])
  assert.equal(end, 120)
  assert.equal(timelineFitPx(end - 0 + 1, 605), 5)
})
