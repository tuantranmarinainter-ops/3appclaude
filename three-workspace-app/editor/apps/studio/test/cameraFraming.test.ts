import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Euler,Matrix4,PerspectiveCamera,Vector3} from 'three'
import {makeEmptyDraft} from '@topview/3d-builder'
import {executeUnifiedCommand,readUnifiedProject,readUnifiedProjectState} from '../src/unifiedProjectStore'
import {stageAssetUpload} from '../src/unifiedAssetFiles'
const dir=mkdtempSync(path.join(tmpdir(),'camera-framing-'));process.env.BBS_UNIFIED_PROJECTS_DIR=dir
test.after(()=>rmSync(dir,{recursive:true,force:true}))
const send=(id:string,command:string,args:any={},revision?:number)=>executeUnifiedCommand({requestId:randomUUID(),projectId:id,command,args,...(revision===undefined?{}:{expectedRevision:revision})})
async function setup(){
 const scene=makeEmptyDraft('Shots',30,60,{fov:50,position:{x:0,y:2,z:5},rotation:{x:0,y:0,z:0},lookAt:{x:0,y:1,z:0}})
 const id=(await executeUnifiedCommand({requestId:randomUUID(),command:'project.create',args:{name:'Shots',scene}})).projectId
 let rev=(await readUnifiedProject(id)).revision
 const ids:string[]=[]
 for(const [x,file] of [[-0.75,'a3d_char_30ec53c93eae4173946b38639691ebe0.glb'],[0.75,'a3d_char_461b4f4b76ae4b198f439fa4f6f743b6.glb']] as const){
  const bytes=readFileSync(path.resolve(process.cwd(),'../../../builtin-assets/characters',file))
  const upload=await stageAssetUpload(file,new ReadableStream({start(c){c.enqueue(bytes);c.close()}}))
  const imported=await send(id,'asset.import',{files:[upload.id],format:'glb'},rev++)
  const added=await send(id,'character.add',{assetId:(imported.result.assetIds as string[])[0],skeletonId:(imported.result.skeletonIds as string[])[0],name:`Actor ${x}`,transform:{position:{x,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}},rev++)
  ids.push(added.result.characterId as string)
 }
 return {id,ids}
}
function assertProjection(plan:any){
 const c=new PerspectiveCamera(plan.fovYDegrees,plan.viewportAspect,0.01,1000);c.position.copy(plan.position);c.lookAt(new Vector3(plan.lookAt.x,plan.lookAt.y,plan.lookAt.z));c.updateMatrixWorld();c.updateProjectionMatrix()
 let max=0
 for(const b of plan.subjectBounds)for(let i=0;i<8;i++){
  const p=new Vector3(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z).project(c)
  assert.ok(Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&p.z>=-1&&p.z<=1,JSON.stringify(p));max=Math.max(max,Math.abs(p.x),Math.abs(p.y))
 }
 return max
}
test('all 3 shot sizes x 3 angles project real anatomy from applied evaluated camera above floor',async()=>{
 const {id,ids}=await setup(),before=await readUnifiedProjectState(id),metrics:any={}
 for(const angle of ['eye','high','low']){
  const distances:number[]=[]
  for(const shot of ['wide','medium','close']){
   const result=await send(id,'camera.framing.preview',{cameraId:'camera_1',characterIds:ids,shot,angle})
   const plan=result.result as any;distances.push(plan.distanceMeters)
   assert.ok(plan.subjectBounds.every((b:any)=>b.source==='evaluated-skeleton'))
   const max=assertProjection(plan);assert.ok(max<1)
   assert.ok(plan.position.y>=plan.floorY+0.3-1e-7)
   if(angle==='low')assert.ok(plan.lookAt.y>plan.position.y,'low camera must look upward')
   assert.deepEqual(await readUnifiedProjectState(id),before)
   await send(id,'camera.framing.apply',{cameraId:'camera_1',characterIds:ids,shot,angle},before.project.revision)
   const evaluated=(await send(id,'scene.evaluate',{frame:0})).result as any
   const actual=evaluated.transforms.camera_1,stored=(await readUnifiedProject(id)).scene.content.nodes.find(n=>n.id==='camera_1')!.camera!
   const camera=new PerspectiveCamera(actual.fov,plan.viewportAspect,stored.near,stored.far)
   camera.position.set(actual.position.x,actual.position.y,actual.position.z)
   if(actual.useEuler)camera.rotation.copy(new Euler(actual.rotation.x*Math.PI/180,actual.rotation.y*Math.PI/180,actual.rotation.z*Math.PI/180))
   else camera.lookAt(new Vector3(actual.lookAt.x,actual.lookAt.y,actual.lookAt.z))
   camera.updateMatrixWorld();camera.updateProjectionMatrix()
   const independentFloor=Math.max(...evaluated.skeletonSamples.map((sample:any)=>Math.min(...sample.bones.filter((b:any)=>/foot|toe/i.test(b.name)).map((b:any)=>new Vector3().setFromMatrixPosition(new Matrix4().fromArray(b.worldMatrix)).y))))
   assert.ok(camera.position.y>=independentFloor+0.3-1e-7)
   let count=0
   for(const sample of evaluated.skeletonSamples){
    const landmark=sample.bones.find((b:any)=>(shot==='medium'?/hips$/i:/spine2$/i).test(b.name))
    const cutoff=shot==='wide'?null:new Vector3().setFromMatrixPosition(new Matrix4().fromArray(landmark.worldMatrix)).y-0.08
    assert.equal(plan.intentionalCrop.find((c:any)=>c.nodeId===sample.nodeId).belowY,cutoff)
    for(const bone of sample.bones){
     const point=new Vector3().setFromMatrixPosition(new Matrix4().fromArray(bone.worldMatrix))
     const projected=point.clone().project(camera)
     assert.ok(Math.abs(projected.x)<=1&&projected.z>=-1&&projected.z<=1,`${shot}/${angle} horizontal ${bone.name}`)
     if(cutoff===null||point.y>=cutoff){assert.ok(Math.abs(projected.y)<=1,`${shot}/${angle} vertical ${bone.name}: ${JSON.stringify({actual,projected,plan:plan.position})}`);count++}
    }
   }
   assert.ok(count>10)
   await send(id,'history.undo',{},before.project.revision+1)
   assert.deepEqual((await readUnifiedProject(id)).scene,before.project.scene)
   Object.assign(before,await readUnifiedProjectState(id))
   metrics[`${angle}/${shot}`]={distance:plan.distanceMeters,maxProjectedAbs:max,cameraY:plan.position.y,floorY:plan.floorY}
  }
  assert.ok(distances[0]!>distances[1]!&&distances[1]!>distances[2]!)
 }
 assert.deepEqual(await readUnifiedProjectState(id),before)
 console.log('G3 projection measurements',JSON.stringify(metrics))
})
test('camera framing apply one revision; Undo/Redo and stale revision; optional primary subject follow',async()=>{
 const {id,ids}=await setup(),before=await readUnifiedProjectState(id)
 const args={cameraId:'camera_1',characterIds:ids,shot:'medium',angle:'high',follow:true}
 const preview=(await send(id,'camera.framing.preview',args)).result as any;assertProjection(preview)
 const applied=await send(id,'camera.framing.apply',args,before.project.revision)
 assert.equal(applied.revision,before.project.revision+1)
 const after=await readUnifiedProject(id),camera=after.scene.content.nodes.find(n=>n.id==='camera_1')!
 assert.deepEqual(camera.transform.position,preview.position);assert.deepEqual(camera.camera!.lookAt,preview.lookAt);assert.equal(camera.camera!.subject!.follow,true)
 const evaluated=(await send(id,'scene.evaluate',{frame:0})).result as any
 const actual=evaluated.transforms.camera_1
 assert.ok(new Vector3(actual.position.x,actual.position.y,actual.position.z).distanceTo(new Vector3(preview.position.x,preview.position.y,preview.position.z))<1e-6)
 await assert.rejects(send(id,'camera.framing.apply',args,before.project.revision),(e:any)=>e.code==='REVISION_CONFLICT')
 await send(id,'history.undo',{},applied.revision);assert.deepEqual((await readUnifiedProject(id)).scene,before.project.scene)
 await send(id,'history.redo',{},applied.revision+1);assert.deepEqual((await readUnifiedProject(id)).scene,after.scene)
 for(const patch of [{characterIds:[]},{characterIds:[ids[0],ids[0]]},{shot:'bad'},{angle:'bad'},{viewportAspect:NaN},{frame:61}])await assert.rejects(send(id,'camera.framing.preview',{...args,...patch}))
})

test('single subject portrait aspect also contains every skeleton-bound corner',async()=>{
 const {id,ids}=await setup()
 const result=await send(id,'camera.framing.preview',{cameraId:'camera_1',characterIds:[ids[0]],shot:'close',angle:'low',viewportAspect:9/16,fovYDegrees:45})
 assertProjection(result.result)
 assert.equal((result.result.subjectBounds as unknown[]).length,1)
})

test('camera framing explicitly rejects existing camera key channels, including constant overlays',async()=>{
 const {previewCameraFraming}=await import('../src/cameraFraming')
 const {id,ids}=await setup(),project=await readUnifiedProject(id)
 const args={cameraId:'camera_1',characterIds:ids,shot:'medium',angle:'eye'}
 for(const prop of ['position','rotation','lookAt','fov']){
  project.extensions.topview={...project.extensions.topview,fcurves:{version:1,encoding:'compact-v1',fcurves:[],userKeys:{camera_1:{[prop]:[{id:'camera-key',frame:0,value:prop==='fov'?[35]:[0,0,0],interpolation:'linear'}]}}}}
  await assert.rejects(previewCameraFraming(project,args),/existing camera key channels/)
 }
 project.extensions.topview.fcurves={version:1,encoding:'compact-v1',fcurves:[{id:'camera-curve',t:['node','camera_1'],p:'camera.lookAt',i:1,k:[[0,1,'linear','key']]}]}
 await assert.rejects(previewCameraFraming(project,args),/existing camera key channels/)
})
