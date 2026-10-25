import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(new URL('../../../../editor/apps/studio/package.json',import.meta.url))('playwright');
const artifact=new URL('../../../outputs/Animation_Studio_v1_33_0.html',import.meta.url);
test('A1 pointer stretch, numeric percent, reset, pose cadence and saved reload',{timeout:120000},async()=>{
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(readFileSync(artifact));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('dialog',d=>d.accept());await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__studio?.ready);
  await page.evaluate(async()=>{const s=window.__studio,p=s.serialized(false),C=s.core;delete p.parallelModes;delete p.lab;p.duration=2;p.loop=[0,2];p.keys={};p.ikModes={};p.ikOptions={};const id=s.recordNames()[0].id,pose={p:[0,0,0],q:[0,0,0,1],s:[1,1,1]};C.addKey(p,id,0,pose,'linear');C.addKey(p,id,2,{...pose,p:[2,0,0]},'linear');await s.loadProject(p);s.switchStudioMode('lab');document.querySelector('#labPanel details:last-child').open=true;});
  const lane=page.locator('#labClipLane');await lane.scrollIntoViewIfNeeded();const box=await lane.locator('.lab-clip-track').boundingBox(),edge=await lane.locator('.edge').boundingBox();assert.ok(box&&edge);
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();await page.mouse.move(edge.x+edge.width/2+box.width,edge.y+edge.height/2,{steps:10});await page.mouse.up();
  let state=await page.evaluate(()=>window.__studio.project());assert.equal(state.duration,4);assert.equal(state.lab.clips[0].speed,.5);assert.equal(state.lab.clips[0].length,4);
  await lane.locator('.lab-clip-block').click();
  const positions=await page.evaluate(()=>{const s=window.__studio,id=s.recordNames()[0].id;return [0,1,2,3,4].map(t=>{s.seek(t);return s.pose()[id]?.p??s.core.snap(s.rig().records[0].o).p;});});
  assert.deepEqual(positions.map(p=>p[0]),[0,.5,1,1.5,2]);
  const baked=await page.evaluate(async()=>{document.querySelector('#includeSkin').checked=true;return {nativeProject:window.__studio.serialized(false),glb:(await window.__studio.exportCapture()).data}});
  await page.locator('#labClipSpeed').fill('200');await page.locator('#labClipSpeed').dispatchEvent('change');state=await page.evaluate(()=>window.__studio.project());assert.equal(state.lab.clips[0].speed,2);assert.equal(state.lab.clips[0].length,1);assert.equal(state.duration,1);
  await page.locator('#labClipSpeedReset').click();state=await page.evaluate(()=>window.__studio.project());assert.equal(state.lab.clips[0].speed,1);assert.equal(state.lab.clips[0].length,2);assert.equal(state.duration,2);
  const saved=await page.evaluate(()=>window.__studio.serialized(false));await page.evaluate(async p=>{await window.__studio.loadProject(p)},saved);assert.deepEqual((await page.evaluate(()=>window.__studio.project())).lab.clips,saved.lab.clips);
  const output=new URL('../../../../../outputs/A1/',import.meta.url);mkdirSync(output,{recursive:true});await page.screenshot({path:fileURLToPath(new URL('app3-stretch.png',output))});writeFileSync(new URL('native-bake.json',output),JSON.stringify(baked));writeFileSync(new URL('app3-stretch.json',output),JSON.stringify({speedAfterDrag:.5,durationAfterDrag:4,positions,reload:true,resetSpeed:1},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
