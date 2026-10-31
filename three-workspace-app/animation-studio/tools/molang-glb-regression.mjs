// SPDX-License-Identifier: GPL-3.0-or-later
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { browserOptions } from '../work/material_alpha_v1_31_8/src/browser_test_options.mjs';
const require = createRequire(new URL('../../editor/apps/studio/package.json', import.meta.url));
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const htmlPath = fileURLToPath(new URL('../outputs/Animation_Studio_v1_33_0.html', import.meta.url));
const html = fs.readFileSync(htmlPath);
const server = createServer((req,res) => { res.writeHead(200, {'content-type':'text/html'}); res.end(html); });
function unpack(data) {
 const buf=Buffer.from(data); const n=buf.readUInt32LE(12), json=JSON.parse(buf.subarray(20,20+n).toString());
 const binStart=20+n+8;
 return json.animations[0].channels.map(c=>{
   const s=json.animations[0].samplers[c.sampler];
   const read=idx=>{ const a=json.accessors[idx],v=json.bufferViews[a.bufferView], size={SCALAR:1,VEC3:3,VEC4:4}[a.type]; assert.equal(a.componentType,5126); let arr=[]; for(let i=0;i<a.count;i++)for(let j=0;j<size;j++)arr.push(buf.readFloatLE(binStart+(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*4)+j*4)); return arr; };
   return { path:c.target.path, time:read(s.input), value:read(s.output) };
 });
}
(async()=>{ const browser=await chromium.launch(browserOptions({headless:true})); try {
 const page=await browser.newPage({viewport:{width:1600,height:1100}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
 await page.goto(pathToFileURL(path.resolve(htmlPath)).href); await page.waitForFunction(()=>window.__studio?.ready);
 for (const [duration,fps] of [[1,30],[0.1,24]]) {
 const result=await page.evaluate(async ({duration,fps})=>{
  const s=window.__studio,p=s.serialized(); delete p.lab; delete p.parallelModes; p.duration=duration; p.fps=fps;p.loop=[0,duration];p.keys={};p.ikModes={};p.ikOptions={};p.molangVariables={amplitude:15};
  const bone=s.rig().records[0], rest=s.core.snap(bone.o); s.core.addKey(p,bone.id,0,rest,'linear');
  for(const [path,axis,source] of [['p',0,'math.sin(q.anim_time*360)*v.amplitude'],['r',1,'q.anim_time*90'],['s',2,'1+q.anim_time']]) {const r=s.core.setKeyExpression(p,bone.id,0,path,axis,source); if(r.error)throw Error(r.error)}
  const baked=s.core.bakeExpressions(p); await s.loadProject(p); document.getElementById('includeSkin').checked=false;document.getElementById('exportProfile').value='same'; const a=await s.buildGLB(); await s.loadProject(baked);const b=await s.buildGLB(); return {a:Array.from(new Uint8Array(a.data)),b:Array.from(new Uint8Array(b.data)),framesA:a.frames,framesB:b.frames,bakedTimes:baked.keys[bone.id].map(k=>k.time)};
 },{duration,fps});
 const a=unpack(result.a),b=unpack(result.b);assert.equal(a.length,b.length);let max=0,components=0;for(let i=0;i<a.length;i++){assert.equal(a[i].path,b[i].path);assert.deepEqual(a[i].time,b[i].time);assert.equal(a[i].value.length,b[i].value.length);a[i].value.forEach((v,j)=>{max=Math.max(max,Math.abs(v-b[i].value[j]));components++})} console.log(JSON.stringify({duration,fps,framesA:result.framesA,framesB:result.framesB,bakedTimes:result.bakedTimes,tracks:a.length,components,maxAbsDeviation:max,bytesA:result.a.length,bytesB:result.b.length,errors}));assert.ok(max<1e-6);assert.deepEqual(errors,[]);
 }
 } finally {await browser.close();server.close()} })().catch(e=>{console.error(e);server.close();process.exitCode=1});
