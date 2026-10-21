import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Matrix4,Quaternion,Vector3} from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {MIXAMO65_BONE_PARENTS} from '../src/mixamo65.ts'
import {lockFeet} from '../src/footLock.ts'
import {universalFramesToGlb} from '../src/universalGlb.ts'
import {createThreeRigAdapter} from '../src/threeRigAdapter.ts'
import {QualityMeter} from '../cli/quality.ts'
import {contactMask} from '../src/footContacts.ts'
import type {RetargetRig} from '../src/universal.ts'
import type {UniversalBakeFrame} from '../src/universalBake.ts'
const point=(w:number[])=>new Vector3().setFromMatrixPosition(new Matrix4().fromArray(w))
const q=(w:number[])=>{const rotation=new Quaternion();new Matrix4().fromArray(w).decompose(new Vector3(),rotation,new Vector3());return rotation}
function sambaLike(travel:number){
 const rest=new Map<string,Matrix4>(),locals=new Map<string,Matrix4>()
 const rig:RetargetRig={fingerprint:'samba-like',bones:MIXAMO65_BONE_PARENTS.map(([id,parentId])=>{
  let p=[0,0.01,0]
  if(id==='Hips')p=[0,1.2,0]
  if(id.endsWith('UpLeg'))p=[id.startsWith('Left')?0.15:-0.15,0,0]
  else if(id.endsWith('Leg'))p=[0,-0.55,0.08]
  else if(id.endsWith('Foot'))p=[0,-0.55,-0.08]
  else if(id.endsWith('ToeBase'))p=[0,-0.1,0.15]
  else if(id.endsWith('Toe_End'))p=[0,0,0.05]
  const local=new Matrix4().makeTranslation(...p as [number,number,number]),world=parentId?rest.get(parentId)!.clone().multiply(local):local
  rest.set(id,world);locals.set(id,local);return {id,name:id,parentId,restWorld:world.toArray()}
 })}
 const length=Math.hypot(0.55,0.08),frames:UniversalBakeFrame[]=[]
 for(let i=0;i<=120;i++){
  const t=i/120,hipHeight=1.1+0.1*Math.cos(t*Math.PI*2),vertical=hipHeight-0.1,kneeZ=Math.sqrt(length*length-(vertical/2)**2)
  const upper=new Quaternion().setFromUnitVectors(new Vector3(0,-0.55,0.08).normalize(),new Vector3(0,-vertical/2,kneeZ).normalize())
  const lower=new Quaternion().setFromUnitVectors(new Vector3(0,-0.55,-0.08).normalize(),new Vector3(0,-vertical/2,-kneeZ).normalize())
  const world=new Map<string,Matrix4>()
  frames.push({frame:i,timeSeconds:i/30,bones:rig.bones.map(b=>{
   const p=new Vector3(),rotation=new Quaternion(),scale=new Vector3();locals.get(b.id)!.decompose(p,rotation,scale)
   if(b.id==='Hips'){p.y=hipHeight;p.x=travel*t+0.025*Math.sin(t*4*Math.PI)}
   if(b.id.endsWith('UpLeg'))rotation.copy(upper)
   else if(b.id.endsWith('Leg'))rotation.copy(upper).invert().multiply(lower)
   else if(b.id.endsWith('Foot'))rotation.copy(lower).invert().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),0.7*Math.sin(t*6*Math.PI)))
   else if(b.id.endsWith('ToeBase'))rotation.setFromAxisAngle(new Vector3(0,1,0),0.3*Math.sin(t*8*Math.PI))
   const local=new Matrix4().compose(p,rotation,scale),matrix=b.parentId?world.get(b.parentId)!.clone().multiply(local):local
   world.set(b.id,matrix)
   return {targetBoneId:b.id,targetBoneName:b.id,position:p.toArray(),rotation:rotation.toArray(),scale:scale.toArray(),world:matrix.toArray()}
  })})
 }
 return {rig,frames}
}
async function readWritten(rig:RetargetRig,frames:UniversalBakeFrame[]){
 const dir=mkdtempSync(path.join(tmpdir(),'foot-lock-samba-')),file=path.join(dir,'motion.glb')
 try{
  writeFileSync(file,universalFramesToGlb(rig,rig.bones.map(b=>b.id),frames))
  const gltf=await new GLTFLoader().parseAsync(Uint8Array.from(readFileSync(file)).buffer,'');gltf.scene.animations=gltf.animations
  const adapter=createThreeRigAdapter(gltf.scene,{fingerprint:'written'})
  try{return frames.map(frame=>new Map(adapter.sample(0,frame.timeSeconds).map(b=>[adapter.rig.bones.find(n=>n.id===b.id)!.name!,b.world])))}finally{adapter.dispose()}
 }finally{rmSync(dir,{recursive:true,force:true})}
}
const quality=(samples:Map<string,number[]>[])=>{const meter=new QualityMeter();samples.forEach((s,i)=>meter.push(new Map([...s].map(([id,w])=>[id,w.slice(12,15)])),i/30));return meter.finish(1.2,null)}
for(const travel of [0.3,0.36,0.55])test(`Samba-like written GLB: bobbing knees, yawing planted feet, ${travel} m root travel`,async()=>{
 const {rig,frames}=sambaLike(travel),original=structuredClone(frames),off=await readWritten(rig,original)
 const report=lockFeet(rig,frames),on=await readWritten(rig,frames),before=quality(off),after=quality(on)
 for(const [i,frame] of frames.entries())for(const bone of frame.bones){
  const previous=original[i]!.bones.find(b=>b.targetBoneId===bone.targetBoneId)!
  assert.deepEqual(bone.position,previous.position);assert.deepEqual(bone.scale,previous.scale)
  if(!/^(Left|Right)(UpLeg|Leg|Foot|ToeBase)$/.test(bone.targetBoneId))assert.deepEqual(bone.rotation,previous.rotation,'body rotations unchanged')
 }
 assert.ok(before.footSlideMeters.left>0.5,'fixture exposes ToeBase rotation drift')
 const measurements:Record<string,unknown>={slideAfterMeters:after.footSlideMeters,contactFrames:after.contactFrames,reAnchoredSegments:report.reAnchoredSegments,maxBudgetUsed:report.maxAnkleHeightDeltaMeters}
 for(const side of ['Left','Right'] as const){
  const key=side==='Left'?'left':'right'
  assert.ok(after.footSlideMeters[key]<0.2,`${key}: ${after.footSlideMeters[key]}`)
  assert.ok(Math.abs(after.footSlideMeters[key]-report.slideAfterMeters[key])<1e-5,'same metric as quality.ts on written GLB')
  assert.ok(after.contactFrames[key]>=0.9*before.contactFrames[key])
  const contacts=contactMask(off.map((s,i)=>({y:Math.min(s.get(`${side}Foot`)![13]!,s.get(`${side}ToeBase`)![13]!),time:i/30})),before.groundY)
  let height=0,segmentError=0,maxYawDelta=0
  for(let i=0;i<on.length;i++){
   const a=on[i]!,b=off[i]!,ankle=point(a.get(`${side}Foot`)!),hip=point(a.get(`${side}UpLeg`)!),knee=point(a.get(`${side}Leg`)!)
   if(contacts[i])height=Math.max(height,Math.abs(ankle.y-point(b.get(`${side}Foot`)!).y))
   assert.ok(knee.z>=ankle.z-1e-5,'knees do not invert')
   for(const [u,v] of [[`${side}UpLeg`,`${side}Leg`],[`${side}Leg`,`${side}Foot`],[`${side}Foot`,`${side}ToeBase`]])segmentError=Math.max(segmentError,Math.abs(point(a.get(u!)!).distanceTo(point(a.get(v!)!))-point(b.get(u!)!).distanceTo(point(b.get(v!)!))))
   for(const role of ['Foot','ToeBase']){const rotation=q(a.get(`${side}${role}`)!);maxYawDelta=Math.max(maxYawDelta,Math.abs(2*Math.atan2(rotation.y,rotation.w)))}
   assert.deepEqual(frames[i]!.bones.find(n=>n.targetBoneId==='Hips'),original[i]!.bones.find(n=>n.targetBoneId==='Hips'))
  }
  assert.ok(height<=0.01,`ankle delta ${height}`);assert.ok(segmentError<1e-5);assert.ok(maxYawDelta<1e-5,'Foot and ToeBase yaw locked')
  measurements[key]={maxAnkleHeightDeltaMeters:height,segmentLengthErrorMeters:segmentError,maxYawDeltaRadians:maxYawDelta}
 }
 console.log('Samba-like measurements',travel,JSON.stringify(measurements))
})
