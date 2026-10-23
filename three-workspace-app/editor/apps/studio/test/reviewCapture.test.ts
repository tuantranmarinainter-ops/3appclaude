import assert from 'node:assert/strict'
import test from 'node:test'
import { REVIEW_CAPTURE_SIZE, reviewCaptureSize } from '../src/reviewCapture'

test('review stills follow the film frame with a fixed long side', () => {
  assert.deepEqual(reviewCaptureSize(16 / 9), { width: REVIEW_CAPTURE_SIZE, height: 360 })
  assert.deepEqual(reviewCaptureSize(9 / 16), { width: 360, height: REVIEW_CAPTURE_SIZE })
  assert.deepEqual(reviewCaptureSize(1), { width: REVIEW_CAPTURE_SIZE, height: REVIEW_CAPTURE_SIZE })
})
