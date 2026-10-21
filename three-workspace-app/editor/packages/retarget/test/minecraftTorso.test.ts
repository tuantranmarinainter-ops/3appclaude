import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { parseBobjArmature } from '../src/reverse.ts'
import { limitTorso, torsoDegrees, TORSO_LIMITS } from '../cli/toMinecraft20.ts'
const root = dirname(fileURLToPath(import.meta.url))
const rig = parseBobjArmature(readFileSync(resolve(root, '../../../apps/studio/public/retarget/v9.12/minecraft20-armature.bobj'), 'utf8'))
const rotation = (m:Matrix4) => { const q=new Quaternion();m.decompose(new Vector3(),q,new Vector3());return q }
function pose(bend:number, twist:number) {
 const worlds = new Map<string,Matrix4>()
 for(const bone of rig.bones) {
  const local = new Matrix4().fromArray([...bone.restLocal])
  if(bone.name==='body') local.multiply(new Matrix4().makeRotationY(0.4))
  if(bone.name==='low_body') local.multiply(new Matrix4().makeRotationX(bend*Math.PI/180)).multiply(new Matrix4().makeRotationY(twist*Math.PI/180))
  worlds.set(bone.name,bone.parent ? worlds.get(bone.parent)!.clone().multiply(local) : local)
 }
 return worlds
}

test('torso cap bounds extreme forward/back/side bends and twists; hips and head world orientation stay unchanged',()=>{
 for(const bend of [-125,-76,0,76,125]) for(const twist of [-90,0,90]) {
  const before=pose(bend,twist), result=limitTorso(rig,before), after=torsoDegrees(rig,result.worlds)
  assert.ok(after.bendDegrees<=TORSO_LIMITS.bendDegrees+1e-5,JSON.stringify(after))
  assert.ok(after.twistDegrees<=TORSO_LIMITS.twistDegrees+1e-5,JSON.stringify(after))
  for(const name of ['body','head']) assert.ok(rotation(before.get(name)!).angleTo(rotation(result.worlds.get(name)!))<1e-6,name)
  for(const bone of rig.bones) if(bone.parent) {
   const length=(w:Map<string,Matrix4>)=>new Vector3().setFromMatrixPosition(w.get(bone.name)!).distanceTo(new Vector3().setFromMatrixPosition(w.get(bone.parent!)!))
   assert.ok(Math.abs(length(before)-length(result.worlds))<1e-6,bone.name)
  }
 }
})

test('an under-limit torso is unchanged, and applying the cap twice is idempotent',()=>{
 const rest=pose(10,10), fixed=limitTorso(rig,rest)
 for(const [name,world] of rest) assert.deepEqual(fixed.worlds.get(name)!.toArray(),world.toArray())
 const capped=limitTorso(rig,pose(100,70)), twice=limitTorso(rig,capped.worlds)
 for(const [name,world] of capped.worlds) assert.ok(world.elements.every((v,i)=>Math.abs(v-twice.worlds.get(name)!.elements[i]!)<1e-6))
})
