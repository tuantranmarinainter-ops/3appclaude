import { test } from 'vitest'
import assert from 'node:assert/strict'
import { duplicateClipGesture, timelineClipboardCommand } from '../utils/clipGestures'

test('duplicate drag uses Ctrl on Windows/Linux and Alt on Mac', () => {
  assert.equal(duplicateClipGesture({ ctrlKey: true, altKey: false }, 'Win32'), true)
  assert.equal(duplicateClipGesture({ ctrlKey: false, altKey: true }, 'Linux'), false)
  assert.equal(duplicateClipGesture({ ctrlKey: true, altKey: false }, 'MacIntel'), false)
  assert.equal(duplicateClipGesture({ ctrlKey: false, altKey: true }, 'MacIntel'), true)
})

test('timeline shortcuts preserve input editing and require a command modifier', () => {
  const event = { key: 'C', ctrlKey: true, metaKey: false }
  assert.equal(timelineClipboardCommand(event, false), 'copy')
  assert.equal(timelineClipboardCommand(event, true), null)
  assert.equal(timelineClipboardCommand({ key: 'v', ctrlKey: false, metaKey: true }, false), 'paste')
  assert.equal(timelineClipboardCommand({ key: 'v', ctrlKey: false, metaKey: false }, false), null)
})
