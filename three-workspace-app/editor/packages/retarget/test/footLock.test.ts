import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { RetargetRig } from '../src/universal.ts'
import type { UniversalBakeFrame } from '../src/universalBake.ts'
import { lockFeet } from '../src/footLock.ts'
import { QualityMeter } from '../cli/quality.ts'
const identity = new Quaternion(), one = new Vector3(1,1,1)
function sliding() {
 const definitions: Array<[string,string|null,number[]]>=[['Hips',null,[0,1.1,0]]]
 for(const side of ['Left','Right']) definitions.push([`${side}UpLeg`,'Hips',[side==='Left'?0.15:-0.15,0,0]], [`${side}Leg`,`${side}UpLeg`,[0,-0.55,0.2]], [`${side}Foot`,`${side}Leg`,[0,-0.55,-0.2]])
 const rest = new Map<string, Matrix4>()
 const rig:RetargetRig={fingerprint:'synthetic',bones:definitions.map(([id,parentId,p])=>{
  const local=new Matrix4().compose(new Vector3().fromArray(p),identity,one), world=parentId?rest.get(parentId)!.clone().multiply(local):local
  rest.set(id,world);return {id,name:id,parentId,restWorld:world.toArray()}
 })}
 const frames:UniversalBakeFrame[]=Array.from({length:61},(_,i)=>({frame:i,timeSeconds:i/30,bones:definitions.map(([id,parentId,p])=>{
  const position=[...p]; if(!parentId)position[0]=i*0.002
  const world=rest.get(id)!.clone();world.elements[12]!+=i*0.002
  return {targetBoneId:id,targetBoneName:id,position,rotation:identity.toArray(),scale:one.toArray(),world:world.toArray()}
 })}))
 return {rig,frames}
}
const point=(w:number[])=>new Vector3().setFromMatrixPosition(new Matrix4().fromArray(w))
test('contact IK removes intentional slide below 1 cm, preserves hips, lengths and forward knees',()=>{
 const {rig,frames}=sliding(), original=structuredClone(frames), meter=new QualityMeter()
 for(const f of frames)meter.push(new Map(f.bones.map(b=>[b.targetBoneName,b.world.slice(12,15)])),f.timeSeconds)
 assert.ok(meter.finish(1.1,null).footSlideMeters.left>0.1)
 const report=lockFeet(rig,frames);assert.equal(report.unreachableFrames,0);assert.ok(report.maxResidualMeters<1e-5)
 for(const [i,f] of frames.entries()) {
  const bones=new Map(f.bones.map(b=>[b.targetBoneId,b])), before=new Map(original[i]!.bones.map(b=>[b.targetBoneId,b]))
  assert.deepEqual(bones.get('Hips'),before.get('Hips'))
  for(const side of ['Left','Right']) {
   const hip=point(bones.get(`${side}UpLeg`)!.world),knee=point(bones.get(`${side}Leg`)!.world),foot=point(bones.get(`${side}Foot`)!.world)
   assert.ok(foot.distanceTo(point(original[0]!.bones.find(b=>b.targetBoneId===`${side}Foot`)!.world))<0.01)
   assert.ok(knee.z>0,'knee keeps its bend direction')
   assert.ok(Math.abs(hip.distanceTo(knee)-Math.hypot(0.55,0.2))<1e-6)
   assert.ok(Math.abs(knee.distanceTo(foot)-Math.hypot(0.55,0.2))<1e-6)
  }
 }
 const after=new QualityMeter();for(const f of frames)after.push(new Map(f.bones.map(b=>[b.targetBoneName,b.world.slice(12,15)])),f.timeSeconds)
 assert.ok(after.finish(1.1,null).footSlideMeters.left<0.01)
})

test('unreachable contacts are reported without stretching or nonfinite transforms',()=>{
 const {rig,frames}=sliding();for(let i=0;i<frames.length;i++)for(const bone of frames[i]!.bones){bone.world[12]!+=i*0.1;if(bone.targetBoneName==='Hips')bone.position[0]!+=i*0.1}
 const result=lockFeet(rig,frames);assert.ok(result.unreachableFrames>0)
 assert.ok(frames.every(f=>f.bones.every(b=>[...b.world,...b.rotation].every(Number.isFinite))))
})
