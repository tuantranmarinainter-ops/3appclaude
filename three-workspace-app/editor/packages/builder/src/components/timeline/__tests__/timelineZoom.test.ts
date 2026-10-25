import assert from 'node:assert/strict'
import { test } from 'vitest'
import { LEFT_W, TRACK_INSET } from '../constants'
import { anchoredScrollLeft, clampPxPerFrame, fitPxForRange, frameAtContentX, wheelZoomPxPerFrame } from '../utils'

test('clampPxPerFrame keeps zoom inside 0.2..60', () => {
  assert.equal(clampPxPerFrame(0.01), 0.2)
  assert.equal(clampPxPerFrame(500), 60)
  assert.equal(clampPxPerFrame(3), 3)
  assert.equal(clampPxPerFrame(Number.NaN), 0.2)
})

test('wheel zoom in increases px/frame, zoom out decreases it', () => {
  assert.ok(wheelZoomPxPerFrame(2, -120) > 2)
  assert.ok(wheelZoomPxPerFrame(2, 120) < 2)
  assert.equal(wheelZoomPxPerFrame(2, 0), 2)
  // Lăn mạnh vẫn bị kẹp ở hai đầu.
  assert.equal(wheelZoomPxPerFrame(50, -5000), 60)
  assert.equal(wheelZoomPxPerFrame(1, 5000), 0.2)
})

test('zoom around cursor keeps the anchored frame under the cursor', () => {
  const frameStart = 10
  const oldPx = 1.5
  const scrollLeft = 300
  const cursorOffsetX = 420
  const anchorFrame = frameAtContentX(scrollLeft + cursorOffsetX, frameStart, oldPx)
  const newPx = wheelZoomPxPerFrame(oldPx, -240)
  assert.ok(newPx > oldPx)
  const nextScrollLeft = anchoredScrollLeft({ anchorFrame, frameStart, pxPerFrame: newPx, cursorOffsetX })
  const frameAfter = frameAtContentX(nextScrollLeft + cursorOffsetX, frameStart, newPx)
  assert.ok(Math.abs(frameAfter - anchorFrame) < 1e-9, `${frameAfter} != ${anchorFrame}`)
  // Neo ở đầu track không cho scrollLeft âm.
  const startAnchor = frameAtContentX(LEFT_W + TRACK_INSET, frameStart, oldPx)
  assert.equal(anchoredScrollLeft({ anchorFrame: startAnchor, frameStart, pxPerFrame: newPx, cursorOffsetX: 9999 }), 0)
})

test('fitPxForRange makes an 18-frame clip fill the track and stay readable', () => {
  const px = fitPxForRange(100, 117, 900)
  assert.equal(px, 50)
  // 18 frame ở 50 px/frame = 900 px: mỗi frame rộng 50 px, nhìn rõ từng frame.
  assert.ok((px ?? 0) * 18 >= 900 - 1e-9)
  // Track rất rộng vẫn kẹp ở max zoom.
  assert.equal(fitPxForRange(0, 17, 4000), 60)
  // Khoảng dài bị kẹp ở min zoom thay vì px âm / 0.
  assert.equal(fitPxForRange(0, 19999, 800), 0.2)
  assert.equal(fitPxForRange(0, 10, 0), null)
  assert.equal(fitPxForRange(10, 5, 800), null)
})
