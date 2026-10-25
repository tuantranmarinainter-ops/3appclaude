import assert from 'node:assert/strict'
import test from 'node:test'
import { OPEN_PROJECT_HINT, QUICK_NORMALIZE_LABEL, safeWorkspaceUrl, workspaceHref, workspaceProjectListHint, withUnified } from './workspaceNavigationModel.ts'

test('keeps the unified project when moving between local and external workspaces', () => {
  assert.equal(workspaceHref('scene', {}, 'project 1'), '/?unified=project+1')
  assert.equal(workspaceHref('library', {}, 'project 1'), '/library?unified=project+1')
  assert.equal(workspaceHref('animation', { animation: 'http://127.0.0.1:4100/edit?mode=rig' }, 'abc'), 'http://127.0.0.1:4100/edit?mode=rig&unified=abc')
  assert.equal(withUnified('/library#actions', 'abc'), '/library?unified=abc#actions')
})

test('defaults Chuẩn hoá to the App 1 Workbench URL when its env URL is missing or invalid', () => {
  assert.equal(workspaceHref('normalize', {}, null), 'http://127.0.0.1:3101')
  assert.equal(workspaceHref('normalize', {}, 'abc'), 'http://127.0.0.1:3101/?unified=abc')
  assert.equal(workspaceHref('normalize', { normalize: 'javascript:alert(1)' }, null), 'http://127.0.0.1:3101')
  assert.equal(workspaceHref('normalize', { normalize: 'http://127.0.0.1:9999/wb' }, null), 'http://127.0.0.1:9999/wb')
})

test('sends Animation and VFX to the project list with a hint until an external URL is configured', () => {
  assert.equal(workspaceHref('animation', {}, null), '/')
  assert.equal(workspaceHref('vfx', {}, 'project 1'), '/?unified=project+1')
  assert.equal(workspaceHref('vfx', { vfx: 'not a URL' }, null), '/')
  assert.equal(workspaceProjectListHint('animation', {}), OPEN_PROJECT_HINT)
  assert.equal(workspaceProjectListHint('vfx', { vfx: 'file:///tmp/app.html' }), OPEN_PROJECT_HINT)
  assert.equal(workspaceProjectListHint('animation', { animation: 'https://studio.example.test/app' }), null)
  assert.equal(workspaceProjectListHint('normalize', {}), null)
  assert.equal(workspaceProjectListHint('scene', {}), null)
  assert.equal(workspaceProjectListHint('library', {}), null)
})

test('labels the in-project quick normalize tab as the legacy V9.12 tool, not App 1', () => {
  assert.equal(QUICK_NORMALIZE_LABEL, 'Chuẩn hoá nhanh (V9.12)')
})

test('accepts web workspace URLs and rejects executable or malformed protocols', () => {
  assert.equal(safeWorkspaceUrl('http://127.0.0.1:3101'), 'http://127.0.0.1:3101/')
  assert.equal(safeWorkspaceUrl('https://studio.example.test/app'), 'https://studio.example.test/app')
  assert.equal(safeWorkspaceUrl('javascript:alert(1)'), null)
  assert.equal(safeWorkspaceUrl('file:///tmp/app.html'), null)
  assert.equal(safeWorkspaceUrl('not a URL'), null)
})
