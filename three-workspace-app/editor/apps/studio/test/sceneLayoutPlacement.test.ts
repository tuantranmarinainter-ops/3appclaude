import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeEmptyDraft } from '@topview/3d-builder'
import { executeUnifiedCommand,readUnifiedProject,readUnifiedProjectState } from '../src/unifiedProjectStore'
const dir=mkdtempSync(path.join(tmpdir(),'layout-place-'))
process.env.BBS_UNIFIED_PROJECTS_DIR=dir
test.after(()=>rmSync(dir,{recursive:true,force:true}))
async function setup(){
 const scene=makeEmptyDraft('Blocking',30,60,{fov:50,position:{x:0,y:2,z:5},rotation:{x:0,y:0,z:0},lookAt:{x:0,y:1,z:0}})
 for(const [id,x] of [['A',-3],['B',3]] as const)scene.content.nodes.push({id,name:id,type:'character',visible:true,locked:false,transform:{position:{x,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}} as any)
 return (await executeUnifiedCommand({requestId:randomUUID(),command:'project.create',args:{name:'Blocking',scene}})).projectId
}
const send=(id:string,command:string,args:any={},revision?:number)=>executeUnifiedCommand({requestId:randomUUID(),projectId:id,command,args,...(revision===undefined?{}:{expectedRevision:revision})})
test('relative placement and mutual gaze preview/apply, exact history and stale revision',async()=>{
 const id=await setup(),before=await readUnifiedProjectState(id)
 const args={placements:[{characterId:'A',relativeTo:'B',relation:'left',distanceMeters:1.5,lookAt:{characterId:'B'}},{characterId:'B',lookAt:{characterId:'A'}}]}
 const preview=await send(id,'scene.layout.preview',args)
 assert.deepEqual(await readUnifiedProjectState(id),before)
 assert.equal('operations' in preview.result,false)
 await assert.rejects(send(id,'scene.layout.preview',{...args,frame:null}))
 const placements=preview.result.placements as any[]
 assert.deepEqual(placements[0].transform.position,{x:1.5,y:0,z:0})
 assert.equal(placements[0].transform.rotation.y,90);assert.equal(placements[1].transform.rotation.y,-90)
 const applied=await send(id,'scene.layout.apply',args,before.project.revision)
 assert.equal(applied.revision,before.project.revision+1)
 const after=await readUnifiedProject(id)
 for(const p of placements)assert.deepEqual(after.scene.content.nodes.find(n=>n.id===p.nodeId)!.transform,p.transform)
 await assert.rejects(send(id,'scene.layout.apply',args,before.project.revision),(e:any)=>e.code==='REVISION_CONFLICT')
 await send(id,'history.undo',{},applied.revision)
 assert.deepEqual((await readUnifiedProject(id)).scene,before.project.scene)
 await send(id,'history.redo',{},applied.revision+1)
 assert.deepEqual((await readUnifiedProject(id)).scene,after.scene)
 console.log('G2 placement error: 0 m, yaw error: 0 degrees; 1 revision, 1 undo')
})
test('camera/point gaze, relation order, invalid requests and overlap never write',async()=>{
 const id=await setup(),before=await readUnifiedProjectState(id)
 for(const placements of [[],[{characterId:'A',relativeTo:'A',relation:'left',distanceMeters:1}], [{characterId:'A',relativeTo:'B',relation:'left',distanceMeters:0.1}], [{characterId:'A',position:{x:NaN,z:0}}],[{characterId:'A',relativeTo:'B',relation:'left',distanceMeters:1},{characterId:'B',relativeTo:'A',relation:'left',distanceMeters:1}]]) {
  await assert.rejects(send(id,'scene.layout.preview',{placements}))
  assert.deepEqual(await readUnifiedProjectState(id),before)
 }
 const camera=await send(id,'scene.layout.preview',{placements:[{characterId:'A',position:{x:0,z:0},lookAt:{cameraId:'camera_1'}}]})
 assert.equal((camera.result.placements as any[])[0].transform.rotation.y,0)
 const point=await send(id,'scene.layout.preview',{placements:[{characterId:'A',position:{x:0,z:0},lookAt:{point:{x:1,z:1}}}]})
 assert.equal((point.result.placements as any[])[0].transform.rotation.y,45)
})

test('grounding uses rest foot height and rejects animated/locked targets',async()=>{
 const {previewCharacterLayout}=await import('../src/sceneLayoutPlacement')
 const id=await setup(),project=await readUnifiedProject(id)
 const rest=(position:number[])=>({position,rotation:[0,0,0,1],scale:[1,1,1]})
 project.characters.A={id:'A',assetId:'asset',nodeId:'A',skeletonId:'rig',name:'A'}
 project.skeletons.rig={id:'rig',family:'custom-preserved',rootBoneId:'Hips',metersPerUnit:1,basisToScene:[1,0,0,0,1,0,0,0,1],fingerprint:'rig',nativeFingerprint:'rig',provenance:{} as any,bones:[{id:'Hips',name:'Hips',parentId:null,rest:rest([0,1.1,0]),deform:true},{id:'Foot',name:'LeftFoot',parentId:'Hips',rest:rest([0,-1,0]),deform:true}]}
 const plan=previewCharacterLayout(project,{placements:[{characterId:'A',position:{x:0,z:0}}]})
 assert.ok(Math.abs(plan.placements[0]!.transform.position.y+0.1)<1e-6)
 assert.equal(plan.placements[0]!.body.source,'skeleton-rest')
 project.scene.content.nodes.find(n=>n.id==='A')!.locked=true
 assert.throws(()=>previewCharacterLayout(project,{placements:[{characterId:'A'}]}),/unlocked/)
})

test('placement tracks match node targets exactly and reject Bezier motion between equal endpoints',async()=>{
 const {previewCharacterLayout}=await import('../src/sceneLayoutPlacement')
 const id=await setup(),project=await readUnifiedProject(id)
 const curve=(target:string,keys:unknown[])=>({id:'curve-A',t:['node',target],p:'transform.position',i:0,k:keys})
 const preview=()=>previewCharacterLayout(project,{placements:[{characterId:'A',position:{x:0,z:0}}]})
 project.extensions.topview={...project.extensions.topview,fcurves:{version:1,encoding:'compact-v1',fcurves:[curve('prefix-A',[[0,0,'linear','A'],[60,3,'linear','end']])]}}
 assert.doesNotThrow(preview)
 project.extensions.topview.fcurves={version:1,encoding:'compact-v1',fcurves:[curve('A',[[0,-3,'bezier','a',undefined,{x:10,y:-2}],[60,-3,'bezier','b']])]}
 assert.throws(preview,/Dynamic placement fcurve/)
 project.extensions.topview.fcurves={version:1,encoding:'compact-v1',fcurves:[curve('A',[[0,-3,'bezier','a',undefined,{x:10,y:-3}],[60,-3,'bezier','b']])]}
 const plan=preview()
 const replacement=plan.operations[0] as any
 assert.equal(replacement.type,'document.replace')
 assert.equal(replacement.fcurves.fcurves[0].k[0][1],0)
 assert.equal(replacement.fcurves.fcurves[0].k[0][5].y,0)
})

test('constant transform overlays must stay upright with positive scale when edited',async()=>{
 const {previewCharacterLayout}=await import('../src/sceneLayoutPlacement')
 const id=await setup(),project=await readUnifiedProject(id)
 for(const [prop,value] of [['rotation',[10,0,0]],['scale',[-1,1,1]]] as const) {
  project.extensions.topview={...project.extensions.topview,fcurves:{version:1,encoding:'compact-v1',fcurves:[],userKeys:{A:{[prop]:[{id:'key',frame:0,value:[...value],interpolation:'linear'}]}}}}
  assert.throws(()=>previewCharacterLayout(project,{placements:[{characterId:'A'}]}),/upright/)
  assert.doesNotThrow(()=>previewCharacterLayout(project,{placements:[{characterId:'B',relativeTo:'A',relation:'right',distanceMeters:2}]}))
 }
})
