import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AnimationMixer, LoopOnce, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { makeEmptyDraft } from '@topview/3d-builder'
import { FCurveSet } from '@topview/3d-builder/evaluate'
import { executeUnifiedCommand, readUnifiedProject } from '../src/unifiedProjectStore'
import { stageAssetUpload } from '../src/unifiedAssetFiles'
import { readUnifiedJobFile } from '../src/unifiedJobs'
import { exportSceneGlb } from '../src/sceneGlb'

const dir=mkdtempSync(path.join(tmpdir(),'scene-glb-'))
process.env.BBS_UNIFIED_PROJECTS_DIR=dir
test.after(()=>rmSync(dir,{recursive:true,force:true}))

/** Embedded triangle skin with moving Hips and a child joint, independent of external samples or decoders. */
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
const command=(projectId:string,command:string,args:any={},extra:any={})=>readUnifiedProject(projectId).then(project=>executeUnifiedCommand({requestId:randomUUID(),projectId,expectedRevision:project.revision,command,args,...extra}))

test('broker scene GLB includes skin, placed motion, prop/primitive and animated camera; three reimport matches scene.evaluate at three frames',async()=>{
 const scene=makeEmptyDraft('Scene export',30,60,{fov:50,position:{x:3,y:2,z:4},rotation:{x:0,y:0,z:0},lookAt:{x:0,y:1,z:0}})
 scene.content.nodes.push({id:'box',name:'Box',type:'primitive',visible:true,locked:false,transform:{position:{x:1,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}},primitive:{kind:'BoxGeometry',parameters:{width:1,height:1,depth:1}}})
 const fcurves=FCurveSet.persist(null,{camera_1:{position:[{id:'cam0',frame:0,value:[3,2,4],interpolation:'linear'},{id:'cam1',frame:30,value:[5,2,4],interpolation:'linear'}]},box:{position:[{id:'box0',frame:0,value:[1,0,0],interpolation:'linear'},{id:'box1',frame:30,value:[2,0,0],interpolation:'linear'}]}})
 const created=await executeUnifiedCommand({requestId:randomUUID(),command:'project.create',args:{name:'Scene export',scene,fcurves}}),id=created.projectId
 const source=sourceGlb(),upload=await stageAssetUpload('skin.glb',new ReadableStream({start(c){c.enqueue(source);c.close()}}))
 const imported=await command(id,'asset.import',{files:[upload.id],format:'glb'})
 const assetId=(imported.result.assetIds as string[])[0],skeletonId=(imported.result.skeletonIds as string[])[0],motionId=(imported.result.motionIds as string[])[0]
 const character=await command(id,'character.add',{assetId,skeletonId,name:'Actor',transform:{position:{x:2,y:0,z:1},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}})
 const characterId=character.result.characterId as string
 await command(id,'motion.place',{characterId,motionId,frameStart:0})
 const prop=await command(id,'prop.add',{assetId,name:'Reference',transform:{position:{x:-2,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}})
 const before=await readUnifiedProject(id)
 const envelope={requestId:randomUUID(),projectId:id,expectedRevision:before.revision,command:'scene.export.glb',args:{frameStart:0,frameEnd:29}}
 const result=await executeUnifiedCommand(envelope),replay=await executeUnifiedCommand(envelope)
 assert.deepEqual(replay,result);assert.equal((await readUnifiedProject(id)).revision,before.revision)
 const output=await readUnifiedJobFile(result.result.jobId as string,id,'0');assert.ok(output);assert.equal(output.mimeType,'model/gltf-binary')
 const loaded=await new GLTFLoader().parseAsync(Uint8Array.from(output.bytes).buffer,'')
 assert.equal(loaded.animations.length,1);let skins=0,cameras=0;loaded.scene.traverse((n:any)=>{if(n.isSkinnedMesh)skins++;if(n.isCamera)cameras++});assert.equal(skins,2);assert.equal(cameras,1)
 const actorNode=before.characters[characterId]!.nodeId, actor=loaded.scene.getObjectByName(actorNode)!,camera=loaded.scene.getObjectByName('camera_1')!
 assert.ok(actor);assert.ok(loaded.scene.getObjectByName('box'));assert.ok(prop.result.nodeId)
 const mixer=new AnimationMixer(loaded.scene);const action=mixer.clipAction(loaded.animations[0]!);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play()
 for(const frame of [0,10,20]) {
  mixer.setTime(frame/30);loaded.scene.updateMatrixWorld(true)
  const sampled=await command(id,'scene.evaluate',{frame}),samples=sampled.result.skeletonSamples as any[],expected=samples.find(s=>s.nodeId===actorNode)
  const position=new Vector3().setFromMatrixPosition(actor.matrixWorld), target=new Vector3().fromArray(expected.actorWorldMatrix.slice(12,15));assert.ok(position.distanceTo(target)<=0.001)
  for(const bone of expected.bones){const actual=actor.children.find(n=>n.userData.sourceBoneName===bone.name);assert.ok(actual, bone.name);assert.ok(new Vector3().setFromMatrixPosition(actual.matrixWorld).distanceTo(new Vector3().fromArray(bone.worldMatrix.slice(12,15)))<=0.001,bone.name)}
  const transform=(sampled.result.transforms as any).camera_1;assert.ok(camera.getWorldPosition(new Vector3()).distanceTo(new Vector3(transform.position.x,transform.position.y,transform.position.z))<=0.001)
 }
 await assert.rejects(command(id,'scene.export.glb',{frameStart:-1,frameEnd:20}),/frameStart/)
 await assert.rejects(command(id,'scene.export.glb',{frameStart:0,frameEnd:20},{expectedRevision:0}),/revision/i)
})

test('GLB export rejects unsupported sources and malformed ranges instead of dropping content',async()=>{
 const created=await executeUnifiedCommand({requestId:randomUUID(),command:'project.create',args:{name:'Bad range',scene:makeEmptyDraft('Bad range',30,60)}})
 const project=await readUnifiedProject(created.projectId)
 for(const args of [{frameStart:2,frameEnd:1},{frameStart:0,frameEnd:61},{frameStart:0,frameEnd:1,extra:true}]) await assert.rejects(exportSceneGlb(project,args as any),/frameStart/)
})

test('animated camera FOV is preserved in a KHR_animation_pointer channel',async()=>{
 const scene=makeEmptyDraft('Zoom',30,60,{fov:50,position:{x:3,y:2,z:4},rotation:{x:0,y:0,z:0},lookAt:{x:0,y:1,z:0}})
 const fcurves=FCurveSet.persist(null,{camera_1:{fov:[{id:'fov0',frame:0,value:[45],interpolation:'linear'},{id:'fov1',frame:30,value:[75],interpolation:'linear'}]}})
 const created=await executeUnifiedCommand({requestId:randomUUID(),command:'project.create',args:{name:'Zoom',scene,fcurves}})
 const output=await exportSceneGlb(await readUnifiedProject(created.projectId),{frameStart:0,frameEnd:29})
 assert.equal(output.report.animatedFovCount,1)
 const document=JSON.parse(output.bytes.subarray(20,20+output.bytes.readUInt32LE(12)).toString())
 assert.ok(document.extensionsUsed.includes('KHR_animation_pointer'))
 const channel=document.animations[0].channels.find((c:any)=>c.target.extensions?.KHR_animation_pointer)
 assert.match(channel.target.extensions.KHR_animation_pointer.pointer,/\/cameras\/\d+\/perspective\/yfov/)
 const loaded=await new GLTFLoader().parseAsync(Uint8Array.from(output.bytes).buffer,'')
 assert.equal(loaded.animations.length,1)
})
