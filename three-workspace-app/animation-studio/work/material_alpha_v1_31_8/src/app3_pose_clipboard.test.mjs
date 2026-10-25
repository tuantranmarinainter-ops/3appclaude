import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
const require=createRequire(new URL('../../../../editor/apps/studio/package.json',import.meta.url));
test('A7 evaluated key capture, whole/selected paste, exact Undo and saved round-trip',{timeout:120000},async()=>{
 const {chromium}=require('playwright'),html=readFileSync(new URL('../../../outputs/Animation_Studio_v1_33_0.html',import.meta.url));
 const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__studio?.ready);
 const fixture=await page.evaluate(async()=>{const s=window.__studio,p=s.serialized(),data=s.pose(),id=s.recordNames().find(r=>/LeftArm$/.test(r.name)).id;p.duration=2;p.loop=[0,2];p.keys={};p.ikModes={};p.ikOptions={};const a=structuredClone(data[id]),b=structuredClone(a);b.q=[0,0,Math.sin(.3),Math.cos(.3)];s.core.addKey(p,id,0,a,'linear');s.core.addKey(p,id,.5,b,'linear');await s.loadProject(p);s.seek(.5);const expected=s.pose();s.seek(0);return{id,expected};});
 await page.locator('#minimalKeyOptions summary').click();
 async function rightClickKey(){await page.locator('#timeline').scrollIntoViewIfNeeded();await page.waitForTimeout(200);const box=await page.locator('#timeline').boundingBox(),row=Number(await page.locator('#timeline').getAttribute('data-row-height'));await page.mouse.click(box.x+130+(box.width-142)*.5/2,box.y+row/2,{button:'right'});}
 const before=await page.evaluate(()=>({project:window.__studio.project(),pose:window.__studio.pose()}));
 await rightClickKey();await page.getByRole('menuitem',{name:'Sao chép pose (Toàn thân)',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>({project:window.__studio.project(),pose:window.__studio.pose()})),before,'copy changes neither pose nor project');
 await page.evaluate(()=>window.__studio.seek(1.5));await page.locator('[data-sidebar="pose"]').first().click();await page.locator('#pastePose').click();
 const pasted=await page.evaluate(()=>({project:window.__studio.project(),pose:window.__studio.pose()}));
 assert.deepEqual(pasted.pose[fixture.id],fixture.expected[fixture.id]);assert.ok(pasted.project.keys[fixture.id].some(k=>k.time===1.5));
 await page.locator('#undoBtn').click();assert.deepEqual(await page.evaluate(()=>window.__studio.project()),before.project);await page.locator('#redoBtn').click();
 const saved=await page.evaluate(()=>window.__studio.serialized());await page.evaluate(p=>window.__studio.loadProject(p),saved);await page.evaluate(()=>window.__studio.seek(1.5));assert.deepEqual(await page.evaluate(id=>window.__studio.pose()[id],fixture.id),fixture.expected[fixture.id]);
 await page.evaluate(id=>{window.__studio.select(id);window.__studio.seek(0);},fixture.id);
 const selectedBefore=await page.evaluate(()=>window.__studio.project());await rightClickKey();await page.getByRole('menuitem',{name:'Sao chép pose (Phần đang chọn)',exact:true}).click();
 await page.evaluate(()=>window.__studio.seek(1.75));await page.locator('#pastePose').click();
 const selectedAfter=await page.evaluate(()=>({project:window.__studio.project(),pose:window.__studio.pose()}));assert.deepEqual(selectedAfter.pose[fixture.id],fixture.expected[fixture.id]);assert.deepEqual(selectedAfter.project.keys.root,selectedBefore.keys.root,'selected paste preserves root');
 await page.locator('#undoBtn').click();assert.deepEqual(await page.evaluate(()=>window.__studio.project()),selectedBefore);
 assert.deepEqual(errors,[]);const dir=process.env.APP3_EVIDENCE_DIR;if(dir){mkdirSync(dir,{recursive:true});await page.screenshot({path:dir+'/pose-paste.png',fullPage:true});writeFileSync(dir+'/numeric.json',JSON.stringify({id:fixture.id,expected:fixture.expected[fixture.id],actual:pasted.pose[fixture.id],copyUnchanged:true,selectedPreservesRoot:true,undoExact:true,reopenExact:true,errors},null,2));}
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
