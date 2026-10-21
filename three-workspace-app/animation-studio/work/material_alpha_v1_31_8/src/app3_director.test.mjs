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

test('E3 native timing and key/curve numeric oracles, immutable staging and one Undo',async()=>{
 const cases=[['retime_segment',{markerId:'m',time:.5},p=>{assert.deepEqual(p.director.markers.map(m=>m.time),[0,.5,2]);assert.equal(p.keys.b0[1].p[0],1);}],['set_hold',{markerId:'m',duration:.5},p=>{assert.equal(p.duration,2.5);assert.equal(C.sampleKeys(p.keys.b0,1.25).p[0],1);assert.equal(p.keys.b0.at(-1).time,2.5);assert.equal(p.keys.b0.find(k=>k.time===1).interp,'step');}],['smooth_motion',{boneIds:['b0'],start:0,end:2,method:'auto',channels:['p']},p=>{assert.equal(p.keys.b0[0].p[0],0);assert.equal(p.keys.b0.at(-1).p[0],2);}],['edit_keyframes',{refs:[{id:'b0',time:1,kind:'keys'}],action:'copy',targetTime:1.5},p=>{assert.deepEqual(p.keys.b0.map(k=>k.time),[0,1,1.5,2]);assert.equal(p.keys.b0[2].p[0],1);}],['edit_curves',{boneId:'b0',path:'p',axis:0,times:[1],slope:3,side:'out'},p=>assert.equal(p.keys.b0[1].graph.channels.p0.out.slope,3)]];
 for(const[tool,args,check]of cases){const f=fixture(),s=f.s;C.addKey(s.project,'b0',1,{p:[1,0,0],q:[0,0,0,1],s:[1,1,1]},'linear');s.project.director={version:1,idea:'',markers:[['a',0],['m',1],['z',2]].map(([id,time])=>({id,time,label:id,kind:'pose',locked:false}))};s.history=[structuredClone(s.project)];const before=structuredClone(s.project),stage=await f.call(tool,args);assert.equal(stage.ok,true,tool+': '+stage.error);assert.deepEqual(s.project,before);assert.equal(f.commits(),0);check(s.directorPending.candidate);const patchId=stage.value.patchId;for(const original of [true,false])assert.equal((await f.call('preview_patch',{patchId,original})).ok,true);const command={commandId:randomUUID(),tool:'apply_patch',args:{patchId},expectedAnimationRevision:s.directorRevision(),projectRevision:1};const a=f.bridge.localCall(command,'fixture',{active:true}),b=f.bridge.localCall(command,'fixture',{active:true});assert.equal(a,b);assert.equal((await a).ok,true);check(s.project);assert.equal(f.commits(),1);assert.equal((await f.call('undo_animation')).ok,true);assert.deepEqual(s.project,before);}
});
test('E3 actual core: filter protects Step/contact, Euler Spin survives retime/curves and slopes scale',()=>{
 const f=fixture(),p=f.s.project;C.addKey(p,'b0',1,{p:[4,0,0],q:[0,0,0,1],s:[1,1,1]},'step');p.director={version:1,idea:'',markers:[['a',0],['m',1],['z',2]].map(([id,time])=>({id,time,label:id,kind:id==='m'?'contact':'pose',locked:id==='m'}))};const smooth=Director.patch(f.s.rig,p,'smooth_motion',{boneIds:['b0'],start:0,end:2,method:'filter',strength:1,channels:['p']});assert.equal(smooth.keys.b0[1].p[0],4);assert.equal(smooth.keys.b0[1].interp,'step');p.director.markers[1].locked=false;for(const k of p.keys.b0)k.graph={version:1,euler:[0,k.time*360,0],channels:{r1:{linked:false,in:{type:'spline',slope:360},out:{type:'spline',slope:360}}}};const retimed=Director.patch(f.s.rig,p,'retime_segment',{markerId:'m',time:.5});assert.equal(retimed.keys.b0[0].graph.channels.r1.out.slope,720);assert.equal(retimed.keys.b0.at(-1).graph.euler[1],720);assert.equal(retimed.keys.b0[1].interp,'step');const curves=Director.patch(f.s.rig,p,'edit_curves',{boneId:'b0',path:'r',axis:1,times:[0,2],type:'linear'});assert.deepEqual(curves.keys.b0.map(k=>k.graph.euler[1]),[0,360,720]);
});
test('E3 shot rejection occurs before native dispatch',async()=>{
 let calls=0;const bridge=new StudioBridge({context:()=>({ready:true,revision:'r',duration:2,markers:[{id:'a',time:0},{id:'z',time:2}]}),call:()=>{calls++;}},()=>{});const cases=[['set_hold',{markerId:'a',duration:.5},'SHOT_DURATION_CHANGE_UNSUPPORTED'],['retime_segment',{markerId:'z',time:1},'SHOT_DURATION_CHANGE_UNSUPPORTED'],['edit_keyframes',{refs:[{id:'b0',time:1,kind:'keys'},{id:'b0',time:2,kind:'keys'}],action:'copy',targetTime:2},'SHOT_RANGE_CONFLICT'],['edit_curves',{boneId:'root',path:'p',axis:0,times:[0],type:'linear'},'SHOT_ROOT_EDIT_UNSUPPORTED'],['smooth_motion',{boneIds:['root'],start:0,end:2},'SHOT_ROOT_EDIT_UNSUPPORTED'],['edit_keyframes',{refs:[{id:'root',time:0,kind:'keys'}],action:'delete'},'SHOT_ROOT_EDIT_UNSUPPORTED']];for(const[tool,args,error]of cases)assert.equal((await bridge.localCall({commandId:randomUUID(),tool,args,expectedAnimationRevision:'r'},'shot',{active:true,shot:true})).error,error);assert.equal(calls,0);
});
test('E3 shot rejects incomplete marker range; protected spline fails closed but ordinary internal retime remains available',async()=>{
 let calls=0;const context={ready:true,revision:'r',duration:2,markers:[{id:'a',time:0},{id:'m',time:.5},{id:'z',time:1}]};const bridge=new StudioBridge({context:()=>context,call:()=>{calls++;return{};}},()=>{});const call=(tool,args,shot=true)=>bridge.localCall({commandId:randomUUID(),tool,args,expectedAnimationRevision:'r'},'policy',{active:true,shot});
 assert.equal((await call('retime_segment',{markerId:'m',time:.25})).error,'SHOT_DURATION_CHANGE_UNSUPPORTED');assert.equal(calls,0);context.markers[2].time=2;assert.equal((await call('retime_segment',{markerId:'m',time:.25})).ok,true);assert.equal(calls,1);context.markers[1].kind='contact';assert.equal((await call('smooth_motion',{boneIds:['b0'],start:0,end:2,method:'cubic'},false)).error,'PROTECTED_POSE_SMOOTH_UNSUPPORTED');assert.equal(calls,1);
});
test('E3 actual core move/delete key results and hold Step survive auto smoothing',()=>{
 const f=fixture(),p=f.s.project;C.addKey(p,'b0',1,{p:[4,0,0],q:[0,0,0,1],s:[1,1,1]},'linear');p.director={version:1,idea:'',markers:[['a',0],['m',1],['z',2]].map(([id,time])=>({id,time,label:id,kind:'pose',locked:false}))};
 const moved=Director.patch(f.s.rig,p,'edit_keyframes',{refs:[{id:'b0',time:1,kind:'keys'}],action:'move',targetTime:.5});assert.deepEqual(moved.keys.b0.map(k=>k.time),[0,.5,2]);assert.equal(moved.keys.b0[1].p[0],4);
 const deleted=Director.patch(f.s.rig,p,'edit_keyframes',{refs:[{id:'b0',time:1,kind:'keys'}],action:'delete'});assert.deepEqual(deleted.keys.b0.map(k=>k.time),[0,2]);
 const held=Director.patch(f.s.rig,p,'set_hold',{markerId:'m',duration:.5}),smoothed=Director.patch(f.s.rig,held,'smooth_motion',{boneIds:['b0'],start:0,end:2.5,method:'auto',channels:['p']});assert.equal(smoothed.keys.b0.find(k=>k.time===1).interp,'step');assert.equal(C.sampleKeys(smoothed.keys.b0,1.25).p[0],4);
});
test('E3 filter matches an independent Gaussian spike oracle; Euler sample keeps accumulated turns',()=>{
 const f=fixture(),p=f.s.project;p.fps=30;C.addKey(p,'b0',1,{p:[4,0,0],q:[0,0,0,1],s:[1,1,1]},'linear');const result=Director.patch(f.s.rig,p,'smooth_motion',{boneIds:['b0'],start:0,end:2,method:'filter',strength:1,window:1,channels:['p']});const w=Math.exp(-.5),expected=(4+(8-6/30)*w)/(1+2*w);assert.ok(Math.abs(result.keys.b0[1].p[0]-expected)<1e-12);assert.ok(result.keys.b0[1].p[0]<4);assert.equal(result.keys.b0[0].p[0],0);assert.equal(result.keys.b0.at(-1).p[0],2);
 for(const k of p.keys.b0)k.graph={version:1,euler:[0,k.time*360,0],channels:{r1:{linked:false,in:{type:'linear',slope:0},out:{type:'linear',slope:0}}}};const edited=Director.patch(f.s.rig,p,'edit_curves',{boneId:'b0',path:'r',axis:1,times:[0,1,2],type:'linear'});assert.ok(Math.abs(C.sampleKeys(edited.keys.b0,1.5).graph.euler[1]-540)<1e-10);
 const auto=Director.patch(f.s.rig,p,'smooth_motion',{boneIds:['b0'],start:0,end:2,method:'auto',channels:['p']});assert.equal(auto.keys.b0[1].interp,'auto');
});
