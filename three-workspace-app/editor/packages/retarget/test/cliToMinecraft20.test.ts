import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Matrix4, Vector3 } from 'three'
import { evaluateBobjAction, parseBobjActions } from '../src/index.ts'
import { parseBobjArmature } from '../src/reverse.ts'
import { loadAsset } from '../cli/loadAsset.ts'
import { runNormalize } from '../cli/normalizeCore.ts'
import { mergeAnimationGlbs } from '../cli/glbContract.ts'
import { exportMinecraft20 } from '../cli/toMinecraft20.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bobjDir = resolve(here, '../../../apps/studio/public/retarget/v9.12')
const armaturePath = join(bobjDir, 'minecraft20-armature.bobj'), actionsPath = join(bobjDir, 'minecraft-actions.bobj')
const targetPath = resolve(here, '../../../../builtin-assets/characters/a3d_char_30ec53c93eae4173946b38639691ebe0.glb')
const cliPath = resolve(here, '../cli/normalize.ts'), tsxHome = resolve(here, '../../builder')
const armatureText = readFileSync(armaturePath, 'utf8'), armature = parseBobjArmature(armatureText)
const library = parseBobjActions(readFileSync(actionsPath, 'utf8'))
const indexOf = (name: string) => [...library.keys()].indexOf(name)

/** Minecraft20 action → Mixamo65 GLB through the normal App 1 pipeline. */
async function mixamoFromMinecraft(names: string[]) {
  const result = await runNormalize({ source: await loadAsset(readFileSync(actionsPath), 'bobj', { bobjArmature: readFileSync(armaturePath) }), sourceLabel: 'mc',
    sourceSha256: '3'.repeat(64), target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 't', targetSha256: '4'.repeat(64),
    actions: names.map(indexOf) })
  assert.equal(result.status, 'PASS')
  return result.glb!
}

const direction = (action: Parameters<typeof evaluateBobjAction>[1], ticks: number, from: string, to: string) => {
  const world = new Map(evaluateBobjAction(armature, action, ticks).map((bone) => [bone.name, new Vector3().setFromMatrixPosition(new Matrix4().fromArray(bone.worldMatrix))]))
  return world.get(to)!.clone().sub(world.get(from)!).normalize()
}
const degrees = (a: Vector3, b: Vector3) => Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180 / Math.PI

test('round trip Minecraft20 → Mixamo65 GLB → Minecraft20 .bobj keeps limb directions', async () => {
  const names = ['emote_t_pose', 'idle', 'running', 'emote_floss']
  const exported = await exportMinecraft20(await mixamoFromMinecraft(names), armatureText)
  assert.equal(exported.report.status, 'PASS', JSON.stringify(exported.report))
  assert.ok(exported.report.roundtripMaxErrorBlocks < 1e-3, `written .bobj re-evaluates to the solver pose (${exported.report.roundtripMaxErrorBlocks})`)
  const written = parseBobjActions(exported.bobj)
  assert.deepEqual([...written.keys()], names)
  const worst: string[] = []
  for (const name of names) {
    const original = library.get(name)!, result = written.get(name)!
    for (const fraction of [0, 0.25, 0.5, 0.75]) {
      const ticks = Math.round(original.durationTicks * fraction)
      for (const [from, to] of [['left_arm', 'low_left_arm'], ['low_left_arm', 'low_left_arm.end'], ['right_arm', 'low_right_arm'], ['left_leg', 'low_left_leg'], ['right_leg', 'low_leg_right']]) {
        const error = degrees(direction(original, ticks, from, to), direction(result, ticks, from, to))
        if (error > 15) worst.push(`${name}@${ticks} ${from}: ${error.toFixed(1)}°`)
      }
    }
  }
  assert.deepEqual(worst, [], 'limb directions survive the round trip within 15°')
})

test('BBS FS format: one `an` per Action, integer ticks at 20 Hz, LINEAR keys, continuous Euler', async () => {
  const exported = await exportMinecraft20(await mixamoFromMinecraft(['emote_floss', 'running']), armatureText)
  const lines = exported.bobj.split('\n')
  assert.equal(lines.filter((line) => line.startsWith('an ')).length, 2)
  const keys = lines.filter((line) => line.startsWith('kf '))
  assert.ok(keys.length > 0)
  for (const line of keys) {
    const [, tick, , mode] = line.split(' ')
    assert.match(tick!, /^\d+$/, line); assert.equal(mode, 'LINEAR', line)
  }
  for (const action of parseBobjActions(exported.bobj).values()) for (const group of action.groups.values()) for (const channel of group.channels) {
    if (channel.path !== 'rotation') continue
    for (let index = 1; index < channel.keys.length; index++) assert.ok(Math.abs(channel.keys[index]!.v - channel.keys[index - 1]!.v) < Math.PI, `${action.name}/${group.name} rotation ${channel.index} jumps`)
  }
  assert.deepEqual(exported.report.actions.map((item) => item.name), ['emote_floss', 'running'])
})

test('duplicate GLB animation names (WC3 has two "Stand 2") get Blender-style .001 suffixes in the .bobj', async () => {
  const running = await mixamoFromMinecraft(['running'])
  const exported = await exportMinecraft20(mergeAnimationGlbs([running, running, running]), armatureText)
  assert.equal(exported.report.status, 'PASS')
  assert.deepEqual([...parseBobjActions(exported.bobj).keys()], ['running', 'running.001', 'running.002'])
  assert.deepEqual(exported.report.actions.map((item) => [item.name, item.glbName]), [['running', 'running'], ['running.001', 'running'], ['running.002', 'running']])
})

test('CLI --bobj writes <stem>.minecraft20.bobj and its preview next to the GLB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'w01-mc20-')), src = join(dir, 'walk.glb')
  writeFileSync(src, await mixamoFromMinecraft(['running']))
  const run = spawnSync(process.execPath, ['--import', 'tsx', cliPath, '--src', src, '--target', targetPath, '--out', join(dir, 'out'), '--bobj', '--preview'], { encoding: 'utf8', cwd: tsxHome })
  assert.equal(run.status, 0, run.stderr + run.stdout)
  for (const file of ['walk.glb', 'walk.minecraft20.bobj', 'walk.minecraft20.preview.png']) assert.ok(existsSync(join(dir, 'out', file)), file)
  const report = JSON.parse(readFileSync(join(dir, 'out', 'walk.report.json'), 'utf8'))
  assert.equal(report.minecraft20.status, 'PASS')
})
