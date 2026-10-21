import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { applyFingerCurl, DISTAL_FROM_MIDDLE, planFingerCurl } from '../src/fingerCurl.ts'
import type { RetargetRig, UniversalRetargetFrame } from '../src/universal.ts'

const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z).toArray()
// Mixamo-style finger: Hand → Index1 → Index2 → Index3 → Index4 (tip), 3 cm phalanges along +X.
const target: RetargetRig = { fingerprint: 'target', bones: [
  { id: 'hand', name: 'mixamorig:LeftHand', parentId: null, restWorld: at(0, 0, 0) },
  { id: 'i1', name: 'mixamorig:LeftHandIndex1', parentId: 'hand', restWorld: at(0.08, 0, 0) },
  { id: 'i2', name: 'mixamorig:LeftHandIndex2', parentId: 'i1', restWorld: at(0.11, 0, 0) },
  { id: 'i3', name: 'mixamorig:LeftHandIndex3', parentId: 'i2', restWorld: at(0.14, 0, 0) },
  { id: 'i4', name: 'mixamorig:LeftHandIndex4', parentId: 'i3', restWorld: at(0.17, 0, 0) },
] }
const pair = (targetBoneId: string) => ({ sourceBoneId: `s-${targetBoneId}`, targetBoneId, enabled: true })

/** Rest frames, then the middle joint bent by `degrees` about +Z (curling toward -Y). */
function frames(degrees: number): UniversalRetargetFrame[] {
  const locals = new Map<string, Matrix4>([['hand', new Matrix4()], ['i1', new Matrix4().makeTranslation(0.08, 0, 0)],
    ['i2', new Matrix4().compose(new Vector3(0.03, 0, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -degrees * Math.PI / 180), new Vector3(1, 1, 1))],
    ['i3', new Matrix4().makeTranslation(0.03, 0, 0)], ['i4', new Matrix4().makeTranslation(0.03, 0, 0)]])
  const worlds = new Map<string, Matrix4>()
  return target.bones.map((bone) => {
    const local = locals.get(bone.id)!, world = bone.parentId ? worlds.get(bone.parentId)!.clone().multiply(local) : local.clone()
    worlds.set(bone.id, world)
    const p = new Vector3(), q = new Quaternion(), s = new Vector3(); local.decompose(p, q, s)
    return { targetBoneId: bone.id, targetBoneName: bone.name!, position: p.toArray(), rotation: q.toArray(), scale: s.toArray(), world: world.toArray() }
  })
}

test('two-joint source fingers: the unmapped distal joint bends 2/3 of the middle joint and children follow', () => {
  const plans = planFingerCurl(target, ['hand', 'i1', 'i2'].map(pair))
  assert.deepEqual(plans.map((plan) => plan.finger), ['LeftHandIndex'])
  const bones = frames(60)
  applyFingerCurl(plans, target, bones)
  const byId = new Map(bones.map((bone) => [bone.targetBoneId, bone]))
  const distal = new Quaternion().fromArray(byId.get('i3')!.rotation)
  assert.ok(Math.abs(distal.angleTo(new Quaternion()) * 180 / Math.PI - 60 * DISTAL_FROM_MIDDLE) < 1e-9)
  // Tip world = middle world × distal local × tip local: the finger keeps its bone lengths and curls further.
  const mid = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(byId.get('i3')!.world))
  const tip = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(byId.get('i4')!.world))
  assert.ok(Math.abs(mid.distanceTo(tip) - 0.03) < 1e-9)
  const tipDirection = tip.clone().sub(mid).normalize()
  assert.ok(Math.abs(Math.acos(tipDirection.x) * 180 / Math.PI - 100) < 1e-6, `tip segment bends 60° + 40° from rest, got ${Math.acos(tipDirection.x) * 180 / Math.PI}`)
})

test('rest pose and three-joint sources (Mixamo, WC3) are left untouched', () => {
  const rest = frames(0), before = structuredClone(rest)
  applyFingerCurl(planFingerCurl(target, ['hand', 'i1', 'i2'].map(pair)), target, rest)
  for (const [index, bone] of rest.entries()) assert.ok(new Quaternion().fromArray(bone.rotation).angleTo(new Quaternion().fromArray(before[index]!.rotation)) < 1e-12)
  assert.deepEqual(planFingerCurl(target, ['hand', 'i1', 'i2', 'i3'].map(pair)), [])
  assert.deepEqual(planFingerCurl(target, ['hand', 'i1'].map(pair)), [])
})
