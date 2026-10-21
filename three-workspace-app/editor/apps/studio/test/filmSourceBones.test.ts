import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { filmSourceBones } from '../src/unifiedFilmSampling.ts'

const trs = (position: number[], rotation: number[] = [0, 0, 0, 1]) => ({ position, rotation, scale: [1, 1, 1] })
const world = (bones: ReturnType<typeof filmSourceBones>, id: string) => {
  const byId = new Map(bones.map((bone) => [bone.id, bone]))
  let matrix = new Matrix4(), bone = byId.get(id)
  const chain = []
  while (bone) { chain.unshift(bone); bone = bone.parentId ? byId.get(bone.parentId) : undefined }
  for (const item of chain) { const r = item.rest as any; matrix = matrix.multiply(new Matrix4().compose(new Vector3().fromArray(r.position), new Quaternion().fromArray(r.rotation), new Vector3().fromArray(r.scale))) }
  return matrix
}

test('GLB armature root is folded into the first bone and names match three.js samples', () => {
  const quarter = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2).toArray()
  const source = [
    { id: 'arm', name: 'FEMALE_ADULT_Armature', parentId: null, rest: trs([0, 0.01, 0], quarter), deform: false },
    { id: 'hips', name: 'mixamorig:Hips', parentId: 'arm', rest: trs([0, 0, -0.9]), deform: true },
    { id: 'spine', name: 'mixamorig:Spine', parentId: 'hips', rest: trs([0, 0.1, 0]), deform: true },
  ] as any
  const bones = filmSourceBones(source)
  assert.deepEqual(bones.map((bone) => [bone.name, bone.parentId]), [['mixamorigHips', null], ['mixamorigSpine', 'hips']])
  // World rest of the kept bones is unchanged by folding the armature transform.
  const original = new Matrix4().compose(new Vector3(0, 0.01, 0), new Quaternion().fromArray(quarter), new Vector3(1, 1, 1))
    .multiply(new Matrix4().makeTranslation(0, 0, -0.9)).multiply(new Matrix4().makeTranslation(0, 0.1, 0))
  assert.ok(world(bones, 'spine').elements.every((value, index) => Math.abs(value - original.elements[index]!) < 1e-9))
})

test('FBX-style skeletons whose root is a deform bone are left untouched (apart from name sanitizing)', () => {
  const source = [
    { id: 'hips', name: 'mixamorigHips', parentId: null, rest: trs([0, 1, 0]), deform: true },
    { id: 'end', name: 'mixamorigHeadTop_End', parentId: 'hips', rest: trs([0, 0.5, 0]), deform: false },
  ] as any
  assert.deepEqual(filmSourceBones(source).map((bone) => [bone.name, bone.parentId, (bone.rest as any).position]), [['mixamorigHips', null, [0, 1, 0]], ['mixamorigHeadTop_End', 'hips', [0, 0.5, 0]]])
})
