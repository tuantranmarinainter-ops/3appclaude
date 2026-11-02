import assert from 'node:assert/strict'
import test from 'node:test'
import { makeEmptyDraft } from '@topview/3d-builder'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { filmCameraWarnings } from '../src/filmCameraWarnings.ts'

function fixture() {
  const scene = makeEmptyDraft('Camera warning', 30, 149, { fov: 50, position: { x: 0, y: 2, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 2, z: 0 } })
  scene.content.editorial = { version: 1, activeSequenceId: 'main', sequences: [{ id: 'main', clips: [
    { id: 'shot_01', cameraNodeId: 'camera_1', sourceFrameStart: 0, sourceFrameEnd: 149 },
  ] }] }
  return { scene, extensions: {} } as UnifiedProject
}
const range = { startFrame: 0, endFrame: 149 }

test('warns for an evaluated stationary camera without blocking export', () => {
  const warnings = filmCameraWarnings(fixture(), 'main', range, 16 / 9)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0]!.code, 'CAMERA_STATIONARY')
  assert.equal(warnings[0]!.clipId, 'shot_01')
  assert.match(warnings[0]!.message.vi, /đứng yên/)
})

test('saved baked user keys count as movement even without camera motion clips', () => {
  const project = fixture()
  project.extensions.topview = { fcurves: { version: 1, encoding: 'compact-v1', fcurves: [], userKeys: { camera_1: { position: [
    { id: 'a', frame: 0, value: [0, 2, 5], interpolation: 'linear' },
    { id: 'b', frame: 149, value: [3, 2, 5], interpolation: 'linear' },
  ] } } } } as never
  assert.deepEqual(filmCameraWarnings(project, 'main', range, 16 / 9), [])
})

test('does not guess stationary when shots have gaps or missing cameras', () => {
  const project = fixture()
  project.scene.content.editorial!.sequences[0]!.clips[0]!.sourceFrameEnd = 29
  assert.deepEqual(filmCameraWarnings(project, 'main', range, 16 / 9), [])
  project.scene.content.editorial!.sequences[0]!.clips[0]!.sourceFrameEnd = 149
  project.scene.content.nodes = []
  assert.deepEqual(filmCameraWarnings(project, 'main', range, 16 / 9), [])
})
