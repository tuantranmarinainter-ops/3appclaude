import assert from 'node:assert/strict'
import test from 'node:test'
import { isRetargetProjectV99 } from '../src/project.ts'

function project() {
  return {
    type: 'mixamo-retarget-project', version: 1, build: 'V9.9', mode: 'retarget',
    rig: { source: 'mixamo65', target: 'bobj20' },
    source: { kind: 'fbx', name: 'motion.fbx', clip: 'Walk', duration: 1, tracks: 1, content: 'abcd1234' },
    target: [['body', null, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]]],
    tick: 0, previewSpeed: 1,
    state: {
      context: {
        offsets: {}, calibration: {}, segments: {}, mapping: {}, sourcePose: {}, interpolation: {},
        feet: { enabled: false, mode: 'auto', side: 'both', floor: 0, height: 0.08, speed: 0.15, start: 0, end: 1, fade: 0.1 },
      },
      controls: {}, sides: { proportionSide: 'both', handSide: 'both', motionSide: 'both' }, movement: {},
    },
  }
}

test('V9.12 project validator accepts source-shaped project JSON and rejects malformed edits', () => {
  const valid = project()
  assert.equal(isRetargetProjectV99(valid), true)

  for (const mutate of [
    (value: ReturnType<typeof project>) => { value.state.context.feet.height = 2 },
    (value: ReturnType<typeof project>) => { value.state.controls.adjIntensity = '201' },
    (value: ReturnType<typeof project>) => { value.target[0]![2] = [0, 1] },
    (value: ReturnType<typeof project>) => { value.state.context.offsets.body = { angles: [0, 0, 181], space: 'local', reference: 'self' } },
    (value: ReturnType<typeof project>) => { (value.state.context as Record<string, unknown>).constructor = {} },
  ]) {
    const invalid = structuredClone(valid)
    mutate(invalid)
    assert.equal(isRetargetProjectV99(invalid), false)
  }
})
