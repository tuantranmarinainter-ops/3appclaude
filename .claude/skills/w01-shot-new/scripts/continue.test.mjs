// node --test continue.test.mjs  (pure: no server)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { continueClips, blendPartner } from './lib.mjs'

const clip = (id, node, a, b, blend) => ({ id, target: { nodeId: node }, frameStart: a, frameEnd: b, playback: { speed: 1, ...(blend ? { blendIn: { frames: blend } } : {}) } })

test('keeps the blend partner chain of a clip running at F, with its blendIn (Shot 05 Gỗ Xưa)', () => {
  const clips = [clip('death1', 'go', 110, 189), clip('rev', 'go', 186, 258, 4), clip('crouch', 'go', 242, 300, 17), clip('fly', 'hero', 0, 300), clip('old', 'hero', 0, 50)]
  const out = continueClips(clips, 299)
  assert.deepEqual(out.map((c) => c.id), ['death1', 'rev', 'crouch', 'fly'])
  assert.deepEqual(out.map((c) => [c.frameStart, c.frameEnd]), [[-189, -110], [-113, -41], [-57, 1], [-299, 1]])
  assert.equal(out[2].playback.blendIn.frames, 17)
})

test('in-place blends align nothing: their partners are not kept', () => {
  const a = clip('a', 'hero', 0, 120), b = clip('b', 'hero', 100, 300, 10)
  b.motion = { rootMotion: { policy: 'in-place' } }
  assert.deepEqual(continueClips([a, b], 299).map((c) => c.id), ['b'])
})

test('no blendIn: clips that ended before F are dropped', () => {
  const out = continueClips([clip('a', 'go', 0, 100), clip('b', 'go', 101, 300)], 299)
  assert.deepEqual(out.map((c) => c.id), ['b'])
})

test('blendPartner follows App 2: latest earlier clip still running at the end of the zone', () => {
  const a = clip('a', 'go', 0, 120), b = clip('b', 'go', 50, 105), c = clip('c', 'go', 100, 200, 10)
  assert.equal(blendPartner([a, b, c], c).id, 'a')   // b ends at 105 < zone end 109
  assert.equal(blendPartner([a, b, c], a), null)
})
