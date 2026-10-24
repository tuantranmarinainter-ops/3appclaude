import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { adjustFrames, DEFAULT_ADJUSTMENTS, resolveAdjustments, type AdjustmentSettings } from '../src/adjustments.ts'
import type { RetargetRig } from '../src/universal.ts'
import type { UniversalBakeFrame } from '../src/universalBake.ts'

// Tiny Mixamo-like rig, arms pointing forward (+Z) so the hands nearly touch: the case "arm spacing" exists for.
const rest: Array<[string, string | null, [number, number, number]]> = [
  ['Hips', null, [0, 1, 0]], ['LeftUpLeg', 'Hips', [0.1, 0, 0]], ['LeftLeg', 'LeftUpLeg', [0, -0.45, 0]], ['RightUpLeg', 'Hips', [-0.1, 0, 0]], ['RightLeg', 'RightUpLeg', [0, -0.45, 0]],
  ['LeftArm', 'Hips', [0.2, 0.5, 0]], ['LeftForeArm', 'LeftArm', [0, 0, 0.3]], ['LeftHand', 'LeftForeArm', [0, 0, 0.25]],
  ['RightArm', 'Hips', [-0.2, 0.5, 0]], ['RightForeArm', 'RightArm', [0, 0, 0.3]], ['RightHand', 'RightForeArm', [0, 0, 0.25]],
]
const worldsOf = (locals: Matrix4[]) => { const worlds: Matrix4[] = []; rest.forEach(([, parent], i) => worlds.push(parent ? worlds[rest.findIndex(([name]) => name === parent)]!.clone().multiply(locals[i]!) : locals[i]!.clone())); return worlds }
const restLocals = rest.map(([, , position]) => new Matrix4().makeTranslation(...position))
const rig: RetargetRig = { fingerprint: 'f', bones: rest.map(([name, parent], i) => ({ id: name, name: `mixamorig${name}`, parentId: parent, restWorld: worldsOf(restLocals)[i]!.toArray() })) }
const frame = (inward: number): UniversalBakeFrame => {
  // Both upper arms swing toward the midline by `inward` radians (yaw), like a clapping source on a long-armed character.
  const locals = rest.map(([name, , position], i) => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), name === 'LeftArm' ? -inward : name === 'RightArm' ? inward : 0)
    return new Matrix4().compose(new Vector3(...position), q, new Vector3(1, 1, 1))
  })
  const worlds = worldsOf(locals)
  return { frame: 0, timeSeconds: 0, bones: rest.map(([name], i) => { const p = new Vector3(), q = new Quaternion(), s = new Vector3(); locals[i]!.decompose(p, q, s)
    return { targetBoneId: name, targetBoneName: name, position: p.toArray(), rotation: q.toArray(), scale: s.toArray(), world: worlds[i]!.toArray() } }) }
}
const pos = (f: UniversalBakeFrame, name: string) => new Vector3().fromArray(f.bones.find((b) => b.targetBoneId === name)!.world, 12)
const handGap = (f: UniversalBakeFrame) => pos(f, 'LeftHand').distanceTo(pos(f, 'RightHand'))
const withSettings = (patch: Partial<AdjustmentSettings>) => ({ ...DEFAULT_ADJUSTMENTS, ...patch })

test('default settings are the identity (frames untouched)', () => {
  const frames = [frame(0.3)], before = JSON.stringify(frames)
  const report = adjustFrames(rig, frames, withSettings({}))
  assert.equal(report.applied, false)
  assert.equal(JSON.stringify(frames), before)
})

test('arm spacing widens the hands, + wider and - closer, mirrored left/right', () => {
  const base = frame(0.5), wide = [frame(0.5)], close = [frame(0.5)]
  adjustFrames(rig, wide, withSettings({ armSpace: 0.6 })); adjustFrames(rig, close, withSettings({ armSpace: -0.3 }))
  assert.ok(handGap(wide[0]!) > 0.05 && Math.abs(handGap(wide[0]!) - handGap(base)) > 0.01)
  const sx = (f: UniversalBakeFrame) => pos(f, 'LeftHand').x - pos(f, 'RightHand').x
  assert.ok(sx(base) < 0 && sx(wide[0]!) > sx(base) && sx(close[0]!) < sx(base), 'base hands cross; + uncrosses, - crosses more')
  const l = pos(wide[0]!, 'LeftHand').sub(pos(base, 'LeftHand')), r = pos(wide[0]!, 'RightHand').sub(pos(base, 'RightHand'))
  assert.ok(Math.abs(l.x + r.x) < 1e-6 && Math.abs(l.y - r.y) < 1e-6 && Math.abs(l.z - r.z) < 1e-6, 'right is the mirror of left')
  assert.ok(l.x > 0 && r.x < 0, 'left moves to +x, right to -x')
  assert.ok(Math.abs(pos(wide[0]!, 'LeftForeArm').distanceTo(pos(wide[0]!, 'LeftArm')) - 0.3) < 1e-6, 'limb length is kept')
})

test('leg spacing spreads the knees symmetrically and world matrices follow the locals', () => {
  const base = frame(0), spread = [frame(0)]
  adjustFrames(rig, spread, withSettings({ legSpace: 0.8 }))
  const gap = (f: UniversalBakeFrame) => pos(f, 'LeftLeg').distanceTo(pos(f, 'RightLeg'))
  assert.ok(gap(spread[0]!) > gap(base) + 0.1)
  assert.ok(Math.abs(pos(spread[0]!, 'LeftLeg').x + pos(spread[0]!, 'RightLeg').x) < 1e-6)
  const hand = spread[0]!.bones.find((b) => b.targetBoneId === 'LeftHand')!, fore = spread[0]!.bones.find((b) => b.targetBoneId === 'LeftForeArm')!
  const rebuilt = new Matrix4().fromArray(fore.world).multiply(new Matrix4().compose(new Vector3().fromArray(hand.position), new Quaternion().fromArray(hand.rotation), new Vector3().fromArray(hand.scale)))
  rebuilt.elements.forEach((value, i) => assert.ok(Math.abs(value - hand.world[i]!) < 1e-9))
})

test('proportion scales move the joints and unknown/out-of-range values are rejected', () => {
  const f = [frame(0)]
  adjustFrames(rig, f, withSettings({ upperArm: 1.2, forearm: 0.8 }))
  assert.ok(Math.abs(pos(f[0]!, 'LeftForeArm').distanceTo(pos(f[0]!, 'LeftArm')) - 0.36) < 1e-6)
  assert.ok(Math.abs(pos(f[0]!, 'LeftHand').distanceTo(pos(f[0]!, 'LeftForeArm')) - 0.2) < 1e-6)
  assert.throws(() => resolveAdjustments({ armSpace: 2 }), /armSpace/)
  assert.deepEqual(resolveAdjustments(null), DEFAULT_ADJUSTMENTS)
})

test('mirror: a left-only swing becomes the equal right-only swing, and mirroring twice restores the pose', () => {
  const leftOnly = (yaw: number, side: 'LeftArm' | 'RightArm') => { const f = frame(0); const swing = frame(yaw)
    for (const [i, bone] of f.bones.entries()) if (bone.targetBoneId === side || bone.targetBoneId.endsWith(side.slice(0, -3) + 'ForeArm') || bone.targetBoneId.endsWith(side.slice(0, -3) + 'Hand')) f.bones[i] = swing.bones[i]!
    // re-chain the world matrices with the swung arm only
    return f }
  const left = leftOnly(0.5, 'LeftArm'), rightExpected = leftOnly(0.5, 'RightArm')
  const mirrored = [structuredClone(left)]
  adjustFrames(rig, mirrored, withSettings({ mirror: true }))
  assert.ok(pos(mirrored[0]!, 'RightHand').distanceTo(pos(rightExpected, 'RightHand')) < 1e-6, 'right hand = mirrored left swing')
  assert.ok(pos(mirrored[0]!, 'LeftHand').distanceTo(pos(rightExpected, 'LeftHand')) < 1e-6)
  adjustFrames(rig, mirrored, withSettings({ mirror: true }))
  assert.ok(pos(mirrored[0]!, 'LeftHand').distanceTo(pos(left, 'LeftHand')) < 1e-6)
})

test('trim, speed and side selection', () => {
  const clip = Array.from({ length: 11 }, (_, i) => ({ ...frame(0), frame: i, timeSeconds: i / 10 }))
  const report = adjustFrames(rig, clip, withSettings({ trimStart: 0.2, trimEnd: 0.1, speed: 2 }))
  assert.equal(report.framesBefore, 11); assert.equal(report.framesAfter, clip.length)
  assert.equal(clip.length, 8)
  assert.ok(Math.abs((clip.at(-1)!.timeSeconds - clip[0]!.timeSeconds) - 0.35) < 1e-9, '0.7s of motion at 2x')
  const left = [frame(0.5)]
  adjustFrames(rig, left, withSettings({ armSpace: 0.6, proportionSide: 'left' }))
  const base = frame(0.5)
  assert.ok(pos(left[0]!, 'LeftHand').distanceTo(pos(base, 'LeftHand')) > 0.05)
  assert.ok(pos(left[0]!, 'RightHand').distanceTo(pos(base, 'RightHand')) < 1e-9, 'right side untouched')
  assert.throws(() => resolveAdjustments({ trimStart: 0.6, trimEnd: 0.6 }), /trim/)
  const joint = [frame(0)]
  adjustFrames(rig, joint, resolveAdjustments({ jointOffsets: { LeftArm: [0, 90, 0] } }))
  assert.ok(pos(joint[0]!, 'LeftHand').distanceTo(pos(frame(0), 'LeftHand')) > 0.1)
})

test('Workbench options: adjustments default to identity, are validated by name', async () => {
  const { parseOptions } = await import('../workbench/pipeline.ts')
  assert.deepEqual(parseOptions({}).adjustments, DEFAULT_ADJUSTMENTS)
  assert.equal(parseOptions({ adjustments: { armSpace: 0.4, mirror: true } }).adjustments.armSpace, 0.4)
  assert.throws(() => parseOptions({ adjustments: { armSpace: 3 } }), /options\.adjustments\.armSpace/)
  assert.throws(() => parseOptions({ adjustments: { nope: 1 } }), /nope/)
})
