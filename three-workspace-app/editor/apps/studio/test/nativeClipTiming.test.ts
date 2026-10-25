import test from 'node:test'
import assert from 'node:assert/strict'
import type { UnifiedProject } from '@bbs/animation-workspace-shared'
import { applyBakedClipTiming } from '../src/nativeClipTiming.ts'

function fixture(): UnifiedProject {
  return { scene: { content: { timeline: { fps: 30, frameEnd: 299, animation: { motionClips: [{ id: 'a', frameStart: 30, frameEnd: 89, target: { nodeId: 'actor' }, playback: { speed: .5, loop: true }, motion: { speed: .5, time: 1, reverse: true } }] } } } }, bindings: { a: { sourceStartSeconds: 1, sourceLengthSeconds: 2, reverse: true } } } as unknown as UnifiedProject
}
test('baked Lab clip returns at the edited duration without applying speed twice, and survives JSON reload', () => {
  const project = fixture()
  applyBakedClipTiming(project, 'a', 4)
  const restored = JSON.parse(JSON.stringify(project)) as UnifiedProject
  const clip = restored.scene.content.timeline.animation.motionClips[0]
  assert.equal(clip.frameEnd, 149)
  assert.equal(clip.playback.speed, 1)
  assert.equal(clip.motion.speed, 1)
  assert.equal(clip.motion.time, 0)
  assert.equal(clip.motion.reverse, false)
  assert.equal(restored.bindings.a.sourceLengthSeconds, 4)
})
test('invalid duration, overflow and overlap reject before changing the clip', () => {
  for (const duration of [0, NaN, 20]) {
    const p = fixture(), before = JSON.stringify(p)
    assert.throws(() => applyBakedClipTiming(p, 'a', duration))
    assert.equal(JSON.stringify(p), before)
  }
  const p = fixture(), clips = p.scene.content.timeline.animation.motionClips
  clips.push({ ...structuredClone(clips[0]), id: 'b', frameStart: 100, frameEnd: 129 })
  const before = JSON.stringify(p)
  assert.throws(() => applyBakedClipTiming(p, 'a', 4), /chồng/)
  assert.equal(JSON.stringify(p), before)
})
