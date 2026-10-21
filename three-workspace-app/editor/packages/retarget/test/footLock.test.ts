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

test('GLB roundtrip preserves contact height and lengths when the anchor is unreachable',async()=>{
 const { MIXAMO65_BONE_PARENTS }=await import('../src/mixamo65.ts')
 const { universalFramesToGlb }=await import('../src/universalGlb.ts')
 const { GLTFLoader }=await import('three/addons/loaders/GLTFLoader.js')
 const { createThreeRigAdapter }=await import('../src/threeRigAdapter.ts')
 const { contactMask }=await import('../src/footContacts.ts')
 const rest=new Map<string,Matrix4>(),locals=new Map<string,Matrix4>()
 const rig:RetargetRig={fingerprint:'height-regression',bones:MIXAMO65_BONE_PARENTS.map(([id,parentId])=>{
  let p=[0,0.01,0]
  if(id==='Hips')p=[0,1.1,0]
  if(id.endsWith('UpLeg'))p=[id.startsWith('Left')?0.15:-0.15,0,0]
  else if(id.endsWith('Leg'))p=[0,-0.55,0.08]
  else if(id.endsWith('Foot'))p=[0,-0.55,-0.08]
  else if(id.endsWith('ToeBase'))p=[0,0,0.15]
  else if(id.endsWith('Toe_End'))p=[0,0,0.05]
  const local=new Matrix4().makeTranslation(...p as [number,number,number]),world=parentId?rest.get(parentId)!.clone().multiply(local):local
  rest.set(id,world);locals.set(id,local);return {id,name:id,parentId,restWorld:world.toArray()}
 })}
 const frames:UniversalBakeFrame[]=Array.from({length:61},(_,i)=>({frame:i,timeSeconds:i/30,bones:rig.bones.map(b=>{
  const p=new Vector3(),q=new Quaternion(),s=new Vector3();locals.get(b.id)!.decompose(p,q,s)
  const travel=i*0.005,rise=0.005*Math.sin(i*Math.PI/60)
  if(!b.parentId){p.x+=travel;p.y+=rise}
  const world=rest.get(b.id)!.clone();world.elements[12]!+=travel;world.elements[13]!+=rise
  return {targetBoneId:b.id,targetBoneName:b.id,position:p.toArray(),rotation:q.toArray(),scale:s.toArray(),world:world.toArray()}
 })}))
 const original=structuredClone(frames),joints=rig.bones.map(b=>b.id),off=universalFramesToGlb(rig,joints,original)
 const result=lockFeet(rig,frames);assert.ok(result.unreachableFrames>0)
 const load=async(bytes:Uint8Array)=>{const gltf=await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer,'');gltf.scene.animations=gltf.animations;return createThreeRigAdapter(gltf.scene,{fingerprint:'roundtrip'})}
 const before=await load(off),after=await load(universalFramesToGlb(rig,joints,frames))
 const samples=(adapter:typeof before)=>Array.from({length:61},(_,i)=>new Map(adapter.sample(0,i/30).map(b=>[adapter.rig.bones.find(r=>r.id===b.id)!.name!,point(b.world)])))
 const a=samples(before),b=samples(after),metrics:Record<string,unknown>={}
 for(const side of ['Left','Right']) {
  const offContact=contactMask(a.map((s,i)=>({y:s.get(`${side}Foot`)!.y,time:i/30})),0)
  const onContact=contactMask(b.map((s,i)=>({y:s.get(`${side}Foot`)!.y,time:i/30})),0)
  let slide=0,maxHeight=0
  for(let i=0;i<b.length;i++){
   const foot=b[i]!.get(`${side}Foot`)!,hip=b[i]!.get(`${side}UpLeg`)!,knee=b[i]!.get(`${side}Leg`)!
   if(offContact[i])maxHeight=Math.max(maxHeight,Math.abs(foot.y-a[i]!.get(`${side}Foot`)!.y))
   if(i&&onContact[i]&&onContact[i-1]){const prev=b[i-1]!.get(`${side}Foot`)!;slide+=Math.hypot(foot.x-prev.x,foot.z-prev.z)}
   assert.ok(knee.z>=foot.z-1e-5,'no reverse knee bend')
   for(const [u,v] of [[hip,knee],[knee,foot]] as const){assert.ok(Number.isFinite(u.distanceTo(v)))}
   assert.ok(Math.abs(hip.distanceTo(knee)-a[i]!.get(`${side}UpLeg`)!.distanceTo(a[i]!.get(`${side}Leg`)!))<1e-5)
   assert.ok(Math.abs(knee.distanceTo(foot)-a[i]!.get(`${side}Leg`)!.distanceTo(a[i]!.get(`${side}Foot`)!))<1e-5)
  }
  const retention=onContact.filter(Boolean).length/offContact.filter(Boolean).length
  assert.ok(slide<0.2,`${side} slide ${slide}`);assert.ok(maxHeight<=0.01);assert.ok(retention>=0.9)
  metrics[side]={slideMeters:slide,maxAnkleHeightDeltaMeters:maxHeight,contactRetention:retention}
 }
 console.log('D1b GLB measurements',JSON.stringify(metrics))
 before.dispose();after.dispose()
})

test('entry/exit ramps keep authored ankle height and blend without a correction jump',()=>{
 const {rig,frames}=sliding()
 for(const [i,f] of frames.entries()) {
  const lift=i<15?0.15*(15-i)/15:i>45?0.15*(i-45)/15:0
  for(const b of f.bones){b.world[13]!+=lift;if(b.targetBoneName==='Hips')b.position[1]!+=lift}
 }
 const before=structuredClone(frames),result=lockFeet(rig,frames)
 assert.ok(result.contactRanges.left[0]![0]>0)
 let previous=0
 for(const [i,f] of frames.entries()){
  const foot=point(f.bones.find(b=>b.targetBoneName==='LeftFoot')!.world),original=point(before[i]!.bones.find(b=>b.targetBoneName==='LeftFoot')!.world)
  assert.ok(Math.abs(foot.y-original.y)<1e-6)
  const correction=foot.x-original.x
  assert.ok(Math.abs(correction-previous)<0.03,'smooth boundary correction')
  previous=correction
 }
})
