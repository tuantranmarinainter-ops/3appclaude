import './app3_director.test.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID, createHash, webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { StudioBridge, validateLocalRead } from './studio_bridge.js';
const workspace = new URL('../../../../', import.meta.url);
const require = createRequire(new URL('../../../../editor/apps/studio/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../../../../editor/apps/studio/src/app3Bridge.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { executeApp3Bridge: execute, app3BindingCandidates, validateApp3Read, validateApp3Edit } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const sha = 'a'.repeat(64);
function project() { const id = randomUUID(), characterId = randomUUID(), assetId = randomUUID(); return { projectId: id, characters: { [characterId]: { id: characterId, assetId } }, assets: { [assetId]: { source: { sha256: sha } } }, motions: {}, bindings: {} }; }
function register(p, extra={}) { const args = { sessionId: randomUUID(), epoch: randomUUID(), characterId: Object.keys(p.characters)[0], sourceSha256: sha, ready: true, active: true, context: { ready: true }, ...extra }; return execute(p, 'app3.session.register', args, randomUUID()); }
const identity = lease => Object.fromEntries(['sessionId','epoch','characterId','serverInstance'].map(k=>[k,lease[k]]));
const receiver = lease => ({...identity(lease), receiverToken:lease.receiverToken});
const call = (p, name, args, id=randomUUID())=>execute(p, name, args, id);
test('broker exact identity, readiness, source rebind and process generation',()=>{
 const p=project(), l=register(p), id=identity(l);
 assert.equal(call(p,'app3.session.list',{}).sessions.length,1);
 for(const key of Object.keys(id))assert.throws(()=>call(p,'app3.context.get',{...id,[key]:randomUUID()}));
 assert.throws(()=>call({...p,projectId:randomUUID()},'app3.context.get',id));
 assert.throws(()=>call(p,'app3.session.poll',{...receiver(l),receiverToken:randomUUID(),ready:true,active:true,context:{}}),/RECEIVER_REJECTED/);
 assert.equal(call(p,'app3.context.get',id).freshness,'cached-heartbeat');
 p.assets[Object.keys(p.assets)[0]].source.sha256='b'.repeat(64);
 assert.throws(()=>call(p,'app3.context.get',id),/SESSION_REPLACED/);
});
test('two characters sharing asset remain ambiguous, explicit registration validates exact pair',()=>{
 const p=project(), c=Object.values(p.characters)[0], second=randomUUID();p.characters[second]={...c,id:second};
 assert.equal(app3BindingCandidates(p,sha).length,2);
 const l=register(p,{characterId:second});assert.equal(l.characterId,second);
 assert.throws(()=>register(p,{characterId:randomUUID()}),/IDENTITY_MISMATCH/);
});
test('broker serialized ticket retry, result dedupe and stale reply rejection',()=>{
 const p=project(),l=register(p),id=identity(l),r=receiver(l),requestId=randomUUID(),a={...id,tool:'read_keyframes',parameters:{}};
 const first=call(p,'app3.command.submit',a,requestId);
 assert.equal(call(p,'app3.command.submit',a,requestId).commandId,first.commandId);
 assert.throws(()=>call(p,'app3.command.submit',{...a,parameters:{start:1}},requestId),/REQUEST_ID_CONFLICT/);
 const second=call(p,'app3.command.submit',{...a,tool:'get_scene_context'});
 assert.equal(call(p,'app3.session.poll',{...r,ready:false,active:false,context:{ready:false}}).commands.length,0);
 const poll=()=>call(p,'app3.session.poll',{...r,ready:true,active:false,context:{ready:true}});
 assert.equal(poll().commands[0].commandId,first.commandId);assert.equal(poll().commands[0].commandId,first.commandId);
 assert.throws(()=>call(p,'app3.session.result',{...r,commandId:second.commandId,result:{ok:true},context:{}}),/COMMAND_OUTCOME_UNKNOWN/);
 const result={...r,commandId:first.commandId,result:{ok:true,value:{tracks:{}}},context:{}};
 call(p,'app3.session.result',result);call(p,'app3.session.result',result);
 assert.throws(()=>call(p,'app3.session.result',{...result,result:{ok:false}}),/RESULT_CONFLICT/);
 assert.equal(call(p,'app3.command.result',{...id,commandId:first.commandId}).status,'done');
 assert.equal(poll().commands[0].commandId,second.commandId);
 assert.throws(()=>call(p,'app3.session.result',{...result,epoch:randomUUID()}),/SESSION_REPLACED/);
});
test('schema rejects mutation, invalid numeric ranges and excess data at both boundaries',()=>{
 for(const validate of [validateLocalRead,validateApp3Read]){
  for(const [tool,args]of [['set_pose',{}],['read_keyframes',{start:NaN}],['read_keyframes',{start:2,end:1}],['read_keyframes',{boneIds:[]}],['analyze_motion',{samples:601}],['get_scene_context',{force:true}]])assert.throws(()=>validate(tool,args));
  validate('analyze_motion',{samples:4,start:0,end:1});
 }
 const p=project(),l=register(p,{ready:false});assert.throws(()=>call(p,'app3.command.submit',{...identity(l),tool:'read_keyframes',parameters:{}}),/APP3_NOT_READY/);
});
test('receiver cache shares in-flight promise, preserves errors and never touches Sites',async()=>{
 let calls=0,finish;const bridge=new StudioBridge({context:()=>({ready:true,revision:'r1'}),call:async()=>{calls++;await new Promise(r=>{finish=r});return{tracks:{Hips:[{time:0}]}};}},()=>{});
 const command={commandId:randomUUID(),tool:'read_keyframes',args:{}};
 const a=bridge.localRead(command,'identity'),b=bridge.localRead(command,'identity');assert.equal(a,b);
 await Promise.resolve();assert.equal(calls,1);finish();assert.equal((await a).animationRevision,'r1');
 assert.throws(()=>bridge.localRead({...command,args:{start:1}},'identity'),/REQUEST_ID_CONFLICT/);
 assert.throws(()=>bridge.localRead({...command,tool:'apply_patch'},'identity'),/UNSUPPORTED_CAPABILITY/);
});
async function hostFixture(ambiguous=false) {
 const bytes=new TextEncoder().encode('fixture'),hash=createHash('sha256').update(bytes).digest('hex'),p=project();p.assets[Object.keys(p.assets)[0]].source.sha256=hash;
 if(ambiguous){const c=Object.values(p.characters)[0],id=randomUUID();p.characters[id]={...c,id};}
 const handlers={},parentHandlers={},timers=[],messages=[];let activeCalls=0;
 const context={ready:true,rig:'rig',rootUuid:randomUUID(),slot:'A',activeRoot:'all',revision:'r1'};
 const bridge=new StudioBridge({context:()=>({...context}),call:async tool=>({tool,tracks:{Hips:[{time:0}]} })},()=>{});
 const studio={rig:()=>({asset:{data:Buffer.from(bytes).toString('base64')}}),ready:true,state:{},serialized:()=>({duration:1}),installAsset:async()=>{},recordNames:()=>['Hips'],setHostActive:()=>{activeCalls++},director:{context:()=>({...context}),bridge:()=>bridge},shot:{}};
 const parent={location:{origin:'http://127.0.0.1:3013'},__bbsApp3Projects:{[p.projectId]:p},postMessage:v=>messages.push(v),addEventListener:(k,fn)=>{parentHandlers[k]=fn},removeEventListener:k=>delete parentHandlers[k]};
 const sandbox={atob:x=>Buffer.from(x,'base64').toString('binary'),parent,location:parent.location,crypto:webcrypto,window:{__studio:studio},document:{getElementById:()=>null},addEventListener:(k,fn)=>{handlers[k]=fn},setTimeout,clearTimeout,setInterval:fn=>{timers.push(fn);return timers.length},clearInterval:()=>{},fetch:async(url,init)=>{
  assert.equal(url,'/api/unified/commands');const e=JSON.parse(init.body);
  try{return{ok:true,json:async()=>({ok:true,result:execute(p,e.command,e.args,e.requestId)})}}catch(error){return{ok:false,json:async()=>({error:{code:error.code}})}}
 }};vm.runInNewContext(readFileSync(new URL('./host_bridge.js',import.meta.url),'utf8'),sandbox);
 const send=(type,value,overrides={})=>handlers.message({origin:parent.location.origin,source:parent,data:{channel:'bbs-animation-studio-v1.32.0',requestId:randomUUID(),type,value},...overrides});
 await send('open',{bytes:bytes.buffer,name:'fixture.glb'});
 return{p,parent,studio,context,send,timers,messages,handlers,parentHandlers,sandbox,activeCalls:()=>activeCalls};
}
test('host self-registers, polls authenticated local queue and retains active/ping while rejecting spoofed events',async()=>{
 const f=await hostFixture(),sessions=call(f.p,'app3.session.list',{}).sessions;assert.equal(sessions.length,1);
 const l=sessions[0],t=call(f.p,'app3.command.submit',{...identity(l),tool:'read_keyframes',parameters:{}});
 await f.timers[0]();
 assert.equal(call(f.p,'app3.command.result',{...identity(l),commandId:t.commandId}).status,'done');
 const count=f.messages.length;await f.send('ping',{}, {origin:'https://bad.example'});await f.send('ping',{}, {source:{}});assert.equal(f.messages.length,count);
 await f.send('active',{active:false});assert.equal(f.activeCalls(),1);
 await f.send('ping',{});assert.equal(f.messages.at(-1).value.ready,true);
 f.context.rootUuid=randomUUID();await f.timers[0]();assert.equal(call(f.p,'app3.session.list',{}).sessions.length,0);
 f.handlers.pagehide();assert.equal(f.parentHandlers['bbs-app3-project'],undefined);
});
test('host auto-binding fails closed for shared asset; parent-only explicit binding resolves verified SHA',async()=>{
 const f=await hostFixture(true);assert.equal(call(f.p,'app3.session.list',{}).sessions.length,0);assert.equal(f.sandbox.window.__app3LocalBridge.status().error,'APP3_BINDING_AMBIGUOUS');
 const characterId=Object.keys(f.p.characters)[1];await f.send('app3-bind',{projectId:f.p.projectId,characterId},{source:{}});assert.equal(call(f.p,'app3.session.list',{}).sessions.length,0);
 await f.send('app3-bind',{projectId:f.p.projectId,characterId});assert.equal(call(f.p,'app3.session.list',{}).sessions[0].characterId,characterId);
 assert.equal(f.sandbox.window.__app3LocalBridge.status().receiverToken,undefined);
 await f.send('app3-bind',{projectId:f.p.projectId,characterId:randomUUID()});assert.equal(f.messages.at(-1).ok,false);
});
test('host refuses requested SHA when actual installed asset differs',async()=>{
 const f=await hostFixture();f.studio.rig=()=>({asset:{data:Buffer.from('different asset').toString('base64')}});
 await f.send('open',{bytes:new TextEncoder().encode('fixture').buffer,name:'fixture.glb'});
 assert.equal(call(f.p,'app3.session.list',{}).sessions.length,0);
 assert.equal(f.sandbox.window.__app3LocalBridge.status().error,'IDENTITY_MISMATCH');
});
test('queue timeout distinguishes unsent and dispatched results, and heartbeat expires',()=>{
 const p=project(),l=register(p),id=identity(l),oldNow=Date.now;let now=Date.now();Date.now=()=>now;
 try {
  const first=call(p,'app3.command.submit',{...id,tool:'get_scene_context',parameters:{}});
  now+=61000;assert.equal(call(p,'app3.command.result',{...id,commandId:first.commandId}).error,'APP3_OFFLINE');
  const second=call(p,'app3.command.submit',{...id,tool:'get_scene_context',parameters:{}});
  call(p,'app3.session.poll',{...receiver(l),ready:true,active:true,context:{}});
  now+=61000;assert.equal(call(p,'app3.command.result',{...id,commandId:second.commandId}).error,'COMMAND_OUTCOME_UNKNOWN');
  now+=61000;assert.throws(()=>call(p,'app3.context.get',id),/APP3_OFFLINE/);
 }finally{Date.now=oldNow;}
});
test('Python App3 MCP suite is part of the existing App3 test:all entry',()=>{
 const child=spawnSync(process.env.PYTHON||(process.platform==='win32'?'python':'python3'),['-m','unittest','-v','agent.app3_mcp_test'],{cwd:workspace,encoding:'utf8'});
 assert.equal(child.status,0,child.stdout+child.stderr);assert.match(child.stderr,/Ran [1-9]\d* tests/);
});

test('mutation broker separates revision types, fails closed after lost dispatch and never advertises unsupported tools',()=>{
 for(const value of [null,[],{idea:'x',unknown:true}])assert.throws(()=>validateApp3Edit('set_idea',value),error=>error.code==='VALIDATION_FAILED'&&error.status===400);
 const p=project();p.revision=7;const l=register(p),id=identity(l),r=receiver(l),a={...id,tool:'set_idea',parameters:{idea:'candidate'},expectedAnimationRevision:'native:7'};
 const edit=(args=a,rev=7)=>execute(p,'app3.command.submit',args,randomUUID(),false,rev);
 assert.throws(()=>execute(p,'app3.command.submit',a,randomUUID()),/VALIDATION_FAILED/);
 assert.throws(()=>edit(a,'7'),/VALIDATION_FAILED/);
 assert.throws(()=>edit({...a,expectedAnimationRevision:7}),/VALIDATION_FAILED/);
 const t=edit();const poll=()=>call(p,'app3.session.poll',{...r,ready:true,active:true,context:{ready:true}});
 assert.equal(poll().commands[0].projectRevision,7);p.revision=8;
 assert.equal(poll().commands[0].commandId,t.commandId,'lost poll retries same ticket');
 assert.throws(()=>call(p,'app3.session.claim',{...r,commandId:t.commandId}),/REVISION_CONFLICT/);
 const capabilities=call(p,'app3.session.list',{}).sessions[0].capabilities;
 for(const tool of ['create_blocking','set_pose','insert_breakdown','set_marker','set_idea','apply_patch'])assert.ok(capabilities.includes(tool));
 for(const tool of ['export_animation','preview_scene_patch','set_hold','edit_curves'])assert.ok(!capabilities.includes(tool));
 const queued=execute(p,'app3.command.submit',a,randomUUID(),false,8);p.revision=9;
 call(p,'app3.session.result',{...r,commandId:t.commandId,result:{ok:false,error:'REVISION_CONFLICT'},context:{}});
 poll();assert.equal(call(p,'app3.command.result',{...id,commandId:queued.commandId}).result.error,'REVISION_CONFLICT');
});
