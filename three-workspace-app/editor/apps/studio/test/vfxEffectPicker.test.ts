import assert from 'node:assert/strict'
import test from 'node:test'
import type { VfxSheetMeta } from '@topview/3d-builder'
import {
  EDITORIAL_TIMELINE_SHOT_ID, resolveEditorialShot, vfxEffectOptions, vfxSpriteThumb,
} from '../app/workbench/components/vfx-cues/utils.ts'

const meta = (patch: Partial<VfxSheetMeta> = {}): VfxSheetMeta => ({
  frames: 10, columns: 4, rows: 3, fps: 20, sizeMeters: 2, pivot: [0.5, 0], blend: 'add', loop: false, ...patch,
})

test('vfxEffectOptions sorts the App 4 library and builds encoded sprite URLs', () => {
  const options = vfxEffectOptions({ 'zap 02': meta(), aura01: meta({ frames: 8 }) }, '/api/unified/vfx-previews')
  assert.deepEqual(options.map((option) => option.name), ['aura01', 'zap 02'])
  assert.equal(options[0]?.imageUrl, '/api/unified/vfx-previews/aura01')
  assert.equal(options[1]?.imageUrl, '/api/unified/vfx-previews/zap%2002')
})

test('vfxEffectOptions drops sheets without a usable grid and tolerates a missing library', () => {
  assert.deepEqual(vfxEffectOptions(undefined, '/x'), [])
  assert.deepEqual(vfxEffectOptions({ broken: meta({ frames: 0 }), flat: meta({ columns: 0 }) }, '/x'), [])
})

test('vfxSpriteThumb shows the middle frame of the sheet', () => {
  // 10 frames on a 4x3 grid: middle frame 5 -> column 1, row 1.
  assert.deepEqual(vfxSpriteThumb(meta()), { backgroundSize: '400% 300%', backgroundPosition: '33.333% 50%' })
  // 12 frames: middle frame 6 -> column 2, row 1.
  assert.deepEqual(vfxSpriteThumb(meta({ frames: 12 })), { backgroundSize: '400% 300%', backgroundPosition: '66.667% 50%' })
})

test('vfxSpriteThumb handles a single-cell sheet without dividing by zero', () => {
  assert.deepEqual(vfxSpriteThumb(meta({ frames: 1, columns: 1, rows: 1 })), { backgroundSize: '100% 100%', backgroundPosition: '0% 0%' })
})

test('resolveEditorialShot keeps the first clip as the untouched default', () => {
  const clips = [{ id: 'shot-a' }, { id: 'shot-b' }]
  assert.equal(resolveEditorialShot(clips, '')?.id, 'shot-a')
  assert.equal(resolveEditorialShot(clips, 'shot-b')?.id, 'shot-b')
  assert.equal(resolveEditorialShot(clips, 'gone')?.id, 'shot-a')
})

test('resolveEditorialShot returns no shot for the default timeline entry', () => {
  const clips = [{ id: 'shot-a' }]
  assert.equal(resolveEditorialShot(clips, EDITORIAL_TIMELINE_SHOT_ID), undefined)
  assert.equal(resolveEditorialShot([], ''), undefined)
})
