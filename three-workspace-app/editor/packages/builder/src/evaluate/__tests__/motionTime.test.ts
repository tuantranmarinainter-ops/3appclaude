import assert from 'node:assert/strict'
import { test } from 'vitest'
import { motionTimeSeconds } from '../clips'

function clip({ loop = false, reverse = false }: { loop?: boolean; reverse?: boolean } = {}) {
  return {
    id: 'clip', source: 'library', sourceDuration: 5, frameStart: 10, frameEnd: 100,
    target: { type: 'character', nodeId: 'actor' },
    playback: { version: 1, speed: 2, loop, loopMode: 'repeat' },
    motion: { assetId: 'motion', name: 'Walk', source: 'library', sourceRig: 'mixamorig', url: 'walk.fbx', inPlace: true,
      loop, speed: 2, time: 1, sourceLengthSeconds: 2, reverse },
  }
}

test('motion time respects a trimmed source window and playback speed', () => {
  const source = clip()
  assert.equal(motionTimeSeconds(source, 10, 30), 1)
  assert.equal(motionTimeSeconds(source, 25, 30), 2)
  assert.equal(motionTimeSeconds(source, 40, 30), 3)
  assert.equal(motionTimeSeconds(source, 70, 30), 3)
})

test('motion time loops and reverses within the trimmed source window', () => {
  const forward = clip({ loop: true })
  assert.equal(motionTimeSeconds(forward, 55, 30), 2)
  const reverse = clip({ reverse: true })
  assert.equal(motionTimeSeconds(reverse, 10, 30), 3)
  assert.equal(motionTimeSeconds(reverse, 25, 30), 2)
  assert.equal(motionTimeSeconds(reverse, 40, 30), 1)
  assert.equal(motionTimeSeconds(clip({ loop: true, reverse: true }), 55, 30), 2)
  const fullReverse = clip({ loop: true, reverse: true })
  fullReverse.sourceDuration = 2
  fullReverse.motion.time = 0
  fullReverse.motion.sourceLengthSeconds = 2
  assert.ok(motionTimeSeconds(fullReverse, 10, 30) < fullReverse.sourceDuration)
})
