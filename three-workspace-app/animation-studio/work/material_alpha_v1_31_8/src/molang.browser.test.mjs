import { browserOptions } from './browser_test_options.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';

const { chromium } = createRequire(new URL('../../../../editor/apps/studio/package.json', import.meta.url))('playwright');
const artifact = new URL('../../../outputs/Animation_Studio_v1_33_0.html', import.meta.url);

test('Molang editor, variables and bake undo/redo work in both layouts', { timeout: 180000 }, async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(readFileSync(artifact));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(browserOptions({ headless: true }));
  try {
    for (const layout of ['classic', 'modes']) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(mode => localStorage.setItem('animation-studio-settings', JSON.stringify({ layoutMode: mode })), layout);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.__studio?.ready, null, { timeout: 15000 }).catch(error => { throw new Error(`Studio failed to start: ${errors.join('; ')}; ${error.message}`); });
      if (layout === 'modes') await page.locator('#layoutTab-animate').click();
      await page.evaluate(async () => {
        const s = window.__studio, p = s.project();
        delete p.lab; delete p.parallelModes;
        p.rig.asset = null; p.duration = 1; p.fps = 24; p.loop = [0, 1];
        p.keys = {}; p.ikModes = {}; p.ikOptions = {}; p.molangVariables = {};
        s.core.addKey(p, 'root', 0, {p:[2,0,0], q:[0,0,0,1], s:[1,1,1]}, 'linear');
        await s.loadProject(p);
      });
      await page.locator('#minimalKeyOptions > summary').click();
      await page.locator('#keySelectionScope').selectOption('node');
      const timeline = page.locator('#timeline');
      await timeline.scrollIntoViewIfNeeded();
      const bounds = await timeline.boundingBox();
      const rowHeight = Number(await timeline.getAttribute('data-row-height'));
      await page.mouse.click(bounds.x + 130, bounds.y + rowHeight / 2);
      assert.equal(await page.locator('#keySelectionCount').textContent(), '1 key đã chọn');
      await page.locator('#molangPanel > summary').click();
      for (const channel of ['p0', 'p1', 'p2', 'r0', 'r1', 'r2', 's0', 's1', 's2']) {
        assert.equal(await page.locator(`#molang-${channel}`).isEnabled(), true);
        assert.notEqual(await page.locator(`#molang-${channel}`).inputValue(), '');
      }
      await page.locator('#molangVariableName').fill('speed');
      await page.locator('#molangAddVariable').click();
      const number = page.getByLabel('Số speed');
      await number.fill('3');
      await number.dispatchEvent('change');
      assert.equal(await page.evaluate(() => window.__studio.project().molangVariables.speed), 3);
      const beforeSlider = await page.evaluate(() => window.__studio.state.historyIndex);
      await page.getByLabel('Giá trị speed').focus();
      await page.keyboard.press('ArrowRight');
      assert.ok(Math.abs(await page.evaluate(() => window.__studio.project().molangVariables.speed) - 3.01) < 1e-6);
      assert.equal(await page.evaluate(() => window.__studio.state.historyIndex), beforeSlider + 1);
      await page.locator('#undoBtn').click();
      assert.equal(await page.evaluate(() => window.__studio.project().molangVariables.speed), 3);
      await page.locator('#redoBtn').click();
      assert.ok(Math.abs(await page.evaluate(() => window.__studio.project().molangVariables.speed) - 3.01) < 1e-6);
      await number.fill('3');
      await number.dispatchEvent('change');
      await page.locator('#molangChannel').selectOption('p0');
      await page.locator('#molangExpression').fill('variable.speed * query.anim_time + 2');
      await page.locator('#molangExpression').press('Enter');
      let p = await page.evaluate(() => window.__studio.project());
      assert.equal(p.keys.root[0].molang.p0, 'variable.speed * query.anim_time + 2');
      const sample = () => page.evaluate(() => {
        const s = window.__studio, p = s.project();
        return s.core.sampleKeys(p.keys.root, 0.5, p.keys.root[0], p).p[0];
      });
      assert.equal(await sample(), 3.5);
      await page.locator('#molang-p0').fill('math.sin(');
      await page.locator('#molang-p0').press('Enter');
      assert.equal(await page.locator('#molang-p0').getAttribute('aria-invalid'), 'true');
      assert.notEqual(await page.locator('#molangError').textContent(), 'Đã cập nhật biểu thức.');
      p = await page.evaluate(() => window.__studio.project());
      assert.equal(p.keys.root[0].p[0], 2, 'invalid expression retains last numeric value');
      const previous = await page.evaluate(() => window.__studio.project().keys.root[0].molang.p0);
      const beforeTooLong = await page.evaluate(() => window.__studio.state.historyIndex);
      await page.locator('#molang-p0').fill('9'.repeat(4097));
      await page.locator('#molang-p0').press('Enter');
      assert.equal(await page.locator('#molang-p0').getAttribute('aria-invalid'), 'true');
      assert.equal(await page.evaluate(() => window.__studio.project().keys.root[0].molang.p0), previous);
      assert.equal(await page.evaluate(() => window.__studio.state.historyIndex), beforeTooLong);
      await page.evaluate(() => window.__studio.core.validateProject(window.__studio.project(), window.__studio.rig()));
      await page.locator('#molang-p0').fill('variable.speed * query.anim_time + 2');
      await page.locator('#molang-p0').press('Enter');
      assert.equal(await page.locator('#molang-p0').getAttribute('aria-invalid'), 'false');
      mkdirSync('/tmp/molang-evidence', { recursive: true });
      await page.screenshot({ path: `/tmp/molang-evidence/${layout}.png` });
      const beforeBake = await page.evaluate(() => window.__studio.project());
      const beforeIndex = await page.evaluate(() => window.__studio.state.historyIndex);
      await page.locator('#molangBake').click();
      const baked = await page.evaluate(() => window.__studio.project());
      assert.equal(await page.evaluate(() => window.__studio.state.historyIndex), beforeIndex + 1);
      assert.equal(baked.keys.root.length, 25);
      assert.deepEqual(baked.keys.root.filter((_, i) => i % 6 === 0).map(k => k.time), [0, 0.25, 0.5, 0.75, 1]);
      assert.deepEqual(baked.keys.root.filter((_, i) => i % 6 === 0).map(k => k.p[0]), [2, 2.75, 3.5, 4.25, 5]);
      assert.ok(baked.keys.root.every(k => !k.molang));
      await page.locator('#undoBtn').click();
      assert.deepEqual(await page.evaluate(() => window.__studio.project()), beforeBake);
      await page.locator('#redoBtn').click();
      assert.deepEqual(await page.evaluate(() => window.__studio.project()), baked);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
