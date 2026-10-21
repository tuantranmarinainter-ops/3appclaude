import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { applyFootDirection, planFootDirection } from '../src/footDirection.ts'
import type { RetargetRig, UniversalRetargetFrame } from '../src/universal.ts'

const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z).toArray()
const pitch = (a: number[], b: number[]) => { const d = new Vector3().fromArray(b, 12).sub(new Vector3().fromArray(a, 12)); return Math.atan2(-d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI }
// Source: steep foot (ankle 0.24 above the ball, 70° pitch). Target: Mixamo-like 39°.
const deg = (d: number) => d * Math.PI / 180
const source: RetargetRig = { fingerprint: 's', bones: [
  { id: 'sLeg', name: 'leg', parentId: null, restWorld: at(0, 0.6, 0) },
  { id: 'sFoot', name: 'ankle', parentId: 'sLeg', restWorld: at(0, 0.3, 0) },
  { id: 'sToe', name: 'ball', parentId: 'sFoot', restWorld: at(0, 0.3 - Math.sin(deg(70)) * 0.1, Math.cos(deg(70)) * 0.1) },
] }
const target: RetargetRig = { fingerprint: 't', bones: [
  { id: 'tLeg', name: 'LeftLeg', parentId: null, restWorld: at(0, 0.5, 0) },
  { id: 'tFoot', name: 'LeftFoot', parentId: 'tLeg', restWorld: at(0, 0.08, 0) },
  { id: 'tToe', name: 'LeftToeBase', parentId: 'tFoot', restWorld: at(0, 0.08 - Math.sin(deg(39)) * 0.1, Math.cos(deg(39)) * 0.1) },
] }
const pairs = [{ sourceBoneId: 'sFoot', targetBoneId: 'tFoot', enabled: true }, { sourceBoneId: 'sToe', targetBoneId: 'tToe', enabled: true }]
const frame = (footWorld: number[]): UniversalRetargetFrame[] => {
  const leg = { targetBoneId: 'tLeg', targetBoneName: 'LeftLeg', position: [0, 0.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], world: at(0, 0.5, 0) }
  const local = new Matrix4().fromArray(at(0, 0.5, 0)).invert().multiply(new Matrix4().fromArray(footWorld)), p = new Vector3(), q = new Quaternion(), s = new Vector3(); local.decompose(p, q, s)
  const foot = { targetBoneId: 'tFoot', targetBoneName: 'LeftFoot', position: p.toArray(), rotation: q.toArray(), scale: s.toArray(), world: footWorld }
  const toeLocal = [0, -Math.sin(deg(39)) * 0.1, Math.cos(deg(39)) * 0.1]
  const toe = { targetBoneId: 'tToe', targetBoneName: 'LeftToeBase', position: toeLocal, rotation: [0, 0, 0, 1], scale: [1, 1, 1], world: new Matrix4().fromArray(footWorld).multiply(new Matrix4().makeTranslation(toeLocal[0]!, toeLocal[1]!, toeLocal[2]!)).toArray() }
  return [leg, foot, toe]
}

test('a source standing like its rest keeps the target foot at its own rest pitch, not the source 70°', () => {
  const plans = planFootDirection(source, target, pairs)
  assert.equal(plans.length, 1)
  // The solver gave the target foot a 25° toes-down rotation (source frame rotated about a skewed axis); the source's own direction did not change.
  const bones = frame(new Matrix4().makeTranslation(0, 0.08, 0).multiply(new Matrix4().makeRotationX(deg(25))).toArray())
  applyFootDirection(plans, target, source.bones.map((bone) => ({ id: bone.id, world: bone.restWorld })), bones)
  assert.ok(Math.abs(pitch(bones[1]!.world, bones[2]!.world) - 39) < 0.01, `pitch ${pitch(bones[1]!.world, bones[2]!.world)}`)
  assert.deepEqual(bones[1]!.world.slice(12, 15).map((v) => +v.toFixed(9)), [0, 0.08, 0], 'ankle stays')
})

test('a source pitch change of +15° becomes +15° on the target foot', () => {
  const plans = planFootDirection(source, target, pairs)
  const posed = source.bones.map((bone) => ({ id: bone.id, world: bone.restWorld }))
  posed[2] = { id: 'sToe', world: at(0, 0.3 - Math.sin(deg(85)) * 0.1, Math.cos(deg(85)) * 0.1) }
  const bones = frame(at(0, 0.08, 0))
  applyFootDirection(plans, target, posed, bones)
  assert.ok(Math.abs(pitch(bones[1]!.world, bones[2]!.world) - 54) < 0.01)
})
