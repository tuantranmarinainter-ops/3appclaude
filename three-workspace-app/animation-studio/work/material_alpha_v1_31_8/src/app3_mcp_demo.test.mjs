import {test} from 'node:test';import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
const require=createRequire(new URL('../../../../editor/apps/studio/package.json',import.meta.url));
const workspace=fileURLToPath(new URL('../../../../',import.meta.url)),studio=path.join(workspace,'editor/apps/studio');
const description='vẫy tay phải 2 lần rồi chống nạnh';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
function lines(child){
 const pending=[],buffer=[];let ended=false;
 createInterface({input:child.stdout}).on('line',line=>{const callback=pending.shift();if(callback)callback.resolve(JSON.parse(line));else buffer.push(JSON.parse(line));});
 child.on('error',error=>{ended=true;for(const p of pending)p.reject(error);});
 child.on('close',code=>{ended=true;for(const p of pending)p.reject(Error(`Python exited ${code}`));});
 return ()=>buffer.length?Promise.resolve(buffer.shift()):ended?Promise.reject(Error('Python exited')):new Promise((resolve,reject)=>pending.push({resolve,reject}));
}
async function stop(child){if(!child||child.exitCode!==null)return;const done=new Promise(r=>child.once('close',r));child.kill();await Promise.race([done,delay(5000)]);if(child.exitCode===null){child.kill('SIGKILL');await done;}}
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}

// Planning touches a detached clone only. Rotations map geometric world directions
// back through the actual FBX parent transforms; source p/s values stay untouched.
function planInBrowser(description){
 const s=window.__studio,r=s.rig(),canon=n=>n.replace(/^mixamorig[:_]?/i,'').toLowerCase();
 const names=['Hips','Head','RightArm','RightForeArm','RightHand','LeftArm','LeftForeArm','LeftHand'];
 const records=Object.fromEntries(names.map(n=>[n,r.records.find(x=>canon(x.name)===n.toLowerCase())]));
 if(Object.values(records).some(x=>!x))throw Error('Sample rig is missing canonical arm bones');
 const V=records.Hips.o.position.constructor,Q=records.Hips.o.quaternion.constructor;
 const point=o=>o.getWorldPosition(new V());r.root.updateWorldMatrix(true,true);
 const origin=point(records.Hips.o),up=point(records.Head.o).sub(origin).normalize();
 const right=point(records.RightArm.o).sub(point(records.LeftArm.o));right.addScaledVector(up,-right.dot(up)).normalize();
 const front=new V().crossVectors(right,up).normalize();
 const upperLength=point(records.RightForeArm.o).distanceTo(point(records.RightArm.o)),lowerLength=point(records.RightHand.o).distanceTo(point(records.RightForeArm.o));
 const meterPerWorld=.01/r.root.parent.getWorldScale(new V()).x;
 const basis={origin:origin.toArray(),up:up.toArray(),right:right.toArray(),front:front.toArray(),meterPerWorld};
 function pose(time,angle,hip=false){
  const parent=r.root.parent.clone(false),root=r.root.clone(true);parent.add(root);parent.updateMatrixWorld(true);
  const get=n=>root.getObjectByName(records[n].name),arm=get('RightArm'),elbow=get('RightForeArm'),hand=get('RightHand');
  function align(a,b,direction){parent.updateMatrixWorld(true);const old=point(b).sub(point(a)).normalize(),delta=new Q().setFromUnitVectors(old,direction.clone().normalize()),world=delta.multiply(a.getWorldQuaternion(new Q())),parentQ=a.parent.getWorldQuaternion(new Q()).invert();a.quaternion.copy(parentQ.multiply(world));parent.updateMatrixWorld(true);}
  const shoulder=point(arm);let upper,lower;
  if(!hip){upper=right.clone().multiplyScalar(.48).addScaledVector(up,Math.sqrt(1-.48*.48));lower=up.clone().multiplyScalar(Math.cos(angle*Math.PI/180)).addScaledVector(right,Math.sin(angle*Math.PI/180));}
  else{
   const target=origin.clone().addScaledVector(right,.13/meterPerWorld).addScaledVector(up,.08/meterPerWorld);
   const v=target.clone().sub(shoulder),distance=v.length(),axis=v.normalize();
   if(distance>=upperLength+lowerLength||distance<=Math.abs(upperLength-lowerLength))throw Error('Hip target outside arm reach');
   const along=(upperLength**2-lowerLength**2+distance**2)/(2*distance),height=Math.sqrt(upperLength**2-along**2);
   const outward=right.clone().addScaledVector(axis,-right.dot(axis)).normalize();
   const elbowTarget=shoulder.clone().addScaledVector(axis,along).addScaledVector(outward,height);
   upper=elbowTarget.sub(shoulder).normalize();lower=target.sub(shoulder.clone().addScaledVector(upper,upperLength)).normalize();
  }
  align(arm,elbow,upper);align(elbow,hand,lower);
  const transforms={};for(const n of ['RightArm','RightForeArm']){const o=get(n);transforms[records[n].id]={p:o.position.toArray(),q:o.quaternion.toArray(),s:o.scale.toArray()};}
  return{time,transforms};
 }
 const poses=[pose(0,0),...[[.5,0],[.75,25],[1,0],[1.25,-25],[1.5,0],[1.75,25],[2,0],[2.25,-25],[2.5,0]].map(([t,a])=>pose(t,a)),pose(3.5,0,true),pose(4,0,true)];
 return{description,duration:4,poses,basis,bones:Object.fromEntries(Object.entries(records).map(([n,x])=>[n,{id:x.id,name:x.name}])),sourceUnitMeters:.01,wrapperScale:r.root.parent.getWorldScale(new V()).x,upperLengthMeters:upperLength*meterPerWorld,lowerLengthMeters:lowerLength*meterPerWorld};
}

// Independent observation: seek the applied native project and read the live
// scene hierarchy. No authored key values or planned rotations enter this trace.
function observeInBrowser({bones,basis}){
 const s=window.__studio,r=s.rig(),V=r.root.position.constructor,up=new V().fromArray(basis.up),right=new V().fromArray(basis.right),scale=basis.meterPerWorld;
 const objects=Object.fromEntries(Object.entries(bones).map(([n,b])=>[n,r.records.find(x=>x.id===b.id).o]));
 const trace=[];for(let i=0;i<=160;i++){const time=i/40;s.seek(time);r.root.updateWorldMatrix(true,true);const p=Object.fromEntries(Object.entries(objects).map(([n,o])=>[n,o.getWorldPosition(new V())]));const delta=p.RightHand.clone().sub(p.RightForeArm);trace.push({time,angle:Math.atan2(delta.dot(right),delta.dot(up))*180/Math.PI,points:Object.fromEntries(Object.entries(p).map(([n,v])=>[n,v.toArray().map(x=>x*scale)]))});}return trace;
}
function measurements(trace){
 const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
 const wave=trace.filter(x=>x.time>=.5&&x.time<=2.5);const lobes=[];let sign=0;
 for(const x of wave){const next=x.angle>15?1:x.angle< -15?-1:0;if(next&&next!==sign){lobes.push(next);sign=next;}}
 const first=trace[0].points,hold=trace.filter(x=>x.time>=3.5),last=trace.at(-1).points;
 let maxLeftDrift=0,segmentLengthError=0;
 for(const x of trace){for(const n of ['LeftArm','LeftForeArm','LeftHand'])maxLeftDrift=Math.max(maxLeftDrift,distance(first[n],x.points[n]));for(const [a,b]of [['RightArm','RightForeArm'],['RightForeArm','RightHand']])segmentLengthError=Math.max(segmentLengthError,Math.abs(distance(first[a],first[b])-distance(x.points[a],x.points[b])));}
 return{cycles:lobes.length/2,lobes,amplitudeDegrees:Math.max(...wave.map(x=>x.angle))-Math.min(...wave.map(x=>x.angle)),maxLeftDrift,segmentLengthError,handHipDistance:distance(last.RightHand,last.Hips),holdDrift:Math.max(...hold.map(x=>distance(hold[0].points.RightHand,x.points.RightHand)))};
}

test('E5 fixed Vietnamese prompt executes real stdio MCP animation and observed two-cycle wrist trace',{timeout:600000},async()=>{
 const artifact=path.join(workspace,'editor/.test-results/e5-app3-demo');rmSync(artifact,{recursive:true,force:true});mkdirSync(artifact,{recursive:true});
 const temp=mkdtempSync(path.join(tmpdir(),'e5-demo-')),dist='.next-e5-'+process.pid,tsconfig=path.join(studio,'tsconfig.json'),oldConfig=readFileSync(tsconfig);
 let server,browser,driver;let serverLog='',pythonErrors='';
 try{
  const base=`http://127.0.0.1:${await port()}`,env={...process.env,BBS_UNIFIED_PROJECTS_DIR:path.join(temp,'projects'),NEXT_DIST_DIR:dist,NEXT_TELEMETRY_DISABLED:'1'};delete env.NODE_TEST_CONTEXT;
  server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',new URL(base).port],{cwd:studio,env,stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',x=>{serverLog+=x;});
  let ready=false;for(let i=0;i<180;i++){if(server.exitCode!==null)throw Error('Next exited: '+serverLog);try{const response=await fetch(base,{signal:AbortSignal.timeout(5000)});if(response.ok){ready=true;break}}catch{}await delay(500);}assert.ok(ready,'Next startup deadline: '+serverLog);
  const {chromium}=require('playwright');browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1500,height:1200}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const request=context.request,headers={Origin:base};assert.equal((await request.post(base+'/api/unified/commands',{headers,data:{}})).status(),401);assert.ok((await request.post(base+'/api/unified/session',{headers})).ok());
  async function projectRevision(id){return(await request.get(`${base}/api/unified/projects/${id}`).then(r=>r.json())).project.revision;}
  async function command(command,args={},projectId){const response=await request.post(base+'/api/unified/commands',{headers,data:{requestId:randomUUID(),command,args,...(projectId?{projectId,expectedRevision:await projectRevision(projectId)}:{})}});const body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));return body;}
  const {makeEmptyDraft}=await import(pathToFileURL(require.resolve('@topview/3d-builder')).href);
  const projectId=(await command('project.create',{name:'E5 fixed text demo',scene:makeEmptyDraft('E5',30,120,{fov:50,position:{x:0,y:2,z:5},rotation:{x:0,y:0,z:0},lookAt:{x:0,y:1,z:0}})})).projectId;
  const bytes=readFileSync(path.join(workspace,'builtin-assets/animation-studio/sample.fbx'));
  const uploaded=await request.post(base+'/api/unified/uploads',{headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':'E5.fbx'},data:bytes});assert.ok(uploaded.ok());
  const imported=await command('asset.import',{files:[(await uploaded.json()).uploadId],format:'fbx',unitMeters:.01},projectId);
  const loaded=(await request.get(`${base}/api/unified/projects/${projectId}`).then(r=>r.json())).project;
  const assetId=imported.result.assetIds.find(id=>loaded.assets[id].kind==='model');await command('character.add',{assetId,skeletonId:Object.keys(loaded.skeletons)[0],name:'E5 sample actor'},projectId);
  await page.goto(`${base}/?unified=${projectId}`);await page.locator('nav[aria-label="5 workspace"], nav[aria-label="Chế độ biên tập trong App 2"]').getByRole('button',{name:/Animation/}).click();await page.locator('.wb-animation-creation-frame').waitFor();
  const frame=page.frame({url:/animation-studio\/v1\.33\.0\/index\.html/});assert.ok(frame);await frame.waitForFunction(()=>window.__studio?.ready&&window.__app3LocalBridge,null,{timeout:60000});
  await page.locator('.wb-animation-creation-toolbar').first().getByRole('button',{name:'Tạo animation',exact:true}).click();await frame.waitForFunction(()=>window.__app3LocalBridge.status().bound,null,{timeout:60000});
  await frame.evaluate(async()=>{const s=window.__studio,p=s.serialized(false);p.duration=4;p.fps=30;p.keys={};delete p.lab;p.director={version:1,idea:'',markers:[]};await s.loadProject(p);s.seek(0);});
  const plan=await frame.evaluate(planInBrowser,description);writeFileSync(path.join(artifact,'plan.json'),JSON.stringify(plan,null,2));
  await frame.evaluate(({basis})=>{const s=window.__studio,v=s.view,V=v.camera.position.constructor,up=new V().fromArray(basis.up),front=new V().fromArray(basis.front),center=new V().fromArray(basis.origin).addScaledVector(up,.15/basis.meterPerWorld);v.camera.up.copy(up);v.camera.position.copy(center).addScaledVector(front,-4.2/basis.meterPerWorld);v.orbit.target.copy(center);v.camera.lookAt(center);for(const id of ['rigVisible','rigLabels','rigShowBones','showBones','showNames','showAxes'])document.getElementById(id).checked=false;s.seek(0);v.gizmo.detach();v.moveGizmo.detach();},plan);
  const viewport=frame.locator('#editViewport'),images={};
  const capture=async(name,time)=>{const rendered=await frame.evaluate(t=>{const s=window.__studio;s.seek(t);for(const id of ['rigVisible','rigLabels','rigShowBones','showBones','showNames','showAxes'])document.getElementById(id).checked=false;s.view.gizmo.detach();s.view.moveGizmo.detach();s.view.dirty=true;return s.view.renderer.info.render.frame;},time);await frame.waitForFunction(({rendered,time})=>window.__studio.view.renderer.info.render.frame>rendered&&!window.__studio.view.dirty&&window.__studio.state.time===time,{rendered,time},{timeout:10000});const png=await viewport.screenshot(name?{path:path.join(artifact,name)}:{});assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.length>5000);if(name)images[name]={sha256:createHash('sha256').update(png).digest('hex'),width:png.readUInt32BE(16),height:png.readUInt32BE(20)};return png;};
  const baseline=await frame.evaluate(observeInBrowser,plan);await capture('before.png',0);await page.screenshot({path:path.join(artifact,'before-ui.png')});
  driver=spawn(python,['-m','agent.app3_mcp_demo',projectId,'--plan',path.join(artifact,'plan.json'),'--transcript',path.join(artifact,'transcript.json')],{cwd:workspace,env:{...env,BBS_APP_URL:base,PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe','pipe']});driver.stderr.on('data',x=>{pythonErrors+=x;});const rawNext=lines(driver),next=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Python response deadline; "+pythonErrors)),45000);rawNext().then(x=>{clearTimeout(timer);resolve(x)},e=>{clearTimeout(timer);reject(e)});}),hello=await next();assert.equal(hello.ready,true,pythonErrors);assert.equal(hello.description,description);
  async function action(message){driver.stdin.write(JSON.stringify({...message,projectRevision:await projectRevision(projectId)})+'\n');const result=await next();assert.equal(result.ok,true,JSON.stringify(result)+' '+pythonErrors);return result.result;}
  const native=()=>frame.evaluate(()=>({json:JSON.stringify(window.__studio.state.project),history:window.__studio.state.historyIndex}));
  for(let index=0;index<hello.operations;index++){
   console.log('E5 reviewing candidate '+index);const before=await native();await action({action:'stage',index});assert.deepEqual(await native(),before,'stage changed native project');
   await action({action:'preview',original:false});assert.deepEqual(await native(),before,'preview changed native project');await action({action:'preview',original:true});assert.deepEqual(await native(),before);
   const applied=await action({action:'apply'});assert.equal(applied.value.undoSteps,1);const after=await native();assert.equal(after.history,before.history+1);
   await frame.locator('#undoBtn').click();assert.deepEqual(await native(),before,'native single Undo');await frame.locator('#redoBtn').click();assert.deepEqual(await native(),after,'native single Redo');
  }
  await action({action:'read'});driver.stdin.end();await new Promise((resolve,reject)=>{driver.once('close',code=>code===0?resolve():reject(Error(pythonErrors)));});
  const trace=await frame.evaluate(observeInBrowser,plan),metrics=measurements(trace),up=plan.basis.up;
  const height=p=>p.reduce((sum,x,i)=>sum+x*up[i],0),wave=trace.filter(x=>x.time>=.5&&x.time<=2.5);
  const metricDistance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
  metrics.wristTravelMeters=Math.max(...wave.map(a=>Math.max(...wave.map(b=>metricDistance(a.points.RightHand,b.points.RightHand)))));
  const hipTarget=trace.at(-1).points.Hips.map((x,i)=>x+plan.basis.right[i]*.13+up[i]*.08);metrics.finalTargetError=metricDistance(trace.at(-1).points.RightHand,hipTarget);
  metrics.neutralAngleErrorDegrees=Math.max(...wave.filter(x=>[.5,1.5,2.5].includes(x.time)).map(x=>Math.abs(x.angle)));metrics.sourceUnitMeters=plan.sourceUnitMeters;metrics.wrapperScale=plan.wrapperScale;
  metrics.upperLengthMeters=plan.upperLengthMeters;metrics.lowerLengthMeters=plan.lowerLengthMeters;
  metrics.minRaisedHandAboveHead=Math.min(...wave.map(x=>height(x.points.RightHand)-height(x.points.Head)));
  assert.deepEqual(metrics.lobes,[1,-1,1,-1]);assert.equal(metrics.cycles,2);assert.ok(metrics.neutralAngleErrorDegrees<1);assert.ok(metrics.amplitudeDegrees>=45);assert.ok(metrics.wristTravelMeters>=.15);assert.ok(metrics.finalTargetError<.03);assert.ok(metrics.minRaisedHandAboveHead>.05);assert.ok(metrics.handHipDistance<.19);assert.ok(metrics.maxLeftDrift<.001);assert.ok(metrics.segmentLengthError<.0001);assert.ok(metrics.holdDrift<.001);
  assert.ok(measurements(baseline).amplitudeDegrees<.001,'rest baseline already moving');
  for(const [name,time]of [['wave',.75],['after',4]]){await capture(name+'.png',time);await page.screenshot({path:path.join(artifact,name+'-ui.png')});}
  assert.deepEqual(errors,[]);
  assert.equal(new Set(Object.values(images).map(x=>x.sha256)).size,3,'pose images must differ');assert.equal(new Set(Object.values(images).map(x=>x.width+'x'+x.height)).size,1,'matching viewport framing');
  const hostWarnings=await page.locator('[role=alert]').allTextContents();
  const report={images,hostWarnings,limitations:['Deterministic example for one fixed prompt; no general motion synthesis.','Existing host animation-motion panel navigation may display a nonblocking warning; full UI captures retained.'],status:'PASS',description,planner:'deterministic fixed-prompt geometric blocking; not general text-to-motion',projectId,operations:hello.operations,metrics,bones:plan.bones,units:'meters, projected onto observed canonical body axes; source FBX centimeter / normalized Z-up wrapper conversion',trace,baseline,screenshots:['before.png','wave.png','after.png']};
  writeFileSync(path.join(artifact,'report.json'),JSON.stringify(report,null,2));console.log('E5 observed metrics '+JSON.stringify(metrics)+' artifacts='+artifact);
 }finally{
  if(driver?.exitCode===null){const closed=new Promise(r=>driver.once('close',r));driver.stdin.end();await Promise.race([closed,delay(12000)]);}await stop(driver);if(browser)await browser.close();await stop(server);writeFileSync(tsconfig,oldConfig);rmSync(path.join(studio,dist),{recursive:true,force:true});rmSync(temp,{recursive:true,force:true});writeFileSync(path.join(artifact,'server.log'),serverLog);
 }
});
