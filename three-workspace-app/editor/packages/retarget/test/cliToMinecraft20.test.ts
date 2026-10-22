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
import { decodeGlb, encodeGlb } from '../cli/glb.ts'
import { glbNodeNames } from '../cli/glbContract.ts'
import { exportMinecraft20, limbTwistDegrees, untwistLimbs } from '../cli/toMinecraft20.ts'

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

test('Minecraft20 reverse conversion reports every unmapped v1.1 extra bone by name', async () => {
  const decoded = decodeGlb(await mixamoFromMinecraft(['running']))
  const json = structuredClone(decoded.json)
  json.nodes.push({ name: 'X_LeftHand_twistHelper', translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
  const extended = encodeGlb(json, decoded.bin)
  const exported = await exportMinecraft20(extended, armatureText)
  assert.deepEqual(exported.report.droppedExtraBones, ['X_LeftHand_twistHelper'])
  assert.equal(exported.report.status, 'PASS')
})

test('App 1 normalization preserves validated v1.1 extra bones and their declared rest pose', async () => {
  const core = await mixamoFromMinecraft(['running']), decoded = decodeGlb(core), json = structuredClone(decoded.json)
  const hand = json.nodes.findIndex((node: { name?: string }) => node.name === 'LeftHand')
  assert.notEqual(hand, -1)
  const extra = { name: 'X_LeftHand_twistHelper', parent: 'LeftHand', rest: { position: [0.02, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }
  const handNode = json.nodes[hand]!
  handNode.children = [...(handNode.children ?? []), json.nodes.length]
  json.nodes.push({ name: extra.name, translation: extra.rest.position, rotation: extra.rest.rotation, scale: extra.rest.scale })
  json.skins[0]!.joints.push(json.nodes.length - 1)
  const sourceGlb = encodeGlb(json, decoded.bin), sourceManifest = { version: '1.1.0', rig: 'mixamo65+twist', extraBones: [extra] }
  const result = await runNormalize({ source: await loadAsset(sourceGlb, 'glb', { skeletonOnly: true }), sourceLabel: 'extended.glb', sourceSha256: '5'.repeat(64),
    sourceExtraManifest: sourceManifest, sourceExtraGlb: sourceGlb,
    target: await loadAsset(readFileSync(targetPath), 'glb', { skeletonOnly: true }), targetLabel: 'target.glb', targetSha256: '4'.repeat(64), calibrate: 'none' })
  assert.equal(result.status, 'PASS', JSON.stringify(result.report))
  assert.equal(result.manifest.version, '1.1.0')
  assert.equal(result.manifest.rig, sourceManifest.rig)
  assert.deepEqual(result.manifest.extraBones, [extra])
  const output = decodeGlb(result.glb!)
  assert.ok(glbNodeNames(result.glb!).includes(extra.name))
  assert.equal(output.json.skins[0]!.joints.length, 66)
  const outIndex = output.json.nodes.findIndex((node: { name?: string }) => node.name === extra.name)
  assert.ok(output.json.nodes.find((node: { children?: number[]; name?: string }) => node.name === extra.parent)?.children?.includes(outIndex))
  assert.deepEqual(output.json.nodes[outIndex], { name: extra.name, translation: extra.rest.position, rotation: extra.rest.rotation, scale: extra.rest.scale })
  assert.deepEqual(result.report.loss.extraBoneTracksDropped, [])
})

test('untwistLimbs removes the forearm twist relative to the upper arm but keeps its bend, elbow and hand positions', () => {
  const rest = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().fromArray([...bone.restWorld])]))
  // Bend the left forearm 60° and twist it 90° about its own axis (pivot = elbow); the hand end follows.
  const elbow = new Vector3().setFromMatrixPosition(rest.get('low_left_arm')!)
  const axis = new Vector3(...armature.bones.find((bone) => bone.name === 'low_left_arm')!.localTail).applyMatrix4(rest.get('low_left_arm')!).sub(elbow).normalize()
  const bend = new Matrix4().makeRotationAxis(new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize(), Math.PI / 3)
  const twist = new Matrix4().makeRotationAxis(axis, Math.PI / 2)
  const about = (rotation: Matrix4) => new Matrix4().makeTranslation(elbow.x, elbow.y, elbow.z).multiply(rotation).multiply(new Matrix4().makeTranslation(-elbow.x, -elbow.y, -elbow.z))
  const pose = new Map(rest)
  for (const name of ['low_left_arm', 'low_left_arm.end']) pose.set(name, about(bend).multiply(about(twist)).multiply(rest.get(name)!))
  const hand = new Vector3().setFromMatrixPosition(pose.get('low_left_arm.end')!)
  const before = limbTwistDegrees(armature, pose)
  assert.ok(Math.abs(before.low_left_arm! - 90) < 1, `twist measured ${before.low_left_arm}`)
  const fixed = untwistLimbs(armature, pose)
  assert.ok(Math.abs(fixed.maxBeforeDegrees - 90) < 1)
  const after = limbTwistDegrees(armature, fixed.worlds)
  assert.ok(after.low_left_arm! < 0.5, `twist left after ${after.low_left_arm}`)
  assert.ok(new Vector3().setFromMatrixPosition(fixed.worlds.get('low_left_arm')!).distanceTo(elbow) < 1e-6, 'elbow stays')
  assert.ok(new Vector3().setFromMatrixPosition(fixed.worlds.get('low_left_arm.end')!).distanceTo(hand) < 1e-6, 'hand stays')
})

test('hands (`low_*_arm.end`) are locked to the forearm like the original emotes (no wrist wedge)', () => {
  const rest = new Map(armature.bones.map((bone) => [bone.name, new Matrix4().fromArray([...bone.restWorld])]))
  const wrist = new Vector3().setFromMatrixPosition(rest.get('low_right_arm.end')!)
  const pose = new Map(rest)
  pose.set('low_right_arm.end', new Matrix4().makeTranslation(wrist.x, wrist.y, wrist.z).multiply(new Matrix4().makeRotationX(1.2))
    .multiply(new Matrix4().makeTranslation(-wrist.x, -wrist.y, -wrist.z)).multiply(rest.get('low_right_arm.end')!))
  const fixed = untwistLimbs(armature, pose)
  assert.ok(fixed.maxHandDegrees > 60, `hand rotation measured ${fixed.maxHandDegrees}`)
  const hand = new Matrix4().copy(fixed.worlds.get('low_right_arm.end')!), restHand = rest.get('low_right_arm.end')!
  assert.ok(hand.elements.every((value, index) => Math.abs(value - restHand.elements[index]!) < 1e-6), 'hand back to its rest relation with the forearm')
})

test('exported .bobj keeps forearm/shin twist low (no wedge-shaped Steve arms) and reports before/after', async () => {
  const exported = await exportMinecraft20(await mixamoFromMinecraft(['emote_floss', 'running', 'emote_dab']), armatureText)
  assert.equal(exported.report.status, 'PASS')
  assert.ok(exported.report.limbTwist.maxAfterDegrees <= 15, `max twist after ${exported.report.limbTwist.maxAfterDegrees}`)
  assert.ok(exported.report.limbTwist.maxBeforeDegrees >= exported.report.limbTwist.maxAfterDegrees)
  assert.equal(exported.report.limbTwist.handsLocked, true)
  // measured again on what was written
  for (const action of parseBobjActions(exported.bobj).values()) for (let tick = 0; tick <= action.durationTicks; tick += 2) {
    const worlds = new Map(evaluateBobjAction(armature, action, tick).map((bone) => [bone.name, new Matrix4().fromArray(bone.worldMatrix)]))
    for (const [bone, degrees] of Object.entries(limbTwistDegrees(armature, worlds))) assert.ok(degrees <= 15, `${action.name}@${tick} ${bone} ${degrees.toFixed(1)}°`)
  }
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
