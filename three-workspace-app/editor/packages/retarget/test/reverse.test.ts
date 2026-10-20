import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { createReverseRetargeter, parseBobjArmature, type MixamoPoseBone, type Quat } from '../src/reverse.ts'

const armatureText = await readFile(new URL('../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj', import.meta.url), 'utf8')
const armature = parseBobjArmature(armatureText)
const identity: Quat = [0, 0, 0, 1]
const current: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
const source: MixamoPoseBone[] = [
  { name: 'Hips', restWorldPosition: [0, 1, 0], restWorldQuaternion: identity, worldPosition: [0, 1, 0], worldQuaternion: identity },
  { name: 'mixamorig:Head', restWorldPosition: [0, 2, 0], restWorldQuaternion: identity, worldPosition: [0, 2, 0], worldQuaternion: current },
]

test('applies the V9.12 source reference quaternion before the source-to-target delta', () => {
  const reference: Quat = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)]
  const targetRest = new Quaternion()
  new Matrix4().fromArray([...armature.bones.find((bone) => bone.name === 'head')!.restWorld]).decompose(new Vector3(), targetRest, new Vector3())
  const expected = new Quaternion(...current).multiply(new Quaternion(...reference).invert()).multiply(targetRest).normalize()
  const head = createReverseRetargeter(armature, undefined, { Head: reference }).evaluate(source).find((bone) => bone.name === 'head')!
  const actual = new Quaternion()
  new Matrix4().fromArray([...head.worldMatrix]).decompose(new Vector3(), actual, new Vector3())
  assert.ok(actual.angleTo(expected) < 1e-6)
})

test('rejects malformed and canonically ambiguous source reference poses', () => {
  assert.throws(() => createReverseRetargeter(armature, undefined, { Head: [0, 0, 0, 0] }), /Quaternion must not be zero/)
  assert.throws(() => createReverseRetargeter(armature, undefined, { Head: identity, 'mixamorig:Head': identity }), /ambiguous source reference bone/)
})
