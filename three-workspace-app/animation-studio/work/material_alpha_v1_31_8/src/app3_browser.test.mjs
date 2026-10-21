// Explicit runtime gate: APP3_RUNTIME_BASE=http://127.0.0.1:3013 node --test src/app3_browser.test.mjs
// Run against an isolated Studio server (BBS_UNIFIED_PROJECTS_DIR), after rebuilding/publishing App3.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
const require=createRequire(new URL('../../../../editor/apps/studio/package.json',import.meta.url));
const workspace=new URL('../../../../',import.meta.url);
const base=process.env.APP3_RUNTIME_BASE;
function python(arguments_) {
 const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},name:'bbs_app3_command',arguments:arguments_}};
 return new Promise((resolve,reject)=>{const child=spawn(process.env.PYTHON||'python3',['-m','agent.app3_mcp'],{cwd:workspace,env:{...process.env,BBS_APP_URL:base,PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.on('data',x=>{output+=x});child.stderr.on('data',x=>{errors+=x});child.on('error',reject);child.on('close',status=>{try{assert.equal(status,0,errors);const response=JSON.parse(output);assert.equal(response.result.isError,false,output);resolve(response.result.structuredContent.result)}catch(e){reject(e)}});child.stdin.end(JSON.stringify(request)+'\n')});
}
test('Chromium: real Python MCP → authenticated broker → host bridge → Director reads', {skip:!base,timeout:300000},async()=>{
 assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
 const {chromium}=require('playwright');
 const {makeEmptyDraft}=await import(require.resolve('@topview/3d-builder'));
 const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext({viewport:{width:1500,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const request=context.request,headers={Origin:base};
  assert.equal((await request.post(base+'/api/unified/commands',{headers,data:{}})).status(),401);
  assert.ok((await request.post(base+'/api/unified/session',{headers})).ok());
  assert.equal((await request.post(base+'/api/unified/commands',{headers:{Origin:'https://wrong.example'},data:{}})).status(),403);
  async function command(command,args={},projectId){const revision=projectId?(await request.get(`${base}/api/unified/projects/${projectId}`).then(r=>r.json())).project.revision:undefined;const response=await request.post(base+'/api/unified/commands',{headers,data:{requestId:randomUUID(),command,args,...(projectId?{projectId,expectedRevision:revision}:{})}});const body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));return body;}
  const created=await command('project.create',{name:'E1 browser read',scene:makeEmptyDraft('E1',30,60,{fov:50,position:{x:0,y:2,z:5},rotation:{x:0,y:0,z:0},lookAt:{x:0,y:1,z:0}})}),projectId=created.projectId;
  const e4=process.env.APP3_RUNTIME_E4==='1';
  let assetBytes=e4?readFileSync(process.env.APP3_RUNTIME_ASSET):readFileSync(new URL('../../../../builtin-assets/animation-studio/sample.fbx',import.meta.url));
  if(e4){const oldLength=assetBytes.readUInt32LE(12),json=JSON.parse(assetBytes.subarray(20,20+oldLength).toString());delete json.animations;const text=Buffer.from(JSON.stringify(json)),length=Math.ceil(text.length/4)*4,out=Buffer.alloc(20+length+assetBytes.length-20-oldLength,32);assetBytes.copy(out,0,0,20);out.writeUInt32LE(out.length,8);out.writeUInt32LE(length,12);text.copy(out,20);assetBytes.copy(out,20+length,20+oldLength);assetBytes=out;}
  const uploaded=await request.post(base+'/api/unified/uploads',{headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':e4?'E4.glb':'E1.fbx'},data:assetBytes});assert.ok(uploaded.ok());
  const upload=await uploaded.json();const imported=await command('asset.import',{files:[upload.uploadId],format:e4?'glb':'fbx',unitMeters:e4?1:0.01},projectId);
  const loaded=await request.get(`${base}/api/unified/projects/${projectId}`).then(r=>r.json()),assetId=imported.result.assetIds.find(id=>loaded.project.assets[id].kind==='model'),skeletonId=Object.keys(loaded.project.skeletons)[0];
  const added=await command('character.add',{assetId,skeletonId,name:'E1 actor'},projectId),characterId=added.result.characterId;
  let shotArtifact
  if(process.env.APP3_RUNTIME_E4==='1'){
   const norm=process.env.APP3_RUNTIME_ASSET;assert.ok(norm,'APP3_RUNTIME_ASSET normalized GLB required')
   const bytes=readFileSync(norm),manifest=JSON.parse(readFileSync(norm.replace(/\.glb$/,'.manifest.json'),'utf8'))
   const up=await request.post(base+'/api/unified/uploads',{headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':'normalized.glb'},data:bytes});const handle=await up.json()
   await command('asset.import',{files:[handle.uploadId],format:'glb',manifest},projectId)
   await command('motion.place',{characterId,motionId:manifest.actions[0].uuid,frameStart:0},projectId)
   const p=(await request.get(`${base}/api/unified/projects/${projectId}`).then(r=>r.json())).project,clip=p.scene.content.timeline.animation.motionClips[0]
   shotArtifact=(await command('shot.export',{cameraNodeId:'camera_1',frameStart:0,frameEnd:clip.frameEnd,editableCharacterIds:[characterId]},projectId)).result
  }
  await page.goto(`${base}/?unified=${projectId}`);
  await page.getByRole('navigation',{name:'Workspaces'}).getByRole('button',{name:/3 Animation/}).click();
  const locator=page.locator('.wb-animation-creation-frame');await locator.waitFor();const frame=page.frame({url:/animation-studio\/v1\.32\.0\/index\.html/});assert.ok(frame);
  await frame.waitForFunction(()=>window.__studio?.ready&&window.__app3LocalBridge,null,{timeout:60000});
  await page.locator('.wb-animation-creation-toolbar').first().getByRole('button',{name:'Tạo animation',exact:true}).click();
  await frame.waitForFunction(()=>window.__app3LocalBridge.status().bound,null,{timeout:60000}).catch(async e=>{throw Error(e.message+'; '+await page.locator('.wb-animation-creation-error').allTextContents()+'; '+JSON.stringify(await frame.evaluate(()=>window.__app3LocalBridge.status()))) });
  const sessions=(await python({command:'app3.session.list',projectId,args:{}})).sessions;assert.equal(sessions.length,1);assert.equal(sessions[0].characterId,characterId);
  const identity=Object.fromEntries(['sessionId','epoch','characterId','serverInstance'].map(k=>[k,sessions[0][k]]));
  // Prepare known native keys through the editor's existing public core; the MCP boundary remains read-only.
  const expected=await frame.evaluate(()=>{const s=window.__studio,p=s.serialized(false),r=s.rig(),id=r.records.find(x=>x.name.replace(/^.*:/,'')==='Hips')?.id||r.records[0].id;p.duration=2;delete p.lab;p.keys={};const a={p:[0,0,0],q:[0,0,0,1],s:[1,1,1]},b={...a,p:[1,0,0]};s.core.addKey(p,id,0,a,'linear');s.core.addKey(p,id,1,b,'linear');return {p,id};});
  await frame.evaluate(async({p})=>{await window.__studio.loadProject(p)},expected);
  // loadProject keeps the installed asset/root; a genuine model replacement must require rebinding.
  const before=await frame.evaluate(()=>JSON.stringify(window.__studio.serialized(false)));
  async function read(tool,parameters={}){const requestId=randomUUID(),submit={command:'app3.command.submit',projectId,args:{...identity,tool,parameters},requestId};const first=await python(submit),duplicate=await python(submit);assert.equal(first.commandId,duplicate.commandId);for(let n=0;n<30;n++){const result=await python({command:'app3.command.result',projectId,args:{...identity,commandId:first.commandId}});if(result.status==='done'){assert.equal(result.result.ok,true,JSON.stringify(result));return result.result;}await new Promise(r=>setTimeout(r,150));}throw Error('MCP result timeout');}
  const keys=await read('read_keyframes',{boneIds:[expected.id],start:0,end:1});assert.equal(keys.value.tracks[expected.id].length,2);assert.equal(keys.value.tracks[expected.id][1].p[0],1);
  const analysis=await read('analyze_motion',{boneIds:[expected.id],start:0,end:1,samples:31});assert.ok(analysis.animationRevision);assert.ok(analysis.value.results);assert.ok(Math.abs(analysis.value.results[0].maxPositionSpeed-1)<1e-9);assert.equal(analysis.value.results[0].loopPositionGap,1);assert.ok(Math.abs(analysis.value.results[0].maxSpeedChange)<1e-6);assert.equal(analysis.value.results[0].maxAngularSpeedDegreesPerSecond,0);
  const scene=await read('get_scene_context');assert.ok(scene.value.revision);
  const fresh=await read('get_animation_context');assert.equal(fresh.value.ready,true);
  assert.equal(await frame.evaluate(()=>JSON.stringify(window.__studio.serialized(false))),before,'read operations changed native project');
  async function edit(tool,parameters={},revision,expectedOk=true){
   const native=revision??(await read('get_animation_context')).value.revision;
   const projectRevision=(await request.get(`${base}/api/unified/projects/${projectId}`).then(r=>r.json())).project.revision;
   const submit={command:'app3.command.submit',projectId,expectedRevision:projectRevision,requestId:randomUUID(),args:{...identity,tool,parameters,expectedAnimationRevision:native}};
   const ticket=await python(submit),duplicate=await python(submit);assert.equal(ticket.commandId,duplicate.commandId);
   for(let n=0;n<40;n++){const result=await python({command:'app3.command.result',projectId,args:{...identity,commandId:ticket.commandId}});if(result.status==='done'){assert.equal(result.result.ok,expectedOk,JSON.stringify(result));return result.result;}await new Promise(r=>setTimeout(r,100));}throw Error('Mutation result timeout');
  }
  if(process.env.APP3_RUNTIME_E4==='1'){
   const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
   async function artifact(value){
    assert.ok(value.jobId&&value.fileId);assert.equal(value.data,undefined);assert.equal(value.encoding,undefined)
    const response=await request.get(`${base}/api/unified/projects/${projectId}/jobs/${value.jobId}/files/${value.fileId}`);assert.ok(response.ok());const bytes=await response.body();assert.equal(bytes.length,value.sizeBytes);assert.equal(hash(bytes),value.sha256);return bytes
   }
   const originalZip=await request.get(`${base}/api/unified/projects/${projectId}/jobs/${shotArtifact.jobId}/files/0`).then(r=>r.body()),originalZipHash=hash(originalZip)
   const oldSource=await frame.evaluate(()=>window.__studio.rig().asset.data)
   const stateBefore=await frame.evaluate(()=>JSON.stringify(window.__studio.serialized(false)))
   const bobj=await edit('export_animation',{format:'bobj'}),bobjBytes=await artifact(bobj.value);assert.ok(bobjBytes.length>100)
   const fbx=await edit('export_animation',{format:'fbx'}),fbxBytes=await artifact(fbx.value);assert.equal(fbxBytes.subarray(0,18).toString(),'Kaydara FBX Binary')
   assert.equal(await frame.evaluate(()=>JSON.stringify(window.__studio.serialized(false))),stateBefore)
   const pending=await edit('set_idea',{idea:'pending export guard'})
   assert.equal((await edit('export_animation',{format:'bobj'},pending.value.baseRevision,false)).error,'PATCH_PENDING')
   await edit('cancel_patch',{patchId:pending.value.patchId},pending.value.baseRevision)
   const native=(await read('get_animation_context')).value.revision,projectRevision=(await request.get(`${base}/api/unified/projects/${projectId}`).then(r=>r.json())).project.revision
   const submit={command:'app3.command.submit',projectId,expectedRevision:projectRevision,requestId:randomUUID(),args:{...identity,tool:'shotOpen',parameters:{jobId:shotArtifact.jobId,fileId:'0'},expectedAnimationRevision:native}}
   let lostTransitionAck=false
   await frame.evaluate(oldEpoch=>{window.__e4OldEpoch=oldEpoch;const shot=window.__studio.shot,open=shot.openZip;window.__e4OpenCount=0;shot.openZip=(...args)=>{window.__e4OpenCount++;return open(...args)}},identity.epoch)
   await page.route('**/api/unified/commands',async route=>{const body=route.request().postDataJSON();if(!lostTransitionAck&&body.command==='app3.session.result'&&body.args.result?.ok&&body.args.result.value?.shotId){const response=await route.fetch();assert.ok(response.ok());lostTransitionAck=true;await route.abort('failed')}else await route.continue()})
   const opening=await python(submit);assert.equal((await python(submit)).commandId,opening.commandId)
   let opened
   for(let n=0;n<100;n++){const result=await python({command:'app3.command.result',projectId,args:{...identity,commandId:opening.commandId}});if(result.status==='done'){assert.equal(result.result.ok,true,JSON.stringify(result));opened=result.result.value;break}await new Promise(r=>setTimeout(r,100))}
   assert.ok(opened,'shot open timeout');await frame.waitForFunction(()=>window.__app3LocalBridge.status().bound&&window.__app3LocalBridge.status().epoch!==window.__e4OldEpoch,null,{timeout:10000});await page.unroute('**/api/unified/commands');assert.ok(lostTransitionAck);assert.equal(await frame.evaluate(()=>window.__e4OpenCount),1);assert.notEqual(opened.epoch,identity.epoch);assert.equal(opened.receiverToken,undefined)
   assert.equal((await python({command:'app3.command.result',projectId,args:{...identity,commandId:opening.commandId}})).result.value.epoch,opened.epoch)
   for(const key of Object.keys(identity))identity[key]=opened[key]
   assert.notEqual(await frame.evaluate(()=>window.__studio.rig().asset.data),oldSource)
   const shotContext=(await read('get_animation_context')).value,shot=await frame.evaluate(()=>window.__studio.shot.session.shot)
   assert.equal(shotContext.fps,30);assert.equal(shotContext.duration,(shot.frameRange[1]-shot.frameRange[0])/30)
   // Stall raw upload and try a native mutation while the export proof is held.
   let lockChecked=false
   await page.route('**/api/unified/uploads',async route=>{
    const result=await frame.evaluate(async()=>{try{await window.__studio.loadProject(window.__studio.serialized(false));return 'MUTATED'}catch(e){return e.message}})
    assert.equal(result,'APP3_BUSY');lockChecked=true;await route.continue()
   })
   const shotSource=await frame.evaluate(()=>window.__studio.rig().asset.data)
   const exported=await edit('shotExport',{}),zip=await artifact(exported.value);assert.ok(lockChecked);await page.unroute('**/api/unified/uploads')
   const {unzipSync}=await import(require.resolve('three/addons/libs/fflate.module.js')),files=unzipSync(zip),result=JSON.parse(new TextDecoder().decode(files['result.json'])),editResult=result.edits[0],glb=Buffer.from(files[editResult.glb]),manifest=JSON.parse(new TextDecoder().decode(files[editResult.manifest]))
   assert.equal(result.baseShotSha256,shotArtifact.baseShotSha256);assert.equal(editResult.originalActionUuid,opened.actionUuid);assert.notEqual(editResult.newActionUuid,opened.actionUuid);assert.equal(editResult.glbSha256,hash(glb));assert.equal(manifest.glbSha256,hash(glb))
   const json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString()),names=json.skins[0].joints.map(i=>json.nodes[i].name)
   assert.equal(names.length,65);assert.equal(new Set(names).size,65);assert.ok(names.every(n=>!n.startsWith('mixamorig')));assert.equal(json.animations.length,1);assert.equal(json.extras.bakeFps,30);assert.equal(json.extras.units,'meters')
   for(const sampler of json.animations[0].samplers){const a=json.accessors[sampler.input];assert.equal(a.count,shot.frameRange[1]-shot.frameRange[0]+1);assert.equal(a.min[0],0);assert.ok(Math.abs(a.max[0]-shotContext.duration)<1e-6)}
   assert.equal(await frame.evaluate(()=>window.__studio.rig().asset.data),shotSource);assert.equal(await frame.evaluate(()=>document.body.inert),false);assert.equal(hash(await request.get(`${base}/api/unified/projects/${projectId}/jobs/${shotArtifact.jobId}/files/0`).then(r=>r.body())),originalZipHash)
   const input=json.accessors[json.animations[0].samplers[0].input],view=json.bufferViews[input.bufferView],offset=20+glb.readUInt32LE(12)+8+(view.byteOffset||0)+(input.byteOffset||0);assert.equal(input.componentType,5126);for(let i=0;i<input.count;i++)assert.ok(Math.abs(glb.readFloatLE(offset+i*(view.byteStride||4))-i/30)<1e-6)
   assert.deepEqual(errors,[]);console.log(`E4 actual MCP BOBJ=${bobjBytes.length} FBX=${fbxBytes.length} shotZIP=${zip.length} GLB=${glb.length}; lease transition, hash,65 names,30FPS,bounds,UUID,Python validate-result, lost ACK retry, unchanged source and upload native lock PASS`);return
  }
  const nativeState=()=>frame.evaluate(()=>({json:JSON.stringify(window.__studio.state.project),history:window.__studio.state.historyIndex}));
  const e3=process.env.APP3_RUNTIME_E3==='1';
  if(e3)await frame.evaluate(({id})=>{const s=window.__studio,p=s.serialized(false);p.director={version:1,idea:'',markers:[['a',0],['m',1],['z',2]].map(([id,time])=>({id,time,label:id,kind:'pose',locked:false}))};s.core.addKey(p,id,2,{p:[2,0,0],q:[0,0,0,1],s:[1,1,1]},'linear');return s.loadProject(p);},expected);
  const operations=e3?[
   ['retime_segment',{markerId:'m',time:.5}],['set_hold',{markerId:'m',duration:.5}],['smooth_motion',{boneIds:[expected.id],start:0,end:2,method:'auto',channels:['p']}],['edit_keyframes',{refs:[{id:expected.id,time:.5,kind:'keys'}],action:'copy',targetTime:1.5}],['edit_curves',{boneId:expected.id,path:'p',axis:0,times:[.5],side:'out',slope:3}]
  ]:[['create_blocking',{markers:[{id:'a',time:0,label:'Start'},{id:'z',time:2,label:'End'}]}],['set_pose',{time:0,transforms:{[expected.id]:{p:[3,0,0],q:[0,0,0,1],s:[1,1,1]}}}],['insert_breakdown',{time:1,boneIds:[expected.id],fraction:.25}],['set_marker',{markerId:'a',label:'Ready',locked:true}],['set_idea',{idea:'Preparation note'}]];
  for(const[tool,args]of operations){
   console.log((e3?'E3':'E2')+' browser checking '+tool);
   const original=await nativeState(),stage=await edit(tool,args),patchId=stage.value.patchId,revision=stage.value.baseRevision;
   assert.deepEqual(await nativeState(),original,tool+' staging mutated project/history');
   assert.equal((await edit('set_idea',{idea:'Overwrite'},revision,false)).error,'PATCH_PENDING');
   assert.equal((await edit('cancel_patch',{patchId:'wrong-patch'},revision,false)).error,'PATCH_CONFLICT');
   for(const original of [true,false])await edit('preview_patch',{patchId,original},revision);
   assert.deepEqual(await nativeState(),original);
   const applied=await edit('apply_patch',{patchId},revision);assert.equal(applied.value.undoSteps,1);assert.equal((await nativeState()).history,original.history+1);
   const changed=await nativeState();assert.notEqual(changed.json,original.json);const authored=JSON.parse(changed.json);
   if(tool==='create_blocking'){assert.deepEqual(authored.director.markers.map(m=>m.time),[0,2]);assert.ok(Object.values(authored.keys).flat().every(k=>k.interp==='step'));}
   if(tool==='set_pose')assert.equal(authored.keys[expected.id].find(k=>k.time===0).p[0],3);
   if(tool==='insert_breakdown'){assert.equal(authored.keys[expected.id].find(k=>k.time===1).p[0],2.5);assert.equal(authored.director.markers.find(m=>m.time===1).kind,'breakdown');}
   if(tool==='set_marker'){assert.equal(authored.director.markers[0].label,'Ready');assert.equal(authored.director.markers[0].locked,true);}
   if(tool==='set_idea')assert.equal(authored.director.idea,'Preparation note');
   if(tool==='retime_segment'){assert.deepEqual(authored.director.markers.map(m=>m.time),[0,.5,2]);assert.equal(authored.keys[expected.id].find(k=>k.time===.5).p[0],1);}
   if(tool==='set_hold'){assert.equal(authored.duration,2.5);assert.equal(authored.keys[expected.id].find(k=>k.time===1).p[0],1);assert.equal(authored.keys[expected.id].find(k=>k.time===.5).interp,'step');}
   if(tool==='smooth_motion'){assert.equal(authored.keys[expected.id][0].p[0],0);assert.equal(authored.keys[expected.id].at(-1).p[0],2);}
   if(tool==='edit_keyframes'){assert.equal(authored.keys[expected.id].find(k=>k.time===1.5).p[0],1);assert.ok(authored.keys[expected.id].some(k=>k.time===.5));}
   if(tool==='edit_curves')assert.equal(authored.keys[expected.id].find(k=>k.time===.5).graph.channels.p0.out.slope,3);
   // Native UI Undo/Redo proves this is the editor history, including metadata-only edits.
   await frame.locator('#undoBtn').click();assert.deepEqual(await nativeState(),original,tool+' native Undo failed exact project restore');
   await frame.locator('#redoBtn').click();assert.deepEqual(await nativeState(),changed);
  }
  if(e3){assert.deepEqual(errors,[]);console.log('E3 real MCP: five timing tools, numeric key/curve results, unchanged staged JSON/history, preview, one native Undo/Redo PASS; seconds/model-local units');return;}
  const undoBefore=await nativeState(),undoStage=await edit('set_idea',{idea:'MCP undo verification'});
  await edit('apply_patch',{patchId:undoStage.value.patchId},undoStage.value.baseRevision);
  assert.equal((await nativeState()).history,undoBefore.history+1);
  await edit('undo_animation');assert.deepEqual(await nativeState(),undoBefore,'MCP Undo did not restore exact native project/history');
  const cancelBefore=await nativeState(),cancel=await edit('set_idea',{idea:'cancelled'});await edit('cancel_patch',{patchId:cancel.value.patchId},cancel.value.baseRevision);assert.deepEqual(await nativeState(),cancelBefore);
  const stale=await edit('set_idea',{idea:'stale candidate'}),staleRevision=stale.value.baseRevision;
  // A real native UI edit changes the revision after staging.
  await frame.locator('#duration').evaluate(input=>{input.value='3';input.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal((await edit('apply_patch',{patchId:stale.value.patchId},staleRevision,false)).error,'REVISION_CONFLICT');
  const staleJson=await nativeState();assert.equal((await edit('cancel_patch',{patchId:stale.value.patchId},staleRevision,false)).error,'REVISION_CONFLICT');
  assert.equal((await edit('cancel_patch',{patchId:stale.value.patchId},undefined,false)).error,'PATCH_CONFLICT');assert.deepEqual(await nativeState(),staleJson);
  assert.equal((await read('get_animation_context')).value.preview,null,'native UI commit must invalidate pending candidate');
  await frame.locator('#undoBtn').click();
  const current=(await read('get_animation_context')).value;
  if(current.preview)await edit('cancel_patch',{patchId:current.preview.id},current.revision);
  await page.getByRole('navigation',{name:'Workspaces'}).getByRole('button',{name:/2 Scene/}).click();
  await new Promise(r=>setTimeout(r,1200));
  const inactiveRevision=(await read('get_animation_context')).value.revision;
  const inactiveProject=(await request.get(`${base}/api/unified/projects/${projectId}`).then(r=>r.json())).project.revision;
  const inactive=await request.post(base+'/api/unified/commands',{headers,data:{requestId:randomUUID(),command:'app3.command.submit',projectId,expectedRevision:inactiveProject,args:{...identity,tool:'set_idea',parameters:{idea:'hidden'},expectedAnimationRevision:inactiveRevision}}});assert.equal((await inactive.json()).error.code,'APP3_INACTIVE');
  await page.getByRole('navigation',{name:'Workspaces'}).getByRole('button',{name:/3 Animation/}).click();
  console.log('E2 runtime: all five staged tools immutable; preview/pending/wrong cancel; duplicate apply + exactly one native Undo/Redo; stale UI revision and inactive rejection PASS');
  const second=await command('character.add',{assetId,skeletonId,name:'Shared asset second'},projectId);
  await page.reload();await page.getByRole('navigation',{name:'Workspaces'}).getByRole('button',{name:/3 Animation/}).click();
  await page.locator('.wb-animation-creation-frame').waitFor();
  await page.waitForFunction(()=>document.querySelector('.wb-animation-creation-frame')?.contentWindow?.location.pathname.endsWith('/animation-studio/v1.32.0/index.html'));
  const frame2=page.frame({url:/animation-studio\/v1\.32\.0\/index\.html/});await frame2.waitForFunction(()=>window.__studio?.ready&&window.__app3LocalBridge,null,{timeout:60000});
  await page.locator('.wb-animation-creation-toolbar').first().getByRole('button',{name:'Tạo animation',exact:true}).click();
  await frame2.waitForFunction(()=>window.__app3LocalBridge.status().error==='APP3_BINDING_AMBIGUOUS',null,{timeout:60000});
  assert.equal(await frame2.evaluate(()=>window.__app3LocalBridge.status().bound),false);
  await page.evaluate(({projectId,characterId})=>{document.querySelector('.wb-animation-creation-frame').contentWindow.postMessage({channel:'bbs-animation-studio-v1.32.0',requestId:crypto.randomUUID(),type:'app3-bind',value:{projectId,characterId}},location.origin)},{projectId,characterId:second.result.characterId});
  await frame2.waitForFunction(()=>window.__app3LocalBridge.status().bound);assert.equal(await frame2.evaluate(()=>window.__app3LocalBridge.status().characterId),second.result.characterId);
  assert.deepEqual(errors,[]);
  console.log('E1 runtime: authenticated Python stdio MCP, four fresh reads, 2 known keys, unchanged native JSON, duplicate submit same ticket, shared-asset ambiguity + explicit SHA-verified binding PASS');
 } finally {await browser.close();}
});
