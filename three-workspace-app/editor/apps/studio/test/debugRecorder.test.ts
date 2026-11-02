import assert from 'node:assert/strict'
import test from 'node:test'
import { describeRequestBody, formatDebugLog, keyLabel } from '../src/debugRecorder'

test('debug recorder names key combos the way the user presses them', () => {
  assert.equal(keyLabel({ key: 'e', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }), 'E')
  assert.equal(keyLabel({ key: 'e', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), 'Ctrl+E')
  assert.equal(keyLabel({ key: 'Delete', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true }), 'Shift+Delete')
  assert.equal(keyLabel({ key: ' ', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }), 'Space')
})

test('debug recorder keeps the command, revision and scene operations of a save', () => {
  const body = JSON.stringify({ requestId: 'x', projectId: 'p', expectedRevision: 147, command: 'scene.apply', args: { operations: [{ type: 'document.replace', document: { big: true } }] } })
  assert.deepEqual(describeRequestBody(body), { command: 'scene.apply', expectedRevision: 147, operations: ['document.replace'] })
  assert.deepEqual(describeRequestBody(JSON.stringify({ operation: 'place-for-node', projectId: 'p' })), { operation: 'place-for-node' })
  assert.deepEqual(describeRequestBody('not json'), {})
  assert.deepEqual(describeRequestBody(undefined), {})
})

test('debug log text is one readable line per entry', () => {
  const text = formatDebugLog([
    { at: '2026-11-01T09:10:11.123Z', kind: 'key', text: 'Ctrl+E · Khung 3D' },
    { at: '2026-11-01T09:10:12.000Z', kind: 'note', text: 'GHI CHÚ: vừa mất camera' },
  ])
  assert.equal(text, '09:10:11.123  [PHÍM] Ctrl+E · Khung 3D\n09:10:12.000  [GHI CHÚ] GHI CHÚ: vừa mất camera')
})
