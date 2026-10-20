import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { evaluateBobjChannel, parseBobjActions } from '../src/index.ts'

test('all85 shipped legacy actions retain manifest timing/key counts and finite channel evaluation', () => {
  const manifestFile = new URL('../../../apps/studio/public/retarget/v9.12/action_manifest.json', import.meta.url)
  const actionsFile = new URL('../../../apps/studio/public/retarget/v9.12/minecraft-actions.bobj', import.meta.url)
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
    action_count: number; actions: Array<{ name: string; max_time: number; keyframes: number }>
  }
  const actions = parseBobjActions(readFileSync(actionsFile, 'utf8'))
  assert.equal(manifest.action_count, 85)
  assert.equal(actions.size, 85)
  assert.deepEqual([...actions.keys()].sort(), manifest.actions.map((action) => action.name).sort())
  for (const expected of manifest.actions) {
    const action = actions.get(expected.name)!
    assert.ok(Math.abs(action.durationTicks - expected.max_time) < 1e-6, `${expected.name}: duration`)
    const channels = [...action.groups.values()].flatMap((group) => group.channels)
    assert.equal(channels.reduce((count, channel) => count + channel.keys.length, 0), expected.keyframes, `${expected.name}: keys`)
    for (const channel of channels) for (const time of [0, action.durationTicks / 2, action.durationTicks]) {
      assert.ok(Number.isFinite(evaluateBobjChannel(channel, time)), `${expected.name}: ${channel.path} at ${time}`)
    }
  }
})
