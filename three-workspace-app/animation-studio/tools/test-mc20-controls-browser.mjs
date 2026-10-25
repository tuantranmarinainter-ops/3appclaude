// Optional browser evidence using a disposable synthetic native20 GLB, never an Emoticons acceptance claim.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const studio=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.MC20_BROWSER_FIXTURE){console.log('NOT_RUN: set MC20_BROWSER_FIXTURE to a disposable synthetic native20 GLB');process.exit(0);}
const {chromium}=await import(pathToFileURL(path.resolve(studio,'../editor/apps/studio/node_modules/playwright/index.mjs')).href);
const fixture=await readFile(process.env.MC20_BROWSER_FIXTURE),html=await readFile(path.resolve(studio,'../editor/apps/studio/public/animation-studio/v1.33.0/index.html'));
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/synthetic.glb'?'model/gltf-binary':'text/html');res.end(req.url==='/synthetic.glb'?fixture:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__studio?.ready,null,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const s=window.__studio,T=await import('three'),bytes=await(await fetch('/synthetic.glb')).arrayBuffer();
  await s.installAsset(bytes,'SYNTHETIC-native20.glb',true);s.setHostActive(false);
  const rig=s.rig(),C=s.core,widgets=s.view.widgets,physical=rig.records.map(r=>r.id);
  const coverage={bones:physical.length,profile:rig.profile,tree:physical.filter(id=>document.querySelector(`#boneList [data-bone="${id}"]`)).length,fk:physical.filter(id=>widgets.some(w=>w.id===id)).length,ik:widgets.filter(w=>w.id.startsWith('ik_')).length,poles:widgets.filter(w=>w.id.startsWith('pole_')).length};
  const arm=rig.records.find(r=>r.name==='left_arm'),leg=rig.chains.find(c=>c.id==='leftLeg'),project=s.serialized(false);
  const pose=C.snap(arm.o),expected=arm.o.quaternion.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),.2));pose.q=expected.toArray();
  C.addKey(project,arm.id,0,pose,'linear');
  const target=rig.controls['ik_'+leg.id].object,control=C.snap(target);control.p[1]+=.08;control.p[2]+=.04;
  C.addKey(project,'ik_'+leg.id,0,control,'linear');project.ikModes[leg.id]=[{time:0,mode:'ik'}];
  await s.loadProject(project);s.seek(0);const current=s.rig(),chain=current.chains.find(c=>c.id==='leftLeg'),fkError=current.records.find(r=>r.id===arm.id).o.quaternion.angleTo(expected),ikError=chain.c.o.getWorldPosition(new T.Vector3()).distanceTo(current.controls['ik_'+chain.id].object.getWorldPosition(new T.Vector3()));
  const saved=JSON.parse(JSON.stringify(s.serialized(true)));await s.loadProject(saved);s.seek(0);
  document.getElementById('exportProfile').value='same';document.getElementById('sourceUnits').value='m';document.getElementById('includeSkin').checked=true;
  const capture=await s.exportCapture(),out=Uint8Array.from(atob(capture.data),c=>c.charCodeAt(0)).buffer,len=new DataView(out).getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(out,20,len)).trim());
  const helpers=json.nodes.filter(n=>/MC20 IK endpoint/.test(n.name||'')).length,joints=json.skins.map(s=>s.joints.length);
  await s.installAsset(out,'SYNTHETIC-roundtrip.glb',true);s.setHostActive(true);
  const banner=document.createElement('div');banner.textContent='SYNTHETIC MC20 • 20 FK / 4 IK • NOT EMOTICONS';banner.style.cssText='position:fixed;top:8px;left:350px;z-index:99999;background:#071c28;color:#8ef0bb;padding:10px;font:16px sans-serif';document.body.append(banner);
  return{coverage,fkError,ikError,savedKeys:Object.keys(saved.keys).length,exportBones:capture.bones,exportJoints:joints,exportHelpers:helpers,reloadedBones:s.rig().records.length,reloadedChains:s.rig().chains.length,meshes:json.meshes.length,synthetic:true};
 });
 await page.waitForTimeout(500);await page.evaluate(()=>window.__studio.setHostActive(false));
 if(process.env.MC20_BROWSER_SCREENSHOT)await page.screenshot({path:process.env.MC20_BROWSER_SCREENSHOT});
 console.log(JSON.stringify({result,errors},null,2));
 assert.deepEqual(result.coverage,{bones:20,profile:'Minecraft20',tree:20,fk:20,ik:4,poles:4});assert(result.fkError<1e-5);assert(result.ikError<1e-4);assert(result.savedKeys>=2);assert.equal(result.exportBones,20);assert(result.exportJoints.every(n=>n===20));assert.equal(result.exportHelpers,0);assert.equal(result.reloadedBones,20);assert.equal(result.reloadedChains,4);assert(result.meshes>0);assert.deepEqual(errors,[]);
 if(process.env.MC20_BROWSER_REPORT)await writeFile(process.env.MC20_BROWSER_REPORT,JSON.stringify({result,errors},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
