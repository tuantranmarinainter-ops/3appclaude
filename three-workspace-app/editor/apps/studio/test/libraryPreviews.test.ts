import assert from 'node:assert/strict'
import test from 'node:test'
import { previewPlaybackAction, shouldLoadPreview } from '../src/libraryPreviewUtils'

test('library cards only load and play videos near the visible viewport', () => {
  assert.equal(shouldLoadPreview(true, true), true)
  assert.equal(shouldLoadPreview(false, true), false)
  assert.equal(shouldLoadPreview(true, false), false)
  assert.equal(previewPlaybackAction(true), 'play')
  assert.equal(previewPlaybackAction(false), 'pause')
})
