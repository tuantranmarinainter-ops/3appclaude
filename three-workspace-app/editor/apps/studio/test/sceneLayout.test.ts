import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeEmptyDraft } from '@topview/3d-builder'
import { FCurveSet } from '@topview/3d-builder/evaluate'
import { executeUnifiedCommand, readUnifiedProject, readUnifiedProjectState } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { restLayoutDimensions } from '../src/sceneLayout'

const dir=mkdtempSync(path.join(tmpdir(),'scene-layout-'))
process.env.BBS_UNIFIED_PROJECTS_DIR=dir
test.after(()=>rmSync(dir,{recursive:true,force:true}))
function sourceGlb() {
 const chunks:Buffer[]=[], views:any[]=[],accessors:any[]=[];let length=0
 const add=(values:number[],size:number,type:string,componentType=5126)=>{
  const data=Buffer.alloc(values.length*4);values.forEach((v,i)=>componentType===5126?data.writeFloatLE(v,i*4):data.writeUInt32LE(v,i*4));const bv=views.length;views.push({buffer:0,byteOffset:length,byteLength:data.length});chunks.push(data);length+=data.length
  const index=accessors.length;accessors.push({bufferView:bv,componentType,count:values.length/size,type});return index
 }
 const positions=add([0,0,0,1,0,0,0,1,0],3,'VEC3');accessors[positions].min=[0,0,0];accessors[positions].max=[1,1,0]
 const joints=add(Array(12).fill(0),4,'VEC4',5125)
 // glTF JOINTS_0 requires unsigned byte/short. Replace this view with little-endian unsigned shorts.
 const jointBytes=Buffer.alloc(24);chunks[joints]=jointBytes
 // Keep allocation offsets stable: pad the 24-byte data back to its original 48-byte bufferView.
 chunks[joints]=Buffer.concat([jointBytes,Buffer.alloc(24)]);accessors[joints].componentType=5123
 const weights=add([1,0,0,0,1,0,0,0,1,0,0,0],4,'VEC4')
 const times=add([0,1],1,'SCALAR');accessors[times].min=[0];accessors[times].max=[1]
 const translations=add([0,1,0,0.3,1,0],3,'VEC3')
 const rotations=add([0,0,0,1,0,Math.sin(0.2),0,Math.cos(0.2)],4,'VEC4')
 const inverse=add([1,0,0,0,0,1,0,0,0,0,1,0,0,-1,0,1,1,0,0,0,0,1,0,0,0,0,1,0,0,-2,0,1],16,'MAT4')
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Model',children:[1,3]},{name:'Hips',translation:[0,1,0],children:[2]},{name:'Spine',translation:[0,1,0]},{name:'Skin',mesh:0,skin:0}],skins:[{joints:[1,2],skeleton:1,inverseBindMatrices:inverse}],meshes:[{primitives:[{attributes:{POSITION:positions,JOINTS_0:joints,WEIGHTS_0:weights}}]}],buffers:[{byteLength:length}],bufferViews:views,accessors,animations:[{name:'Move',samplers:[{input:times,output:translations,interpolation:'LINEAR'},{input:times,output:rotations,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:1,path:'translation'}},{sampler:1,target:{node:1,path:'rotation'}}]}]}
 const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);const head=Buffer.alloc(20),bin=Buffer.concat(chunks),bh=Buffer.alloc(8)
 head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(20+padded.length+8+bin.length,8);head.writeUInt32LE(padded.length,12);head.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([head,padded,bh,bin])
}

const command=(projectId:string,command:string,args:any={})=>readUnifiedProject(projectId).then(project=>executeUnifiedCommand({requestId:randomUUID(),projectId,expectedRevision:project.revision,command,args}))

test('layout reads evaluated actors, placed clips and animated cameras without mutating project/history', async()=>{
 const scene=makeEmptyDraft('Layout',30,60,{fov:50,position:{x:3,y:2,z:4},rotation:{x:0,y:0,z:0},lookAt:{x:0,y:1,z:0}})
 const fcurves=FCurveSet.persist(null,{camera_1:{position:[{id:'a',frame:0,value:[3,2,4],interpolation:'linear'},{id:'b',frame:30,value:[5,2,4],interpolation:'linear'}],fov:[{id:'c',frame:0,value:[40],interpolation:'linear'},{id:'d',frame:30,value:[60],interpolation:'linear'}]}})
 const created=await executeUnifiedCommand({requestId:randomUUID(),command:'project.create',args:{name:'Layout',scene,fcurves}}),id=created.projectId
 const upload=await stageAssetUpload('skin.glb',new ReadableStream({start(c){c.enqueue(sourceGlb());c.close()}}))
 const imported=await command(id,'asset.import',{files:[upload.id],format:'glb'})
 const added=await command(id,'character.add',{assetId:(imported.result.assetIds as string[])[0],skeletonId:(imported.result.skeletonIds as string[])[0],name:'Actor',transform:{position:{x:2,y:0,z:1},rotation:{x:0,y:45,z:0},scale:{x:1,y:1,z:1}}})
 await command(id,'motion.place',{characterId:added.result.characterId,motionId:(imported.result.motionIds as string[])[0],frameStart:0})
 const placed=await readUnifiedProject(id)
 const binding=Object.values(placed.bindings)[0]!
 await command(id,'motion.binding.set',{binding:{...binding,rootPolicy:'trajectory'}})
 const before=await readUnifiedProjectState(id)
 const envelope={requestId:randomUUID(),projectId:id,command:'scene.layout.read',args:{frame:15}}
 const result=await executeUnifiedCommand(envelope)
 assert.deepEqual(await executeUnifiedCommand(envelope),result)
 assert.deepEqual(await readUnifiedProjectState(id),before)
 const layout=result.result as any,actor=layout.characters[0],camera=layout.cameras[0]
 assert.equal(layout.sourceRevision,before.project.revision)
 assert.deepEqual(layout.frameRange,{start:0,end:60,fps:30})
 assert.equal(actor.id,added.result.characterId);assert.equal(actor.positionSource,'evaluated')
 assert.ok(Math.abs(actor.hipsHeightMeters-1)<1e-6)
 assert.equal(actor.clips.length,1);assert.equal(actor.clips[0].active,true)
 const evaluated=await command(id,'scene.evaluate',{frame:15})
 const sample=(evaluated.result.skeletonSamples as any[])[0]
 assert.ok(Math.abs(actor.position.x-sample.actorWorldMatrix[12])<1e-6)
 assert.ok(Math.abs(actor.position.z-sample.actorWorldMatrix[14])<1e-6)
 assert.deepEqual(camera.position,{x:4,y:2,z:4});assert.equal(camera.fovYDegrees,50)
 assert.deepEqual(camera.lookAt,(evaluated.result.transforms as any).camera_1.lookAt)
 assert.ok(JSON.stringify(layout).length<2500)
 for(const forbidden of ['bufferViews','accessors','worldMatrix','blobPath','curves','bones']) assert.ok(!JSON.stringify(layout).includes('"'+forbidden+'"'),forbidden)
 assert.equal((await command(id,'scene.layout.read')).result.frame,0)
 for(const args of [{frame:-1},{frame:61},{frame:NaN},{frame:null},{frame:'1'},{extra:true}]) await assert.rejects(command(id,'scene.layout.read',args),/finite frame/)
})

test('rest height accounts for source hierarchy, units, feet and invalid profiles',()=>{
 const bone=(id:string,parentId:string|null,position:number[])=>({id,name:id,parentId,rest:{position,rotation:[0,0,0,1],scale:[1,1,1]},deform:true})
 const profile:any={metersPerUnit:0.01,basisToScene:[1,0,0,0,1,0,0,0,1],bones:[bone('Root',null,[0,20,0]),bone('Hips','Root',[0,100,0]),bone('LeftFoot','Hips',[0,-100,0])]}
 assert.deepEqual(restLayoutDimensions(profile),{hipsHeightMeters:1,hipsHeightReference:'rest-feet'})
 assert.equal(restLayoutDimensions(undefined),null)
 profile.bones[0].parentId='LeftFoot'
 assert.throws(()=>restLayoutDimensions(profile),/cycle/)
})

test('legacy characters expose authored placement and unavailable dimensions without requiring an asset',async()=>{
 const scene=makeEmptyDraft('Legacy',30,60)
 scene.content.nodes.push({id:'legacy',name:'Legacy actor',type:'character',visible:true,locked:false,transform:{position:{x:2,y:0,z:-1},rotation:{x:0,y:90,z:0},scale:{x:1,y:1,z:1}}} as any)
 const created=await executeUnifiedCommand({requestId:randomUUID(),command:'project.create',args:{name:'Legacy',scene}})
 const layout=(await command(created.projectId,'scene.layout.read')).result as any
 assert.equal(layout.characters[0].positionSource,'authored-placement')
 assert.deepEqual(layout.characters[0].position,{x:2,y:0,z:-1})
 assert.ok(Math.abs(layout.characters[0].yawDegrees-90)<1e-6)
 assert.equal(layout.characters[0].hipsHeightMeters,null)
 assert.equal(layout.characters[0].hipsHeightReference,'unavailable')
 assert.deepEqual(layout.cameras,[])
})
