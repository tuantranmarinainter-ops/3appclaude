import assert from 'node:assert/strict'
import test from 'node:test'
import { safeWorkspaceUrl, workspaceHref, withUnified } from './workspaceNavigationModel.ts'

test('keeps the unified project when moving between local and external workspaces', () => {
  assert.equal(workspaceHref('scene', {}, 'project 1'), '/?unified=project+1')
  assert.equal(workspaceHref('library', {}, 'project 1'), '/library?unified=project+1')
  assert.equal(workspaceHref('animation', { animation: 'http://127.0.0.1:4100/edit?mode=rig' }, 'abc'), 'http://127.0.0.1:4100/edit?mode=rig&unified=abc')
  assert.equal(withUnified('/library#actions', 'abc'), '/library?unified=abc#actions')
})

test('leaves links disabled until an external workspace URL is configured', () => {
  assert.equal(workspaceHref('normalize', {}, 'abc'), null)
  assert.equal(workspaceHref('animation', {}, null), null)
  assert.equal(workspaceHref('vfx', {}, null), null)
})

test('accepts web workspace URLs and rejects executable or malformed protocols', () => {
  assert.equal(safeWorkspaceUrl('http://127.0.0.1:3101'), 'http://127.0.0.1:3101/')
  assert.equal(safeWorkspaceUrl('https://studio.example.test/app'), 'https://studio.example.test/app')
  assert.equal(safeWorkspaceUrl('javascript:alert(1)'), null)
  assert.equal(safeWorkspaceUrl('file:///tmp/app.html'), null)
  assert.equal(safeWorkspaceUrl('not a URL'), null)
})
