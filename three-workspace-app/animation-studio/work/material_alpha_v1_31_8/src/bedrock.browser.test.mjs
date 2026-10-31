import { browserOptions } from './browser_test_options.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const { chromium } = createRequire(new URL('../../../../editor/apps/studio/package.json', import.meta.url))('playwright');
const artifact = new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url);

test('Bedrock JSON export, import with bone mapping, undo — both layouts', { timeout: 240000 }, async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(readFileSync(artifact));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(browserOptions({ headless: true }));
  try {
    for (const layout of ['classic', 'modes']) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((mode) => localStorage.setItem('animation-studio-settings', JSON.stringify({ layoutMode: mode })), layout);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.__studio?.ready, null, { timeout: 30000 }).catch((error) => {
        throw new Error(`Studio failed to start: ${errors.join('; ')}; ${error.message}`);
      });
      // A bone with a rest rotation, three keys (linear → step → linear) and one Molang channel.
      const boneId = await page.evaluate(async () => {
        const s = window.__studio, p = s.project(), rig = s.rig();
        const record = rig.records.find((r) => Math.abs(r.rest.q[3]) < 0.999) || rig.records[1];
        delete p.lab; delete p.parallelModes;
        p.rig.asset = null; p.duration = 1; p.fps = 24; p.loop = [0, 1];
        p.keys = {}; p.ikModes = {}; p.ikOptions = {}; p.molangVariables = {};
        const turn = (deg) => {
          const T = s.core.graphCurves;
          const e = T.euler(record.rest.q).map((v, i) => v + deg[i]);
          return { p: [...record.rest.p], q: T.quaternion(e), s: [...(record.rest.s || [1, 1, 1])] };
        };
        s.core.addKey(p, record.id, 0, turn([0, 0, 0]), 'step');
        s.core.addKey(p, record.id, 0.5, turn([20, 0, 35]), 'linear');
        s.core.addKey(p, record.id, 1, turn([0, -15, 0]), 'linear');
        s.core.setKeyExpression(p, record.id, 1, 'p', 1, `${record.rest.p[1]} + math.sin(q.anim_time*360)*0.01`);
        p.playMode = 'hold';
        await s.loadProject(p);
        return record.id;
      });
      // Same entry points the workflow tests use: the Xuất step (classic) or the Xuất tab (modes).
      await page.locator(layout === 'modes' ? '#layoutTab-export' : '#workflowExport').click();
      const exportPanel = page.locator('#exportPanel');
      if (!(await exportPanel.evaluate((el) => el.open))) await exportPanel.evaluate((el) => { el.open = true; });
      await page.locator('#bedrockPanel > summary').click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#bedrockExport').click()]);
      // Headless Chromium reports detached-anchor downloads as "download"; the app names the file in the status line.
      assert.match(await page.locator('#bedrockStatus').textContent(), /Đã xuất .+\.animation\.json\./);
      assert.ok(download);
      const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
      const animation = Object.values(file.animations)[0];
      assert.equal(file.format_version, '1.8.0');
      assert.equal(animation.loop, 'hold_on_last_frame');
      const tag = Object.values(animation.bones)[0];
      assert.ok(tag.rotation['0.5'].pre, 'step key exports pre/post');
      assert.equal(typeof tag.position['1.0'][1], 'string', 'Molang channel exported as string');
      const original = await page.evaluate((id) => window.__studio.project().keys[id], boneId);
      const historyBefore = await page.evaluate(() => window.__studio.state.historyIndex);

      // Clear, then import the file back and compare.
      await page.evaluate(async (id) => {
        const s = window.__studio, p = s.project();
        p.keys[id] = [];
        delete p.keys[id];
        p.playMode = 'loop';
        await s.loadProject(p);
      }, boneId);
      await page.locator('#bedrockImportInput').setInputFiles({ name: 'back.animation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await page.locator('#bedrockApply').click();
      assert.match(await page.locator('#bedrockStatus').textContent(), /Đã nhập 1 xương/);
      const imported = await page.evaluate((id) => {
        const p = window.__studio.project();
        return { keys: p.keys[id], playMode: p.playMode, duration: p.duration };
      }, boneId);
      assert.equal(imported.playMode, 'hold');
      assert.equal(imported.duration, 1);
      assert.equal(imported.keys.length, original.length);
      for (let i = 0; i < original.length; i++) {
        const a = original[i], b = imported.keys[i];
        assert.ok(Math.abs(a.time - b.time) < 1e-9);
        const dot = Math.abs(a.q.reduce((sum, v, k) => sum + v * b.q[k], 0));
        assert.ok(2 * Math.acos(Math.min(1, dot)) * (180 / Math.PI) < 1e-3, `rotation key ${i}`);
        a.p.forEach((v, k) => assert.ok(Math.abs(v - b.p[k]) < 1e-4, `position key ${i}`));
      }
      assert.equal(imported.keys[0].interp, 'step');
      assert.equal(imported.keys[2].molang.p1, original[2].molang.p1);

      // Undo removes the import in one step.
      const afterImport = await page.evaluate(() => window.__studio.state.historyIndex);
      assert.ok(afterImport > historyBefore - 1);
      await page.locator('#undoBtn').click();
      assert.equal(await page.evaluate((id) => window.__studio.project().keys[id], boneId), undefined);

      // A foreign bone name asks for a mapping; choosing a bone imports onto it.
      const foreign = { format_version: '1.8.0', animations: { 'animation.tail': { animation_length: 1, bones: { TailTip: { rotation: { '0.0': [0, 0, 0], '1.0': [0, 0, 30] } } } } } };
      await page.locator('#bedrockImportInput').setInputFiles({ name: 'tail.animation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(foreign)) });
      const select = page.locator('#bedrockMapping select[data-bone="TailTip"]');
      await select.selectOption(boneId);
      await page.locator('#bedrockApply').click();
      assert.equal((await page.evaluate((id) => window.__studio.project().keys[id], boneId)).length, 2);

      // Invalid file: message, no change.
      const count = await page.evaluate(() => window.__studio.state.historyIndex);
      await page.locator('#bedrockImportInput').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"x":1}') });
      // File reading is async: wait for the panel to report the parse error.
      await page.waitForFunction(() => /animations/.test(document.querySelector('#bedrockStatus').textContent), null, { timeout: 10000 });
      assert.equal(await page.evaluate(() => window.__studio.state.historyIndex), count);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
