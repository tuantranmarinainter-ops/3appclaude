import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createReverseRetargeter, evaluateBobjAction, evaluateBobjChannel, parseBobjActions, parseBobjArmature, type BobjChannel, type MixamoPoseBone } from '../../../packages/retarget/src/index.ts'

const fixture = new URL('../public/retarget/v9.12/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('action_manifest.json', fixture), 'utf8')) as {
  action_count: number
  actions: Array<{ name: string; bones: string[]; max_time: number; keyframes: number }>
}
const names = JSON.parse(readFileSync(new URL('action_names_i18n.json', fixture), 'utf8')) as {
  total_actions: number
  actions: Record<string, { en?: string; vi?: string }>
}

test('V9.12 BOBJ library parses all 85 actions with manifest parity', () => {
  const text = readFileSync(fileURLToPath(new URL('minecraft-actions.bobj', fixture)), 'utf8')
  const actions = parseBobjActions(text)
  assert.equal(actions.size, 85)
  assert.equal(actions.size, manifest.action_count)
  assert.equal(names.total_actions, 85)

  for (const expected of manifest.actions) {
    const action = actions.get(expected.name)
    assert.ok(action, `missing action ${expected.name}`)
    const channels = [...action.groups.values()].flatMap((group) => group.channels)
    assert.deepEqual([...action.groups.keys()].sort(), [...expected.bones].sort(), `${expected.name} bones`)
    assert.equal(channels.reduce((count, channel) => count + channel.keys.length, 0), expected.keyframes, `${expected.name} keyframes`)
    assert.ok(Math.abs(action.durationTicks - expected.max_time) < 1e-6, `${expected.name} duration`)
    assert.equal(typeof names.actions[expected.name]?.en, 'string', `${expected.name} English label`)
    assert.equal(typeof names.actions[expected.name]?.vi, 'string', `${expected.name} Vietnamese label`)
  }
})

test('BOBJ channel evaluator keeps constant, linear and Bezier behavior', () => {
  const channel = (keys: BobjChannel['keys']): BobjChannel => ({ path: 'location', index: 0, keys })
  assert.equal(evaluateBobjChannel(channel([{ t: 0, v: 2, mode: 'CONSTANT' }, { t: 10, v: 8, mode: 'LINEAR' }]), 5), 2)
  assert.equal(evaluateBobjChannel(channel([{ t: 0, v: 0, mode: 'LINEAR' }, { t: 10, v: 10, mode: 'LINEAR' }]), 2.5), 2.5)
  assert.equal(evaluateBobjChannel(channel([{ t: 0, v: 0, mode: 'SINE' }, { t: 10, v: 10, mode: 'LINEAR' }]), 5), 5)
  assert.ok(Math.abs(evaluateBobjChannel(channel([
    { t: 0, v: 0, mode: 'BEZIER', rx: 0, ry: 0 },
    { t: 10, v: 10, mode: 'LINEAR', lx: 10, ly: 10 },
  ]), 5) - 5) < 1e-4)
})

test('BOBJ parser rejects malformed keyframes and evaluator rejects invalid time', () => {
  assert.throws(() => parseBobjActions('kf 0 1 LINEAR'))
  assert.throws(() => parseBobjActions('an walk\nao hips\nag location 0\nkf NaN 1 LINEAR'))
  assert.throws(() => evaluateBobjChannel({ path: 'rotation', index: 0, keys: [] }, Number.NaN))
})

test('V9.12 sampler evaluates every Minecraft action on its native armature', () => {
  const armature = parseBobjArmature(readFileSync(fileURLToPath(new URL('minecraft20-armature.bobj', fixture)), 'utf8'))
  const actions = parseBobjActions(readFileSync(fileURLToPath(new URL('minecraft-actions.bobj', fixture)), 'utf8'))
  let animated = false
  for (const action of actions.values()) {
    const pose = evaluateBobjAction(armature, action, action.durationTicks * 0.37)
    assert.equal(pose.length, armature.bones.length)
    assert.ok(pose.every((bone) => [...bone.position, ...bone.rotation, ...bone.scale, ...bone.worldMatrix].every(Number.isFinite)), action.name)
    if (pose.some((bone, index) => bone.worldMatrix.some((value, element) => Math.abs(value - armature.bones[index]!.restWorld[element]!) > 1e-4))) animated = true
  }
  assert.ok(animated, 'the native library sample should move at least one Minecraft bone')
  assert.throws(() => evaluateBobjAction(armature, actions.values().next().value!, Number.NaN), /timeTicks/)
})

function mixamoPose(): MixamoPoseBone[] {
  const positions: Record<string, [number, number, number]> = {
    Hips: [1, 2, 3], Spine2: [0, 1, 0], Head: [0, 2, 0],
    LeftArm: [0, 1, 0], LeftForeArm: [-1, 1, 0], LeftHand: [-2, 1, 0],
    RightArm: [0, 1, 0], RightForeArm: [1, 1, 0], RightHand: [2, 1, 0],
    LeftUpLeg: [0, 0, 0], LeftLeg: [0, -1, 0], LeftFoot: [0, -2, 0],
    RightUpLeg: [0, 0, 0], RightLeg: [0, -1, 0], RightFoot: [0, -2, 0],
  }
  return Object.entries(positions).map(([name, worldPosition]) => ({
    name,
    restWorldPosition: name === 'Hips' ? [0, 0, 0] : worldPosition,
    worldPosition,
    restWorldQuaternion: [0, 0, 0, 1],
    worldQuaternion: name === 'Head' ? [0, 0, Math.SQRT1_2, Math.SQRT1_2] : [0, 0, 0, 1],
  }))
}

test('V9.12 embedded Minecraft20 armature parses and rest pose round-trips through reverse solver', () => {
  const text = readFileSync(fileURLToPath(new URL('minecraft20-armature.bobj', fixture)), 'utf8')
  const armature = parseBobjArmature(text)
  assert.equal(armature.bones.length, 20)
  assert.equal(armature.bones[0].name, 'anchor')
  const result = createReverseRetargeter(armature).evaluate(mixamoPose(), { intensity: 0, rootMotion: false })
  assert.equal(result.length, 20)
  for (const [index, bone] of result.entries()) {
    assert.equal(bone.name, armature.bones[index].name)
    for (const [element, value] of bone.worldMatrix.entries()) assert.ok(Math.abs(value - armature.bones[index].restWorld[element]) < 1e-5, `${bone.name} matrix[${element}]`)
  }
})

test('V9.12 reverse solver applies root travel policy and source rotations', () => {
  const text = readFileSync(fileURLToPath(new URL('minecraft20-armature.bobj', fixture)), 'utf8')
  const solver = createReverseRetargeter(text)
  const source = mixamoPose()
  const inPlace = solver.evaluate(source, { intensity: 0, rootMotion: false })
  const follow = solver.evaluate(source, { intensity: 0, rootMotion: false, rootTravelMode: 'follow' })
  const ratio = Math.max(...solver.armature.bones.map((bone) => bone.head[1]), ...solver.armature.bones.map((bone) => bone.tail[1])) - Math.min(...solver.armature.bones.map((bone) => bone.head[1]), ...solver.armature.bones.map((bone) => bone.tail[1]))
  const heightRatio = ratio / 1.8
  const rootA = inPlace.find((bone) => bone.name === 'body')!.worldMatrix
  const rootB = follow.find((bone) => bone.name === 'body')!.worldMatrix
  assert.ok(Math.abs((rootB[12] - rootA[12]) - heightRatio) < 1e-5)
  assert.ok(Math.abs((rootB[14] - rootA[14]) - 3 * heightRatio) < 1e-5)
  assert.notDeepEqual(inPlace.find((bone) => bone.name === 'head')!.rotation, solver.evaluate(source).find((bone) => bone.name === 'head')!.rotation)
  assert.ok(follow.every((bone) => [...bone.position, ...bone.rotation, ...bone.scale, ...bone.worldMatrix].every(Number.isFinite)))
})

test('reverse solver applies an explicit semantic source-bone mapping', () => {
  const text = readFileSync(fileURLToPath(new URL('minecraft20-armature.bobj', fixture)), 'utf8')
  const source = mixamoPose()
  const solver = createReverseRetargeter(text)
  const defaults = solver.evaluate(source)
  const rest = solver.evaluate(source, { intensity: 0, rootMotion: false })
  const mapped = createReverseRetargeter(text, { pelvis: 'Hips', head: 'LeftHand' }).evaluate(source)
  assert.notDeepEqual(mapped.find((bone) => bone.name === 'head')!.rotation, defaults.find((bone) => bone.name === 'head')!.rotation)
  assert.ok(mapped.find((bone) => bone.name === 'head')!.rotation.every((value, index) => Math.abs(value - rest.find((bone) => bone.name === 'head')!.rotation[index]!) < 1e-6))
  assert.throws(() => createReverseRetargeter(text, { head: 'Head' }), /requires a pelvis/)
  assert.throws(() => createReverseRetargeter(text, { pelvis: 'Hips', unknown: 'Head' }), /Invalid source bone mapping/)
  assert.throws(() => createReverseRetargeter(text, { pelvis: 'Hips', head: 'Missing' }).evaluate(source), /missing mapped source bone/)
})

test('reverse solver rejects missing hips, zero quaternions and invalid controls', () => {
  const text = readFileSync(fileURLToPath(new URL('minecraft20-armature.bobj', fixture)), 'utf8')
  const solver = createReverseRetargeter(text)
  assert.throws(() => solver.evaluate([]), /Mixamo Hips/)
  const broken = mixamoPose()
  broken[0] = { ...broken[0], worldQuaternion: [0, 0, 0, 0] }
  assert.throws(() => solver.evaluate(broken), /Quaternion/)
  assert.throws(() => solver.evaluate(mixamoPose(), { intensity: 3 }), /\[0, 2\]/)
  assert.throws(() => parseBobjArmature('arm_bone root 0 0 0 NaN'), /invalid arm_bone/)
})
