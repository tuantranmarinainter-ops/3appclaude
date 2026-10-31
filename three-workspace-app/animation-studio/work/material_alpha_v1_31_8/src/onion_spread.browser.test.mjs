import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { browserOptions } from './browser_test_options.mjs';
const { chromium } = createRequire(new URL('../../../../editor/apps/studio/package.json', import.meta.url))('playwright');

test('onion spread keeps source state in classic and modes layouts', { timeout: 90000 }, async () => {
  const html = new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url);
  const server = createServer((req, res) => { res.writeHead(200, {'content-type':'text/html'}); res.end(readFileSync(html)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch(browserOptions({headless:true}));
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.__studio?.ready);
    await page.evaluate(() => {
      document.getElementById('keyBtn').click();
      window.__studio.seek(1);
      const set = (id, value) => { const e = document.getElementById(id); if (e.type === 'checkbox') e.checked=value; else e.value=value; e.dispatchEvent(new Event('change')); };
      set('onionEnabled', true); set('onionBefore', '10'); set('onionAfter', '10'); set('onionStep', '3'); set('onionParts','bones');
    });
    for (const layout of ['classic', 'modes']) {
      await page.evaluate(layout => { const e=document.getElementById('layoutMode'); e.value=layout; e.dispatchEvent(new Event('change')); }, layout);
      await page.waitForFunction(() => window.__studio.onion().samples.length === 20);
      const before = await page.evaluate(() => ({project:window.__studio.project(), history:window.__studio.state.historyIndex, root:window.__studio.rig().root.matrixWorld.elements.slice()}));
      await page.evaluate(() => { const e=document.getElementById('onionSpread'); e.value='60'; e.dispatchEvent(new Event('input')); });
      await page.waitForFunction(() => { const o=window.__studio.onion(); return o.slots[10]?.guide.visible; });
      const after = await page.evaluate(() => { const app=window.__studio, o=app.onion(), a=o.slots[10].wrapper.position, b=o.slots[19].wrapper.position; return {project:app.project(), history:app.state.historyIndex, root:app.rig().root.matrixWorld.elements.slice(), spacing:a.distanceTo(b), height:app.rig().height * app.view.wrapper.scale.y}; });
      assert.deepEqual(after.project, before.project); assert.equal(after.history,before.history); assert.deepEqual(after.root,before.root);
      assert.ok(Math.abs(after.spacing - 9 * .6 * after.height) < 1e-6);
      const previous = await page.evaluate(() => window.__studio.onion().slots[10].wrapper.position.toArray());
      await page.evaluate(() => { const v=window.__studio.view, c=v.camera; c.position.sub(v.orbit.target).applyAxisAngle(c.up,Math.PI/2).add(v.orbit.target); c.lookAt(v.orbit.target); c.updateMatrixWorld(true); });
      await page.waitForFunction(old => window.__studio.onion().slots[10].wrapper.position.distanceTo({x:old[0],y:old[1],z:old[2]}) > 0.1, previous);
      await page.evaluate(() => window.__studio.seek(1 + 1/30));
      const next = await page.evaluate(() => ({root:window.__studio.rig().root.matrixWorld.elements.slice(),history:window.__studio.state.historyIndex, project:window.__studio.project()}));
      assert.deepEqual(next.root, before.root); assert.equal(next.history, before.history); assert.deepEqual(next.project, before.project);
      await page.evaluate(() => window.__studio.seek(1));
      await page.evaluate(() => { const v=window.__studio.view, c=v.camera; c.position.sub(v.orbit.target).normalize().multiplyScalar(35).add(v.orbit.target); c.lookAt(v.orbit.target); c.updateMatrixWorld(true); });
      await page.waitForFunction(() => Math.abs(window.__studio.onion().samples.find(s=>s.side==='after' && s.rank===7)?.time - 1.7) < 1e-6);
      await page.waitForTimeout(200);
      const target = await page.evaluate(() => { const a=window.__studio, o=a.onion(), i=o.samples.findIndex(s=>s.side==='after' && s.rank===7), line=o.slots[i].line.geometry.getAttribute('position'), v=a.view, rect=v.renderer.domElement.getBoundingClientRect(), p=o.slots[i].rig.root.position.clone(); p.set((line.getX(0)+line.getX(1))/2,(line.getY(0)+line.getY(1))/2,(line.getZ(0)+line.getZ(1))/2).project(v.camera); return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2,time:o.samples[i].time, slot:o.slots[i].wrapper.position.toArray(), rect:rect.toJSON(), visible:o.slots[i].line.visible, spread:document.getElementById('onionSpread').value}; });
      await page.mouse.click(target.x,target.y);
      assert.ok(Math.abs((await page.evaluate(()=>window.__studio.state.time))-target.time)<1e-6);
      assert.equal((await page.evaluate(()=>window.__studio.state.historyIndex)),before.history);
      await page.evaluate(() => window.__studio.seek(1));
      await page.evaluate(() => { const e=document.getElementById('onionSpread'); e.value='0'; e.dispatchEvent(new Event('input')); });
      await page.waitForFunction(() => window.__studio.onion().slots[10]?.guide.visible === false);
    }
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
