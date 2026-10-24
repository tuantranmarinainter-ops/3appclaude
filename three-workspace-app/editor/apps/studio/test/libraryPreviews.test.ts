import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStudioOrigin, previewPlaybackAction, shouldLoadPreview } from '../src/libraryPreviewUtils'

test('library cards only load and play videos near the visible viewport', () => {
  assert.equal(shouldLoadPreview(true, true), true)
  assert.equal(shouldLoadPreview(false, true), false)
  assert.equal(shouldLoadPreview(true, false), false)
  assert.equal(previewPlaybackAction(true), 'play')
  assert.equal(previewPlaybackAction(false), 'pause')
})

test('library preview renderer uses the same loopback origin for localhost and 127.0.0.1', () => {
  assert.equal(normalizeStudioOrigin('http://localhost:3002'), 'http://127.0.0.1:3002')
  assert.equal(normalizeStudioOrigin('http://127.0.0.1:3002'), 'http://127.0.0.1:3002')
})
