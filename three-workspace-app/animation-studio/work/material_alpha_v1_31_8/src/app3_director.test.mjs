import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {StudioBridge} from './studio_bridge.js';
register('./shot_test_loader.mjs',import.meta.url);
const T=await import('three'),C=await import('./core.js'),Director=await import('./animation_director.js');
function fixture(){
 const root=new T.Group(),bone=new T.Bone();bone.name='Hips';root.add(bone);const rig=C.makeRig(root),project=C.newProject(rig);project.duration=2;project.loop=[0,2];
 for(const id of ['root','b0'])for(const time of [0,2])C.addKey(project,id,time,{p:[time,0,0],q:[0,0,0,1],s:[1,1,1]},'linear');
 let nodes={sourceUnits:{value:'m'},studioMode:{value:'classic'}},commits=0;
 const sandbox={C,Director,rig,project,activeEditorSlot:'A',studioMode:'classic',mode:'create',sourcePreview:null,draft:false,rigDrag:null,numericDrag:null,timelineKeyDrag:null,motionHandDrag:null,editViews:[],directorPending:null,directorPatchCounter:0,directorPanel:null,time:.5,selected:'b0',playing:false,selectionKeys:[],historyIndex:0,history:[structuredClone(project)],$:id=>nodes[id],record:(r,id)=>r.records.find(x=>x.id===id),assertEditingAllowed(){},cancelEasingPreview(){},dirtyViews(){},syncTime(){},syncProject(){},setMode(){},refresh(){},snapshot(){return{time:sandbox.time,draft:sandbox.draft,pose:C.capture(rig),controls:{},modes:[],options:[]}},commit(){commits++;sandbox.history.push(structuredClone(sandbox.project));sandbox.historyIndex++;},restoreHistory(i){if(i<0)return;sandbox.historyIndex=i;sandbox.project=structuredClone(sandbox.history[i]);}};
 vm.createContext(sandbox);vm.runInContext(readFileSync(new URL('./director_controller.js',import.meta.url),'utf8'),sandbox);
 const bridge=new StudioBridge({context:()=>sandbox.directorContext(),call:(...a)=>sandbox.directorCall(...a)},()=>{});
 const call=(tool,args={},extra={})=>bridge.localCall({commandId:randomUUID(),tool,args,expectedAnimationRevision:sandbox.directorRevision(),projectRevision:1,...extra},'fixture',{active:true});
 return {s:sandbox,bridge,call,commits:()=>commits};
}
test('actual Director + core: all five tools stage immutable candidates and one native Undo restores exact project',async()=>{
 const f=fixture(),{s}=f;
 const operations=[['create_blocking',{markers:[{id:'a',time:0,label:'Start'},{id:'z',time:2,label:'End'}]}],['set_pose',{time:0,transforms:{b0:{p:[3,0,0],q:[0,0,0,1],s:[1,1,1]}}}],['insert_breakdown',{time:1,boneIds:['b0'],fraction:.25}],['set_marker',{markerId:'a',label:'Ready',locked:true}],['set_idea',{idea:'A note, not generated motion'}]];
 for(const[tool,args]of operations){
  const before=structuredClone(s.project),h=s.historyIndex,n=f.commits(),stage=await f.call(tool,args);assert.equal(stage.ok,true,stage.error);assert.deepEqual(s.project,before);assert.equal(s.historyIndex,h);
  assert.equal((await f.call('set_idea',{idea:'Overwrite'})).error,'PATCH_PENDING');
  const patchId=stage.value.patchId;
  for(const original of [true,false])assert.equal((await f.call('preview_patch',{patchId,original})).ok,true);
  assert.deepEqual(s.project,before);
  assert.equal((await f.call('cancel_patch',{patchId:'old'})).error,'PATCH_CONFLICT');assert.equal(s.directorPending.id,patchId);
  const command={commandId:randomUUID(),tool:'apply_patch',args:{patchId},expectedAnimationRevision:s.directorRevision(),projectRevision:1};
  const a=f.bridge.localCall(command,'fixture',{active:true}),b=f.bridge.localCall(command,'fixture',{active:true});assert.equal(a,b);assert.equal((await a).ok,true);assert.equal(f.commits(),n+1);assert.equal(s.historyIndex,h+1);
  assert.throws(()=>f.bridge.localCall({...command,projectRevision:2},'fixture',{active:true}),/REQUEST_ID_CONFLICT/);
  const applied=structuredClone(s.project);
  if(tool==='create_blocking'){assert.deepEqual(applied.director.markers.map(m=>m.time),[0,2]);assert.ok(Object.values(applied.keys).flat().every(k=>k.interp==='step'));}
  if(tool==='set_pose')assert.equal(applied.keys.b0.find(k=>k.time===0).p[0],3);
  if(tool==='insert_breakdown'){assert.equal(applied.keys.b0.find(k=>k.time===1).p[0],2.75);assert.equal(applied.director.markers.find(m=>m.time===1).kind,'breakdown');}
  if(tool==='set_marker'){assert.equal(applied.director.markers[0].label,'Ready');assert.equal(applied.director.markers[0].locked,true);}
  if(tool==='set_idea')assert.equal(applied.director.idea,'A note, not generated motion');assert.equal((await f.call('undo_animation')).ok,true);assert.deepEqual(s.project,before);assert.equal(s.historyIndex,h);
  // Continue from each applied result using native history, so subsequent tools have real blocking metadata.
  s.project=applied;s.history=[structuredClone(applied)];s.historyIndex=0;
 }
});
test('actual controller rejects stale revision, slot/units changes and preserves pending on conflict; cancel makes no history',async()=>{
 const f=fixture(),s=f.s,p=await f.call('set_idea',{idea:'candidate'}),revision=s.directorRevision();
 s.project.name+=' UI edit';assert.equal((await f.call('apply_patch',{patchId:p.value.patchId},{expectedAnimationRevision:revision})).error,'REVISION_CONFLICT');assert.equal(f.commits(),0);
 assert.equal((await f.call('cancel_patch',{patchId:p.value.patchId},{expectedAnimationRevision:revision})).error,'REVISION_CONFLICT');
 const edited=structuredClone(s.project);assert.equal((await f.call('cancel_patch',{patchId:p.value.patchId})).ok,true);assert.deepEqual(s.project,edited);assert.equal(f.commits(),0);
 s.project.name=s.history[0].name;const next=await f.call('set_idea',{idea:'next'});assert.equal((await f.call('cancel_patch',{patchId:p.value.patchId})).error,'PATCH_CONFLICT');
 s.activeEditorSlot='B';assert.equal((await f.call('apply_patch',{patchId:next.value.patchId},{expectedAnimationRevision:revision})).error,'REVISION_CONFLICT');s.activeEditorSlot='A';s.$('sourceUnits').value='cm';assert.equal((await f.call('apply_patch',{patchId:next.value.patchId},{expectedAnimationRevision:revision})).error,'REVISION_CONFLICT');s.$('sourceUnits').value='m';
 assert.equal((await f.call('cancel_patch',{patchId:next.value.patchId})).ok,true);assert.equal(f.commits(),0);assert.equal(s.directorPending,null);assert.equal((await f.call('undo_animation')).error,'NOTHING_TO_UNDO');
});
test('deferred receiver guards use current readiness/visibility/revision and shot range/root policy',async()=>{
 const f=fixture(),s=f.s,command={commandId:randomUUID(),tool:'set_idea',args:{idea:'x'},expectedAnimationRevision:s.directorRevision(),projectRevision:1};
 let active=true;const a=f.bridge.localCall(command,'fixture',{isActive:()=>active});active=false;assert.equal((await a).error,'APP3_INACTIVE');
 const b=f.bridge.localCall({...command,commandId:randomUUID()},'fixture',{active:true});s.project.name='changed';assert.equal((await b).error,'REVISION_CONFLICT');
 const c=f.bridge.localCall({...command,commandId:randomUUID(),expectedAnimationRevision:s.directorRevision()},'fixture',{active:true,verify:async()=>{s.project.name='during claim';}});assert.equal((await c).error,'REVISION_CONFLICT');
 const shot=(tool,args)=>f.bridge.localCall({commandId:randomUUID(),tool,args,expectedAnimationRevision:s.directorRevision()},'fixture',{active:true,shot:true});
 assert.equal((await shot('set_pose',{time:0,transforms:{root:{p:[0,0,0],q:[0,0,0,1],s:[1,1,1]}}})).error,'SHOT_ROOT_EDIT_UNSUPPORTED');
 assert.equal((await shot('insert_breakdown',{time:3,boneIds:['b0']})).error,'SHOT_RANGE_CONFLICT');assert.equal(f.commits(),0);
});
