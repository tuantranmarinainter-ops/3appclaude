// Explicit runtime gate: APP3_RUNTIME_BASE=http://127.0.0.1:3013 node --test src/app3_browser.test.mjs
// Run against an isolated Studio server (BBS_UNIFIED_PROJECTS_DIR), after rebuilding/publishing App3.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../../../editor/apps/studio/package.json',import.meta.url));
const workspace=new URL('../../../../',import.meta.url);
const base=process.env.APP3_RUNTIME_BASE;
function python(arguments_) {
 const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},name:'bbs_app3_command',arguments:arguments_}};
 return new Promise((resolve,reject)=>{const child=spawn(process.env.PYTHON||'python3',['-m','agent.app3_mcp'],{cwd:workspace,env:{...process.env,BBS_APP_URL:base},stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.on('data',x=>{output+=x});child.stderr.on('data',x=>{errors+=x});child.on('error',reject);child.on('close',status=>{try{assert.equal(status,0,errors);const response=JSON.parse(output);assert.equal(response.result.isError,false,output);resolve(response.result.structuredContent.result)}catch(e){reject(e)}});child.stdin.end(JSON.stringify(request)+'\n')});
}
test('Chromium: real Python MCP → authenticated broker → host bridge → Director reads', {skip:!base,timeout:180000},async()=>{
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
  const assetBytes=readFileSync(new URL('../../../../builtin-assets/animation-studio/sample.fbx',import.meta.url));
  const uploaded=await request.post(base+'/api/unified/uploads',{headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':'E1.fbx'},data:assetBytes});assert.ok(uploaded.ok());
  const upload=await uploaded.json();const imported=await command('asset.import',{files:[upload.uploadId],format:'fbx',unitMeters:0.01},projectId);
  const loaded=await request.get(`${base}/api/unified/projects/${projectId}`).then(r=>r.json()),assetId=imported.result.assetIds.find(id=>loaded.project.assets[id].kind==='model'),skeletonId=Object.keys(loaded.project.skeletons)[0];
  const added=await command('character.add',{assetId,skeletonId,name:'E1 actor'},projectId),characterId=added.result.characterId;
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
